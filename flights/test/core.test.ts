import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Itinerary, Query, Segment } from '../src/types.ts';
import { checkLayovers, nightOverlap } from '../src/layover.ts';
import { groundAfterLanding, groundBeforeFlight } from '../src/ground.ts';
import { combine, evaluateLeg } from '../src/plan.ts';
import { toMin } from '../src/time.ts';
import { runSearch, plannedRequests, countNewRequests } from '../src/search.ts';
import { mockProvider } from '../src/providers/mock.ts';
import { parseSerp } from '../src/providers/serpapi.ts';
import { parseDuffel } from '../src/providers/duffel.ts';

const preset = JSON.parse(readFileSync(new URL('../presets/valencia-december.json', import.meta.url), 'utf8')) as Query;
const q: Query = { ...preset, origins: ['CPH'] };
const leg = (code: string) => q.arrivals.find((a) => a.airport === code)!;

const seg = (from: string, to: string, dep: string, arr: string): Segment =>
  ({ from, to, dep, arr, carrier: 'XX', flightNo: 'XX1', durationMin: toMin(arr) - toMin(dep) });
const itin = (segments: Segment[], price = 100): Itinerary =>
  ({ provider: 't', segments, price, currency: 'EUR', totalMin: toMin(segments.at(-1)!.arr) - toMin(segments[0].dep), warnings: [] });

test('ночное окно считается через полночь', () => {
  assert.equal(nightOverlap(toMin('2026-12-20T22:00'), toMin('2026-12-21T07:00'), '23:00', '06:00'), 420);
  assert.equal(nightOverlap(toMin('2026-12-20T10:00'), toMin('2026-12-20T13:00'), '23:00', '06:00'), 0);
  assert.equal(nightOverlap(toMin('2026-12-21T05:00'), toMin('2026-12-21T08:00'), '23:00', '06:00'), 60);
});

test('дневная пересадка до 3,5 ч проходит, длиннее — нет', () => {
  const ok = itin([seg('CPH', 'FRA', '2026-12-20T07:00', '2026-12-20T09:20'), seg('FRA', 'VLC', '2026-12-20T12:30', '2026-12-20T15:00')]);
  assert.equal(checkLayovers(ok, q.layover).ok, true);
  const long = itin([seg('CPH', 'FRA', '2026-12-20T07:00', '2026-12-20T09:20'), seg('FRA', 'VLC', '2026-12-20T13:30', '2026-12-20T16:00')]);
  const v = checkLayovers(long, q.layover);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'дневная пересадка длиннее лимита');
});

test('ночная пересадка короче 10 ч отбрасывается, от 10 ч — проходит', () => {
  const short = itin([seg('CPH', 'CPH', '2026-12-20T20:00', '2026-12-20T21:10'), seg('CPH', 'VLC', '2026-12-21T06:30', '2026-12-21T10:00')]);
  const v = checkLayovers(short, q.layover);
  assert.equal(v.ok, false);
  assert.equal(v.layovers[0].kind, 'night');
  const sleep = itin([seg('CPH', 'CPH', '2026-12-20T19:00', '2026-12-20T20:10'), seg('CPH', 'VLC', '2026-12-21T08:30', '2026-12-21T12:00')]);
  assert.equal(checkLayovers(sleep, q.layover).ok, true);
});

test('вечерняя пересадка, едва задевающая ночь, остаётся дневной', () => {
  // 21:00–23:40: в ночное окно попадает 40 мин — меньше порога 60.
  const it = itin([seg('CPH', 'AMS', '2026-12-20T18:40', '2026-12-20T21:00'), seg('AMS', 'VLC', '2026-12-20T23:40', '2026-12-21T02:10')]);
  const v = checkLayovers(it, q.layover);
  assert.equal(v.layovers[0].kind, 'day');
  assert.equal(v.ok, true);
});

test('смена аэропорта на пересадке запрещена по умолчанию', () => {
  const it = itin([seg('CPH', 'LGW', '2026-12-20T07:00', '2026-12-20T09:00'), seg('LHR', 'VLC', '2026-12-20T11:30', '2026-12-20T14:30')]);
  const v = checkLayovers(it, q.layover);
  assert.equal(!v.ok && v.reason, 'смена аэропорта на пересадке');
});

