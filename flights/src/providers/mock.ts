// Демо-провайдер: правдоподобные, но выдуманные рейсы. Детерминирован —
// один и тот же запрос даёт одну и ту же выдачу, чтобы интерфейс и тесты
// можно было гонять без ключей. Часовые пояса не моделирует.

import type { Itinerary, OneWayRequest, Provider, Segment } from '../types.ts';
import { fromMin, toMin } from '../time.ts';

const HUBS = ['FRA', 'MUC', 'AMS', 'CPH', 'ZRH', 'CDG', 'BRU', 'LIS', 'VIE', 'WAW'];
const CARRIERS = ['SK', 'LH', 'KL', 'AF', 'IB', 'VY', 'FR', 'U2', 'LX', 'TP', 'LO', 'D8'];

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function flightMin(a: string, b: string, r: () => number): number {
  return 110 + Math.floor(r() * 120);
}

export const mockProvider: Provider = {
  id: 'mock',
  label: 'Демо-данные (без ключа)',
  async searchOneWay(req: OneWayRequest): Promise<Itinerary[]> {
    const r = rng(`${req.from}-${req.to}-${req.date}`);
    const base = toMin(`${req.date}T00:00`);
    const day = +req.date.slice(8, 10);
    // Ближе к 23–24 декабря дороже, после 1 января дешевле.
    const season = req.date.slice(5, 7) === '12' ? 1 + Math.max(0, 6 - Math.abs(23 - day)) * 0.08 : 0.85;
    const out: Itinerary[] = [];
    const count = 6 + Math.floor(r() * 8);
    for (let i = 0; i < count; i++) {
      const stops = req.maxStops === 0 ? 0 : r() < 0.25 ? 0 : r() < 0.8 ? 1 : Math.min(2, req.maxStops);
      const segs: Segment[] = [];
      let t = base + 360 + Math.floor(r() * 16 * 60);
      let from = req.from;
      const route = [...Array.from({ length: stops }, () => HUBS[Math.floor(r() * HUBS.length)]), req.to];
      for (const to of route) {
        if (from === to) continue;
        const carrier = CARRIERS[Math.floor(r() * CARRIERS.length)];
        const d = flightMin(from, to, r);
        segs.push({ from, to, dep: fromMin(t), arr: fromMin(t + d), carrier, flightNo: `${carrier}${100 + Math.floor(r() * 8900)}`, durationMin: d });
        // Пересадки: от коротких дневных до ночёвок — часть нарочно нарушает правила.
        const pick = r();
        t += d + (pick < 0.5 ? 50 + r() * 150 : pick < 0.75 ? 240 + r() * 300 : 600 + r() * 240);
        from = to;
      }
      if (!segs.length) continue;
      const totalMin = toMin(segs.at(-1)!.arr) - toMin(segs[0].dep);
      const price = Math.round((70 + r() * 230) * season * (stops === 0 ? 1.35 : 1));
      out.push({ provider: 'mock', segments: segs, price, currency: 'EUR', totalMin, warnings: [] });
    }
    return out;
  },
};
