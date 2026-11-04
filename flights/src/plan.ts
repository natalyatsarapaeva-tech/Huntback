import type { GroundLeg, Itinerary, Query, SortBy } from './types.ts';
import { checkLayovers, type Layover } from './layover.ts';
import { groundAfterLanding, groundBeforeFlight, type GroundResult } from './ground.ts';
import { daysBetween } from './time.ts';
import { roundTripLinks, oneWayLinks, type Link } from './links.ts';

export interface Leg {
  dir: 'out' | 'in';
  date: string;
  /** Аэропорт на стороне конечного города (BCN, MAD, ALC, VLC). */
  airport: string;
  origin: string;
  itinerary: Itinerary;
  layovers: Layover[];
  ground: GroundResult;
  groundLabel: string;
  groundLinks: Link[];
  flightPrice: number;
  money: number;
  minutes: number;
  /** Обобщённая стоимость: деньги + часы в пути × цена часа. */
  score: number;
  links: Link[];
}

export interface Trip {
  out: Leg;
  in: Leg;
  days: number;
  money: number;
  minutes: number;
  score: number;
  /** Нет варианта, который одновременно дешевле и быстрее. */
  pareto: boolean;
  tags: string[];
  links: Link[];
}

export function toCurrency(it: Itinerary, q: Query): number | null {
  if (it.currency === q.currency) return it.price;
  const rate = q.fx[it.currency];
  return rate ? it.price * rate : null;
}

export type LegEval = { ok: true; leg: Leg } | { ok: false; reason: string };

export function evaluateLeg(
  dir: 'out' | 'in',
  it: Itinerary,
  ground: GroundLeg,
  origin: string,
  date: string,
  q: Query,
): LegEval {
  if (it.segments.length - 1 > q.maxStops) return { ok: false, reason: 'больше пересадок, чем разрешено' };
  const verdict = checkLayovers(it, q.layover);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const price = toCurrency(it, q);
  if (price === null) return { ok: false, reason: `нет курса для ${it.currency}` };
  const g = dir === 'out'
    ? groundAfterLanding(ground, it.segments.at(-1)!.arr, q.ground)
    : groundBeforeFlight(ground, it.segments[0].dep, q.ground);
  const money = price + g.cost;
  const minutes = it.totalMin + g.minutes;
  return {
    ok: true,
    leg: {
      dir, date, airport: ground.airport, origin,
      itinerary: it,
      layovers: verdict.layovers,
      ground: g,
      groundLabel: ground.label,
      groundLinks: ground.bookingLinks,
      flightPrice: price,
      money,
      minutes,
      score: money + (minutes / 60) * q.valueOfHour,
      links: dir === 'out' ? oneWayLinks(origin, ground.airport, date) : oneWayLinks(ground.airport, origin, date),
    },
  };
}

/**
 * Оставляет на каждую тройку (аэропорт, дата, город вылета) по `keep` лучших
 * по баллу и по цене и пару самых быстрых — чтобы при любой сортировке
 * лучший вариант не отсеялся заранее.
 */
export function pruneLegs(legs: Leg[], keep: number): Leg[] {
  const groups = new Map<string, Leg[]>();
  for (const l of legs) {
    const k = `${l.origin}|${l.airport}|${l.date}`;
    const g = groups.get(k) ?? [];
    g.push(l);
    groups.set(k, g);
  }
  return [...groups.values()].flatMap((g) => [...new Set([
    ...[...g].sort((a, b) => a.score - b.score).slice(0, keep),
    ...[...g].sort((a, b) => a.money - b.money).slice(0, keep),
    ...[...g].sort((a, b) => a.minutes - b.minutes).slice(0, 2),
  ])]);
}

export function combine(outs: Leg[], ins: Leg[], q: Query, limit = 60): Trip[] {
  const trips: Trip[] = [];
  for (const o of outs) {
    for (const i of ins) {
      if (q.returnSameOrigin && o.origin !== i.origin) continue;
      if (q.returnSameAirport && o.airport !== i.airport) continue;
      const days = daysBetween(o.date, i.date);
      if (days < q.tripDays.min || days > q.tripDays.max) continue;
      trips.push({
        out: o, in: i, days,
        money: o.money + i.money,
        minutes: o.minutes + i.minutes,
        score: o.score + i.score,
        pareto: false,
        tags: [],
        links: roundTripLinks(o.origin, o.airport, o.date, i.airport, i.origin, i.date),
      });
    }
  }
  markPareto(trips);
  const best = minBy(trips, (t) => t.score);
  const cheapest = minBy(trips, (t) => t.money);
  const fastest = minBy(trips, (t) => t.minutes);
  trips.sort(order(q.sortBy ?? 'score'));
  const top = trips.slice(0, limit);
  // Лучший, самый дешёвый и самый быстрый видны при любой сортировке.
  for (const t of [best, cheapest, fastest]) if (t && !top.includes(t)) top.push(t);
  top.sort(order(q.sortBy ?? 'score'));
  best?.tags.push('лучший баланс');
  cheapest?.tags.push('самый дешёвый');
  fastest?.tags.push('самый быстрый');
  return top;
}

function minBy<T>(xs: T[], key: (x: T) => number): T | undefined {
  let best: T | undefined;
  for (const x of xs) if (best === undefined || key(x) < key(best)) best = x;
  return best;
}

function order(by: SortBy): (a: Trip, b: Trip) => number {
  switch (by) {
    case 'money': return (a, b) => a.money - b.money || a.minutes - b.minutes;
    case 'minutes': return (a, b) => a.minutes - b.minutes || a.money - b.money;
    case 'date': return (a, b) => a.out.itinerary.segments[0].dep.localeCompare(b.out.itinerary.segments[0].dep) || a.money - b.money;
    default: return (a, b) => a.score - b.score;
  }
}

function markPareto(trips: Trip[]): void {
  const byMoney = [...trips].sort((a, b) => a.money - b.money || a.minutes - b.minutes);
  let best = Infinity;
  for (const t of byMoney) {
    if (t.minutes < best) {
      t.pareto = true;
      best = t.minutes;
    }
  }
}
