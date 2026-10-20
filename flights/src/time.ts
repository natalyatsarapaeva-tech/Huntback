// Наивное локальное время в минутах. Годится для разностей в пределах одного
// аэропорта и для «времени суток»; сравнивать между аэропортами нельзя.

export function toMin(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error(`Не разобрать время: ${local}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

export function fromMin(min: number): string {
  return new Date(min * 60000).toISOString().slice(0, 16);
}

export function hhmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Не разобрать время суток: ${s}`);
  return +m[1] * 60 + +m[2];
}

export function timeOfDay(min: number): number {
  return ((min % 1440) + 1440) % 1440;
}

export function dayStart(min: number): number {
  return min - timeOfDay(min);
}

export function addDays(date: string, n: number): string {
  return fromMin(toMin(`${date}T00:00`) + n * 1440).slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toMin(`${b}T00:00`) - toMin(`${a}T00:00`)) / 1440);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** "PT2H35M" → 155 */
export function isoDuration(s: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(s);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}
