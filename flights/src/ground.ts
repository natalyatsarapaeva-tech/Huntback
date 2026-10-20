import type { GroundLeg, GroundSettings } from './types.ts';
import { fromMin, hhmm, timeOfDay, toMin } from './time.ts';

export interface GroundResult {
  cost: number;
  /** Сколько минут от посадки до конечного города (или от выхода из него до вылета). */
  minutes: number;
  /** Когда будете в конечном городе / когда из него выезжать. */
  at: string;
  overnight: boolean;
  notes: string[];
}

/** Прилетели в `arrival` (локальное время аэропорта) — когда и за сколько будем в конечном городе. */
export function groundAfterLanding(leg: GroundLeg, arrival: string, s: GroundSettings): GroundResult {
  const landed = toMin(arrival);
  const atStation = landed + s.exitMin + leg.access.minutes;
  let cost = leg.access.cost;
  const notes = [leg.access.name];
  if (!leg.rail) {
    return { cost, minutes: atStation - landed, at: fromMin(atStation), overnight: false, notes };
  }
  const r = leg.rail;
  let dep = atStation + r.headwayMin / 2;
  let overnight = false;
  const tod = timeOfDay(dep);
  const first = hhmm(r.firstDep);
  const last = hhmm(r.lastDep);
  if (tod > last || tod < first) {
    overnight = true;
    cost += s.hotelCost;
    dep = (tod > last ? dep - tod + 1440 : dep - tod) + first;
    notes.push(`последний поезд ушёл — ночёвка, утром первым в ${r.firstDep}`);
  }
  cost += r.cost;
  notes.push(r.name);
  const at = dep + r.minutes;
  // Ночь в отеле в дорогу не считаем: время сна не «теряется» так же, как время в пути.
  const minutes = overnight ? s.exitMin + leg.access.minutes + r.minutes : at - landed;
  return { cost, minutes, at: fromMin(at), overnight, notes };
}

/** Вылет в `departure` из аэропорта leg — когда выезжать из конечного города и сколько это стоит. */
export function groundBeforeFlight(leg: GroundLeg, departure: string, s: GroundSettings): GroundResult {
  const dep = toMin(departure);
  const atAirport = dep - s.checkinMin;
  const leaveStation = atAirport - leg.access.minutes;
  let cost = leg.access.cost;
  const notes: string[] = [];
  if (!leg.rail) {
    return { cost, minutes: dep - leaveStation, at: fromMin(leaveStation), overnight: false, notes: [leg.access.name] };
  }
  const r = leg.rail;
  // Поезд должен прийти не позже leaveStation; закладываем половину интервала как запас.
  let trainDep = leaveStation - r.minutes - r.headwayMin / 2;
  let overnight = false;
  const tod = timeOfDay(trainDep);
  const first = hhmm(r.firstDep);
  const last = hhmm(r.lastDep);
  if (tod < first || tod > last) {
    overnight = true;
    cost += s.hotelCost;
    // Едем накануне последним поездом и ночуем у аэропорта.
    trainDep = (tod < first ? trainDep - tod - 1440 : trainDep - tod) + last;
    notes.push(`к рейсу не успеть утром — выезд накануне в ${r.lastDep} и ночёвка`);
  }
  cost += r.cost;
  // Обратно сначала поезд, потом — до аэропорта.
  notes.push(r.name, leg.access.name);
  const minutes = overnight ? s.checkinMin + leg.access.minutes + r.minutes : dep - trainDep;
  return { cost, minutes, at: fromMin(trainDep), overnight, notes };
}