test('прилёт в Мадрид днём — поезд в тот же день', () => {
  const g = groundAfterLanding(leg('MAD'), '2026-12-20T14:00', q.ground);
  assert.equal(g.overnight, false);
  // 40 выход + 30 Cercanías + 22,5 ожидание + 115 поезд
  assert.equal(g.minutes, 207.5);
  assert.equal(g.cost, 27.6);
});

test('прилёт в Барселону поздно вечером — ночёвка и первый поезд', () => {
  const g = groundAfterLanding(leg('BCN'), '2026-12-20T22:30', q.ground);
  assert.equal(g.overnight, true);
  assert.equal(g.at, '2026-12-21T09:30');
  assert.equal(g.cost, 6 + 30 + 90);
});

test('ранний вылет из Аликанте — выезд накануне', () => {
  const g = groundBeforeFlight(leg('ALC'), '2026-12-30T07:00', q.ground);
  assert.equal(g.overnight, true);
  assert.equal(g.at, '2026-12-29T21:00');
});

test('прямо в Валенсию — только метро', () => {
  const g = groundAfterLanding(leg('VLC'), '2026-12-20T23:50', q.ground);
  assert.equal(g.cost, 5);
  assert.equal(g.overnight, false);
});

test('поездки собираются по длительности 8–10 дней и разрешают open-jaw', () => {
  const out = evaluateLeg('out', itin([seg('CPH', 'MAD', '2026-12-21T08:00', '2026-12-21T12:00')], 120), leg('MAD'), 'CPH', '2026-12-21', q);
  const back = (code: string, date: string) =>
    evaluateLeg('in', itin([seg(code, 'CPH', `${date}T15:00`, `${date}T19:00`)], 90), leg(code), 'CPH', date, q);
  const legs = [back('BCN', '2026-12-29'), back('MAD', '2026-12-28'), back('MAD', '2027-01-05')];
  assert.ok(out.ok && legs.every((l) => l.ok));
  const trips = combine([out.ok ? out.leg : null!], legs.map((l) => (l.ok ? l.leg : null!)), q);
  assert.deepEqual(trips.map((t) => `${t.in.airport}/${t.days}`).sort(), ['BCN/8']);
  const same = combine([out.ok ? out.leg : null!], legs.map((l) => (l.ok ? l.leg : null!)), { ...q, returnSameAirport: true });
  assert.equal(same.length, 0);
});

test('план запросов: 4 аэропорта × (6 дат туда + 8 дат обратно)', () => {
  assert.equal(plannedRequests(q).length, 4 * (6 + 8));
});

