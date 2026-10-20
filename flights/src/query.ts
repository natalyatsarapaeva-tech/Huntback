import { readFile } from 'node:fs/promises';
import type { Query } from './types.ts';
import { daysBetween } from './time.ts';

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadPreset(path: string): Promise<Query> {
  return JSON.parse(await readFile(path, 'utf8')) as Query;
}

/** Ошибки, понятные человеку; пустой список — запрос годен. */
export function validate(q: Query): string[] {
  const e: string[] = [];
  if (!q.origins?.length) e.push('Укажите аэропорт или город вылета (код IATA, например ARN или STO).');
  for (const o of q.origins ?? []) if (!IATA.test(o)) e.push(`«${o}» — не код IATA из трёх латинских букв.`);
  if (!q.arrivals?.length) e.push('Выберите хотя бы один аэропорт прилёта.');
  if (!DATE.test(q.departFrom) || !DATE.test(q.departTo)) e.push('Даты — в формате ГГГГ-ММ-ДД.');
  else if (q.departTo < q.departFrom) e.push('Окно вылета: конец раньше начала.');
  else if (daysBetween(q.departFrom, q.departTo) > 14) e.push('Окно вылета больше двух недель — это слишком много платных запросов.');
  if (q.tripDays.min > q.tripDays.max) e.push('Длительность поездки: минимум больше максимума.');
  return e;
}
