// Ссылки на агрегаторы, чтобы проверить и купить найденное. Цены в выдаче —
// от провайдера данных; у агрегаторов они бывают другими, особенно туда-обратно
// одним билетом, поэтому ссылки даём и на пары «туда + обратно».

const yymmdd = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
const ddmm = (d: string) => d.slice(8, 10) + d.slice(5, 7);

export interface Link { label: string; url: string }

export function oneWayLinks(from: string, to: string, date: string): Link[] {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  return [
    { label: 'Skyscanner', url: `https://www.skyscanner.net/transport/flights/${f}/${t}/${yymmdd(date)}/?adultsv2=1&rtn=0` },
    { label: 'Google Flights', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`one way flights from ${from} to ${to} on ${date}`)}` },
    { label: 'Anywayanyday', url: `https://www.anywayanyday.com/avia/offers/${ddmm(date)}${from}${to}AD1CN0IN0SCE/` },
    { label: 'Ticket.se', url: 'https://www.ticket.se/flyg' },
  ];
}

export function roundTripLinks(from: string, outTo: string, outDate: string, inFrom: string, inTo: string, inDate: string): Link[] {
  if (outTo !== inFrom || from !== inTo) {
    // Open-jaw: Skyscanner и Google принимают только через мульти-сити форму,
    // Anywayanyday — тем же форматом, что и обычный туда-обратно.
    return [
      { label: 'Anywayanyday (open-jaw)', url: `https://www.anywayanyday.com/avia/offers/${ddmm(outDate)}${from}${outTo}${ddmm(inDate)}${inFrom}${inTo}AD1CN0IN0SCE/` },
      { label: 'Google Flights', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`flights from ${from} to ${outTo} on ${outDate} and ${inFrom} to ${inTo} on ${inDate}`)}` },
    ];
  }
  const f = from.toLowerCase();
  const t = outTo.toLowerCase();
  return [
    { label: 'Skyscanner', url: `https://www.skyscanner.net/transport/flights/${f}/${t}/${yymmdd(outDate)}/${yymmdd(inDate)}/?adultsv2=1` },
    { label: 'Google Flights', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`flights from ${from} to ${outTo} on ${outDate} returning ${inDate}`)}` },
    { label: 'Anywayanyday', url: `https://www.anywayanyday.com/avia/offers/${ddmm(outDate)}${from}${outTo}${ddmm(inDate)}${outTo}${from}AD1CN0IN0SCE/` },
    { label: 'Ticket.se', url: 'https://www.ticket.se/flyg' },
  ];
}
