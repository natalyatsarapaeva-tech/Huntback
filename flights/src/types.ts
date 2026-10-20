// Время везде — локальное время аэропорта в виде "YYYY-MM-DDTHH:MM", без зоны.
// Так их отдают и Google Flights, и Duffel, и так же их видит пассажир на табло.
// Длительность пересадки — разность двух локальных времён одного аэропорта,
// поэтому часовые пояса ей не нужны.

export interface Segment {
  from: string;
  to: string;
  dep: string;
  arr: string;
  carrier: string;
  flightNo: string;
  durationMin: number;
}

export interface Itinerary {
  provider: string;
  segments: Segment[];
  price: number;
  currency: string;
  totalMin: number;
  /** Чем-то помеченные провайдером особенности: «часто задерживается», «разные билеты». */
  warnings: string[];
}

export interface OneWayRequest {
  from: string;
  to: string;
  date: string;
  maxStops: number;
  currency: string;
}

export interface Provider {
  id: string;
  label: string;
  searchOneWay(req: OneWayRequest): Promise<Itinerary[]>;
}

export interface LayoverRules {
  /** Ночное окно в локальном времени аэропорта пересадки. */
  nightStart: string;
  nightEnd: string;
  /** Сколько минут пересадки должно попасть в ночное окно, чтобы она считалась ночной. */
  nightOverlapMin: number;
  /** Дневная пересадка — не длиннее. */
  dayMaxMin: number;
  /** Ночная пересадка — не короче (успеть в отель и выспаться). */
  nightMinMin: number;
  /** Любая пересадка — не короче. */
  minConnectMin: number;
  allowAirportChange: boolean;
}

/** Как добраться от аэропорта прилёта до конечного города и обратно. */
export interface GroundLeg {
  airport: string;
  label: string;
  /** Аэропорт ↔ вокзал (или ↔ центр, если поезд не нужен). */
  access: { name: string; minutes: number; cost: number };
  rail: null | {
    name: string;
    minutes: number;
    cost: number;
    /** Первый и последний поезд из города прилёта в конечный город и обратно. */
    firstDep: string;
    lastDep: string;
    /** Средний интервал между поездами — половину закладываем на ожидание. */
    headwayMin: number;
  };
  bookingLinks: { label: string; url: string }[];
}

export interface GroundSettings {
  /** От посадки до выхода из аэропорта. */
  exitMin: number;
  /** Быть в аэропорту до вылета. */
  checkinMin: number;
  /** Если на поезд не успеть — ночёвка у аэропорта/вокзала. */
  hotelCost: number;
}

export interface Query {
  origins: string[];
  destinationName: string;
  /** Для подписей: «в Валенсии», «из Валенсии». */
  destinationIn: string;
  destinationFrom: string;
  /** Аэропорты прилёта; для каждого — путь до конечного города. */
  arrivals: GroundLeg[];
  departFrom: string;
  departTo: string;
  tripDays: { min: number; max: number };
  /** false — можно прилететь в Мадрид, а улететь из Барселоны. */
  returnSameAirport: boolean;
  maxStops: number;
  layover: LayoverRules;
  ground: GroundSettings;
  /** Во сколько € оценивается час в дороге — этим цена «торгуется» с длительностью. */
  valueOfHour: number;
  currency: string;
  /** Курсы к валюте запроса, если провайдер вернул другую. */
  fx: Record<string, number>;
}