test('поиск на демо-данных находит поездки, и все они соблюдают правила', async () => {
  const r = await runSearch(q, [mockProvider]);
  assert.ok(r.trips.length > 10);
  assert.ok(Object.values(r.rejected).reduce((a, b) => a + b, 0) > 0);
  for (const t of r.trips) {
    assert.ok(t.days >= 8 && t.days <= 10);
    assert.ok(t.out.date >= '2026-12-20' && t.out.date <= '2026-12-25');
    for (const l of [...t.out.layovers, ...t.in.layovers]) {
      if (l.kind === 'day') assert.ok(l.minutes <= 210);
      else assert.ok(l.minutes >= 600);
    }
  }
  const scores = r.trips.filter((t) => !t.tags.some((x) => x !== 'лучший баланс')).map((t) => t.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
});

test('SerpAPI: разбор сегментов и пустой выдачи', () => {
  const its = parseSerp({
    best_flights: [{
      flights: [
        { departure_airport: { id: 'CPH', time: '2026-12-20 06:10' }, arrival_airport: { id: 'FRA', time: '2026-12-20 08:25' }, duration: 135, airline: 'Lufthansa', flight_number: 'LH 807' },
        { departure_airport: { id: 'FRA', time: '2026-12-20 10:05' }, arrival_airport: { id: 'VLC', time: '2026-12-20 12:20' }, duration: 135, airline: 'Lufthansa', flight_number: 'LH 1158', often_delayed_by_over_30_min: true },
      ],
      layovers: [{ id: 'FRA', duration: 100 }],
      total_duration: 370,
      price: 214,
    }],
    other_flights: [{ flights: [], total_duration: 0 }],
  }, 'EUR');
  assert.equal(its.length, 1);
  assert.equal(its[0].segments[1].dep, '2026-12-20T10:05');
  assert.deepEqual(its[0].warnings, ['часто задерживается >30 мин']);
  assert.deepEqual(parseSerp({ error: "Google Flights hasn't returned any results for this query." }, 'EUR'), []);
  assert.throws(() => parseSerp({ error: 'Invalid API key.' }, 'EUR'), /Invalid API key/);
});

test('Duffel: разбор предложения', () => {
  const its = parseDuffel({
    data: {
      offers: [{
        total_amount: '187.40',
        total_currency: 'EUR',
        slices: [{
          duration: 'PT6H5M',
          segments: [
            { departing_at: '2026-12-20T06:10:00', arriving_at: '2026-12-20T08:25:00', origin: { iata_code: 'CPH' }, destination: { iata_code: 'CPH' }, marketing_carrier: { name: 'SAS', iata_code: 'SK' }, marketing_carrier_flight_number: '1416', duration: 'PT1H15M' },
            { departing_at: '2026-12-20T09:40:00', arriving_at: '2026-12-20T12:15:00', origin: { iata_code: 'CPH' }, destination: { iata_code: 'BCN' }, marketing_carrier: { name: 'SAS', iata_code: 'SK' }, marketing_carrier_flight_number: '4583', duration: null },
          ],
        }],
      }],
    },
  });
  assert.equal(its[0].price, 187.4);
  assert.equal(its[0].totalMin, 365);
  assert.equal(its[0].segments[0].flightNo, 'SK1416');
  assert.equal(its[0].segments[1].durationMin, 155);
});

test('можно улететь из Копенгагена, а вернуться в Мальмё — и запретить это', () => {
  const qq: Query = { ...q, origins: ['CPH', 'MMX'] };
  const out = evaluateLeg('out', itin([seg('CPH', 'VLC', '2026-12-21T08:00', '2026-12-21T12:00')]), leg('VLC'), 'CPH', '2026-12-21', qq);
  const back = evaluateLeg('in', itin([seg('VLC', 'MMX', '2026-12-30T15:00', '2026-12-30T19:00')]), leg('VLC'), 'MMX', '2026-12-30', qq);
  assert.ok(out.ok && back.ok);
  const mixed = combine([out.leg], [back.leg], qq);
  assert.equal(mixed.length, 1);
  assert.match(mixed[0].links[0].url, /2112CPHVLC3012VLCMMX/);
  assert.equal(combine([out.leg], [back.leg], { ...qq, returnSameOrigin: true }).length, 0);
});

test('число пересадок не входит в запрос: ползунок не тратит платные запросы', () => {
  const a = plannedRequests({ ...q, maxStops: 0 }).map((p) => JSON.stringify(p.req));
  const b = plannedRequests({ ...q, maxStops: 2 }).map((p) => JSON.stringify(p.req));
  assert.deepEqual(a, b);
});

test('счётчик новых запросов: демо бесплатно, платный считается до кэша', async () => {
  const paid = { ...mockProvider, id: 'paid' };
  assert.equal(await countNewRequests(q, [mockProvider]), 0);
  assert.equal(await countNewRequests(q, [paid], { cacheDir: '/nonexistent' }), plannedRequests(q).length);
});

test('.env из Блокнота: BOM, UTF-16, пробелы, кавычки, ключ без имени', async () => {
  const { decode, parseEnv, loadEnv } = await import('../src/env.ts');
  const key = 'a'.repeat(60) + '1234';
  assert.equal(parseEnv(decode(Buffer.from(`﻿SERPAPI_KEY=${key}\r\n`)))['SERPAPI_KEY'], key);
  assert.equal(parseEnv(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`SERPAPI_KEY=${key}`, 'utf16le')])))['SERPAPI_KEY'], key);
  assert.equal(parseEnv(` serpapi_key = "${key}" `)['SERPAPI_KEY'], key);
  assert.equal(parseEnv(`${key}\n`)['SERPAPI_KEY'], key);
  assert.equal(parseEnv('# комментарий\nDUFFEL_TOKEN=duffel_test_x')['DUFFEL_TOKEN'], 'duffel_test_x');

  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const env: NodeJS.ProcessEnv = {};
  assert.match(loadEnv(dir, env).join(' '), /Файла с ключом нет/);
  writeFileSync(join(dir, '.env.txt'), `﻿SERPAPI_KEY=${key}`);
  const report = loadEnv(dir, env).join(' ');
  assert.equal(env.SERPAPI_KEY, key);
  assert.match(report, /\.env\.txt/);
  assert.match(report, /…1234/);
});
