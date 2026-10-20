import type { GroundLeg, Itinerary, Query } from './types.ts';
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

/** Оставляет по `keep` лучших ног на каждую пару (аэропорт, дата, город вылета). */
export function pruneLegs(legs: Leg[], keep: number): Leg[] {
  const groups = new Map<string, Leg[]>();
  for (const l of legs) {
    const k = `${l.origin}|${l.airport}|${l.date}`;
    const g = groups.get(k) ?? [];
    g.push(l);
    groups.set(k, g);
  }
  return [...groups.values()].flatMap((g) => g.sort((a, b) => a.score - b.score).slice(0, keep));
}

export function combine(outs: Leg[], ins: Leg[], q: Query, limit = 60): Trip[] {
  const trips: Trip[] = [];
  for (const o of outs) {
    for (const i of ins) {
      if (o.origin !== i.origin) continue;
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
        links: roundTripLinks(o.origin, o.airport, o.date, i.airport, i.date),
      });
    }
  }
  trips.sort((a, b) => a.score - b.score);
  markPareto(trips);
  const top = trips.slice(0, limit);
  // Самый дешёвый и самый быстрый показываем, даже если они не вошли в топ по баллу.
  const cheapest = [...trips].sort((a, b) => a.money - b.money)[0];
  const fastest = [...trips].sort((a, b) => a.minutes - b.minutes)[0];
  for (const t of [cheapest, fastest]) if (t && !top.includes(t)) top.push(t);
  if (top[0]) top[0].tags.push('лучший баланс');
  cheapest?.tags.push('самый дешёвый');
  fastest?.tags.push('самый быстрый');
  return top;
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
