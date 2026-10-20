import type { Itinerary, LayoverRules } from './types.ts';
import { dayStart, hhmm, toMin } from './time.ts';

export interface Layover {
  airport: string;
  /** Прилёт в один аэропорт города, вылет из другого (LGW → LHR). */
  airportChange: string | null;
  start: string;
  end: string;
  minutes: number;
  nightMinutes: number;
  kind: 'day' | 'night';
}

/** Сколько минут интервала [start, end) попадает в ночные окна. */
export function nightOverlap(start: number, end: number, nightStart: string, nightEnd: string): number {
  const ns = hhmm(nightStart);
  const ne = hhmm(nightEnd);
  let total = 0;
  for (let day = dayStart(start) - 1440; day <= end; day += 1440) {
    const wStart = day + ns;
    const wEnd = ne > ns ? day + ne : day + 1440 + ne;
    total += Math.max(0, Math.min(end, wEnd) - Math.max(start, wStart));
  }
  return total;
}

export function layoversOf(it: Itinerary, rules: LayoverRules): Layover[] {
  const out: Layover[] = [];
  for (let i = 1; i < it.segments.length; i++) {
    const a = it.segments[i - 1];
    const b = it.segments[i];
    const start = toMin(a.arr);
    const end = toMin(b.dep);
    const night = nightOverlap(start, end, rules.nightStart, rules.nightEnd);
    out.push({
      airport: a.to,
      airportChange: a.to === b.from ? null : b.from,
      start: a.arr,
      end: b.dep,
      minutes: end - start,
      nightMinutes: night,
      kind: night >= rules.nightOverlapMin ? 'night' : 'day',
    });
  }
  return out;
}

export type LayoverVerdict =
  | { ok: true; layovers: Layover[] }
  | { ok: false; layovers: Layover[]; reason: string };

export function checkLayovers(it: Itinerary, rules: LayoverRules): LayoverVerdict {
  const layovers = layoversOf(it, rules);
  for (const l of layovers) {
    if (l.airportChange && !rules.allowAirportChange) {
      return { ok: false, layovers, reason: 'смена аэропорта на пересадке' };
    }
    if (l.minutes < rules.minConnectMin) {
      return { ok: false, layovers, reason: 'слишком короткая стыковка' };
    }
    if (l.kind === 'day' && l.minutes > rules.dayMaxMin) {
      return { ok: false, layovers, reason: 'дневная пересадка длиннее лимита' };
    }
    if (l.kind === 'night' && l.minutes < rules.nightMinMin) {
      return { ok: false, layovers, reason: 'ночная пересадка короче лимита' };
    }
  }
  return { ok: true, layovers };
}
