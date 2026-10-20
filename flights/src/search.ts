import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Itinerary, OneWayRequest, Provider, Query } from './types.ts';
import { addDays, dateRange } from './time.ts';
import { combine, evaluateLeg, pruneLegs, type Leg, type Trip } from './plan.ts';

export interface SearchLog {
  provider: string;
  from: string;
  to: string;
  date: string;
  found: number;
  cached: boolean;
  error?: string;
}

export interface SearchResult {
  trips: Trip[];
  log: SearchLog[];
  /** Почему отброшены варианты — чтобы было видно, на что смотрел поиск. */
  rejected: Record<string, number>;
  considered: number;
}

export interface SearchOptions {
  cacheDir?: string;
  cacheTtlMin?: number;
  concurrency?: number;
  keepPerGroup?: number;
}

/** Все поиски в одну сторону, которые нужны запросу. */
export function plannedRequests(q: Query): { dir: 'out' | 'in'; origin: string; airport: string; req: OneWayRequest }[] {
  const out = dateRange(q.departFrom, q.departTo);
  const back = dateRange(addDays(q.departFrom, q.tripDays.min), addDays(q.departTo, q.tripDays.max));
  const list: ReturnType<typeof plannedRequests> = [];
  for (const origin of q.origins) {
    for (const a of q.arrivals) {
      // Всегда до двух пересадок: число пересадок фильтруем у себя, чтобы ползунок
      // не тратил платные запросы.
      const base = { maxStops: 2, currency: q.currency };
      for (const date of out) list.push({ dir: 'out', origin, airport: a.airport, req: { ...base, from: origin, to: a.airport, date } });
      for (const date of back) list.push({ dir: 'in', origin, airport: a.airport, req: { ...base, from: a.airport, to: origin, date } });
    }
  }
  return list;
}

const cacheFile = (dir: string, p: Provider, req: OneWayRequest) =>
  join(dir, `${p.id}-${req.from}-${req.to}-${req.date}-${req.maxStops}-${req.currency}.json`);

async function readCache(p: Provider, req: OneWayRequest, o: SearchOptions): Promise<Itinerary[] | null> {
  if (!o.cacheDir) return null;
  try {
    const hit = JSON.parse(await readFile(cacheFile(o.cacheDir, p, req), 'utf8')) as { at: number; items: Itinerary[] };
    if (Date.now() - hit.at < (o.cacheTtlMin ?? 360) * 60000) return hit.items;
  } catch { /* нет кэша */ }
  return null;
}

/** Сколько платных запросов уйдёт в сеть: демо бесплатно, кэш тоже. */
export async function countNewRequests(q: Query, providers: Provider[], o: SearchOptions = {}): Promise<number> {
  let n = 0;
  for (const p of plannedRequests(q)) {
    for (const prov of providers) {
      if (prov.id !== 'mock' && !(await readCache(prov, p.req, o))) n++;
    }
  }
  return n;
}

async function cached(p: Provider, req: OneWayRequest, o: SearchOptions): Promise<{ items: Itinerary[]; cached: boolean }> {
  if (!o.cacheDir || p.id === 'mock') return { items: await p.searchOneWay(req), cached: false };
  const file = cacheFile(o.cacheDir, p, req);
  const hit = await readCache(p, req, o);
  if (hit) return { items: hit, cached: true };
  const items = await p.searchOneWay(req);
  await mkdir(o.cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), items }));
  return { items, cached: false };
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }));
  return results;
}

const flightKey = (it: Itinerary) => it.segments.map((s) => `${s.flightNo}@${s.dep}`).join('+');

export async function runSearch(q: Query, providers: Provider[], o: SearchOptions = {}): Promise<SearchResult> {
  const log: SearchLog[] = [];
  const rejected: Record<string, number> = {};
  const legs: Leg[] = [];
  let considered = 0;
  const planned = plannedRequests(q);
  const tasks = planned.flatMap((p) => providers.map((prov) => async () => {
    try {
      const r = await cached(prov, p.req, o);
      log.push({ provider: prov.id, from: p.req.from, to: p.req.to, date: p.req.date, found: r.items.length, cached: r.cached });
      return { p, items: r.items };
    } catch (e) {
      log.push({ provider: prov.id, from: p.req.from, to: p.req.to, date: p.req.date, found: 0, cached: false, error: (e as Error).message });
      return { p, items: [] as Itinerary[] };
    }
  }));
  const results = await pool(tasks, o.concurrency ?? 4);

  // Один и тот же рейс от разных провайдеров — оставляем дешёвый.
  const seen = new Map<string, Leg>();
  for (const { p, items } of results) {
    const ground = q.arrivals.find((a) => a.airport === p.airport)!;
    for (const it of items) {
      considered++;
      const ev = evaluateLeg(p.dir, it, ground, p.origin, p.req.date, q);
      if (!ev.ok) {
        rejected[ev.reason] = (rejected[ev.reason] ?? 0) + 1;
        continue;
      }
      const k = `${p.dir}|${flightKey(it)}`;
      const prev = seen.get(k);
      if (!prev || ev.leg.money < prev.money) seen.set(k, ev.leg);
    }
  }
  legs.push(...seen.values());
  const keep = o.keepPerGroup ?? 6;
  const outs = pruneLegs(legs.filter((l) => l.dir === 'out'), keep);
  const ins = pruneLegs(legs.filter((l) => l.dir === 'in'), keep);
  return { trips: combine(outs, ins, q), log, rejected, considered };
}
