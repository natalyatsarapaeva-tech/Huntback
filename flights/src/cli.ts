// node --experimental-strip-types src/cli.ts --from ARN [--provider serpapi] [--preset presets/x.json]

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { availableProviders } from './providers/index.ts';
import { loadPreset, validate } from './query.ts';
import { plannedRequests, runSearch } from './search.ts';
import { fmtDuration } from './time.ts';
import type { Leg } from './plan.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    provider: { type: 'string', multiple: true },
    preset: { type: 'string', default: join(root, 'presets/valencia-december.json') },
    top: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
  },
});

const q = await loadPreset(values.preset!);
if (values.from) q.origins = values.from.toUpperCase().split(',');
const errors = validate(q);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const all = availableProviders();
const chosen = values.provider?.length ? all.filter((p) => values.provider!.includes(p.id)) : [all[0]];
if (!chosen.length) {
  console.error(`Нет провайдера ${values.provider}. Доступны: ${all.map((p) => p.id).join(', ')}`);
  process.exit(1);
}
console.error(`${chosen.map((p) => p.label).join(' + ')}: ${plannedRequests(q).length * chosen.length} запросов…`);

const r = await runSearch(q, chosen, { cacheDir: join(root, '.cache') });
if (values.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

const leg = (l: Leg) => {
  const s = l.itinerary.segments;
  const route = [s[0].from, ...s.map((x) => x.to)].join('→');
  const lay = l.layovers.map((x) => `${x.airport} ${fmtDuration(x.minutes)}${x.kind === 'night' ? ' ночь' : ''}`).join(', ');
  return `${l.date} ${s[0].dep.slice(11)}–${s.at(-1)!.arr.slice(11)} ${route}${lay ? ` (${lay})` : ''} · ${Math.round(l.flightPrice)} € + земля ${Math.round(l.ground.cost)} €`;
};

for (const [i, t] of r.trips.slice(0, +values.top!).entries()) {
  console.log(`\n#${i + 1} ${Math.round(t.money)} € · в пути ${fmtDuration(t.minutes)} · ${t.days} дн.${t.tags.length ? ` · ${t.tags.join(', ')}` : ''}`);
  console.log(`  туда:    ${leg(t.out)}`);
  console.log(`  обратно: ${leg(t.in)}`);
}
const errs = r.log.filter((l) => l.error);
console.log(`\nПросмотрено вариантов: ${r.considered}. Отброшено: ${Object.entries(r.rejected).map(([k, v]) => `${k} — ${v}`).join('; ') || 'ничего'}.`);
if (errs.length) console.log(`Ошибок запросов: ${errs.length}, например: ${errs[0].error}`);
