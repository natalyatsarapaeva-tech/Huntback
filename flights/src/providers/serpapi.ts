// Google Flights через SerpAPI. Google сводит выдачу авиакомпаний и OTA —
// по сути то же предложение, что видят Skyscanner и Anywayanyday, — и, что
// важнее, отдаёт каждый сегмент с локальным временем, так что пересадки
// можно проверить по нашим правилам.
// https://serpapi.com/google-flights-api — бесплатно 250 запросов в месяц.

import type { Itinerary, OneWayRequest, Provider } from '../types.ts';
import { toMin } from '../time.ts';

interface SerpFlight {
  departure_airport: { id: string; time: string };
  arrival_airport: { id: string; time: string };
  duration: number;
  airline: string;
  flight_number: string;
  often_delayed_by_over_30_min?: boolean;
}
interface SerpOption {
  flights: SerpFlight[];
  layovers?: { id: string; duration: number; overnight?: boolean }[];
  total_duration: number;
  price?: number;
  type?: string;
}
export interface SerpResponse {
  best_flights?: SerpOption[];
  other_flights?: SerpOption[];
  search_parameters?: { currency?: string };
  error?: string;
}

export function parseSerp(json: SerpResponse, currency: string): Itinerary[] {
  if (json.error) {
    // «Google hasn't returned any results» — это пустая выдача, а не сбой.
    if (/no results|hasn't returned/i.test(json.error)) return [];
    throw new Error(`SerpAPI: ${json.error}`);
  }
  const all = [...(json.best_flights ?? []), ...(json.other_flights ?? [])];
  return all
    .filter((o) => typeof o.price === 'number' && o.flights?.length)
    .map((o) => {
      const segments = o.flights.map((f) => ({
        from: f.departure_airport.id,
        to: f.arrival_airport.id,
        dep: f.departure_airport.time.replace(' ', 'T'),
        arr: f.arrival_airport.time.replace(' ', 'T'),
        carrier: f.airline,
        flightNo: f.flight_number,
        durationMin: f.duration,
      }));
      const warnings: string[] = [];
      if (o.flights.some((f) => f.often_delayed_by_over_30_min)) warnings.push('часто задерживается >30 мин');
      return {
        provider: 'serpapi',
        segments,
        price: o.price!,
        currency: json.search_parameters?.currency ?? currency,
        totalMin: o.total_duration ?? toMin(segments.at(-1)!.arr) - toMin(segments[0].dep),
        warnings,
      };
    });
}

export function serpProvider(apiKey: string): Provider {
  return {
    id: 'serpapi',
    label: 'Google Flights (SerpAPI)',
    async searchOneWay(req: OneWayRequest) {
      const p = new URLSearchParams({
        engine: 'google_flights',
        departure_id: req.from,
        arrival_id: req.to,
        outbound_date: req.date,
        type: '2',
        currency: req.currency,
        hl: 'en',
        adults: '1',
        // 0 — любое число пересадок, 1 — прямые, 2 — до одной, 3 — до двух.
        stops: String(req.maxStops >= 2 ? 3 : req.maxStops + 1),
        api_key: apiKey,
      });
      const res = await fetch(`https://serpapi.com/search.json?${p}`);
      const json = (await res.json()) as SerpResponse;
      if (!res.ok && !json.error) throw new Error(`SerpAPI ${res.status}`);
      return parseSerp(json, req.currency);
    },
  };
}
