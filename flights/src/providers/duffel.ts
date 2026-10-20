// Duffel — живые предложения авиакомпаний (NDC/GDS), которые можно купить.
// Лоукостеров вроде Ryanair нет, зато цены — настоящие, не из кэша.
// https://duffel.com/docs/api/v2/offer-requests

import type { Itinerary, OneWayRequest, Provider } from '../types.ts';
import { isoDuration, toMin } from '../time.ts';

interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  origin: { iata_code: string };
  destination: { iata_code: string };
  marketing_carrier: { name: string; iata_code: string };
  marketing_carrier_flight_number: string;
  duration: string | null;
}
interface DuffelOffer {
  total_amount: string;
  total_currency: string;
  slices: { segments: DuffelSegment[]; duration: string | null }[];
}
export interface DuffelResponse {
  data?: { offers: DuffelOffer[] };
  errors?: { message: string }[];
}

export function parseDuffel(json: DuffelResponse): Itinerary[] {
  if (json.errors?.length) throw new Error(`Duffel: ${json.errors.map((e) => e.message).join('; ')}`);
  return (json.data?.offers ?? []).map((o) => {
    const s = o.slices[0];
    const segments = s.segments.map((g) => ({
      from: g.origin.iata_code,
      to: g.destination.iata_code,
      dep: g.departing_at.slice(0, 16),
      arr: g.arriving_at.slice(0, 16),
      carrier: g.marketing_carrier.name,
      flightNo: `${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`,
      durationMin: g.duration ? isoDuration(g.duration) : toMin(g.arriving_at) - toMin(g.departing_at),
    }));
    // Duffel отдаёт длительность слайса; без неё — сумма полётов и пересадок
    // (разность локальных времён начала и конца врёт при смене пояса).
    const totalMin = s.duration
      ? isoDuration(s.duration)
      : segments.reduce((t, g, i) => t + g.durationMin + (i ? toMin(g.dep) - toMin(segments[i - 1].arr) : 0), 0);
    return { provider: 'duffel', segments, price: +o.total_amount, currency: o.total_currency, totalMin, warnings: [] };
  });
}

export function duffelProvider(token: string): Provider {
  return {
    id: 'duffel',
    label: 'Duffel',
    async searchOneWay(req: OneWayRequest) {
      const res = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Duffel-Version': 'v2',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          data: {
            slices: [{ origin: req.from, destination: req.to, departure_date: req.date }],
            passengers: [{ type: 'adult' }],
            cabin_class: 'economy',
            max_connections: Math.min(req.maxStops, 2),
          },
        }),
      });
      const json = (await res.json()) as DuffelResponse;
      if (!res.ok && !json.errors) throw new Error(`Duffel ${res.status}`);
      return parseDuffel(json);
    },
  };
}
