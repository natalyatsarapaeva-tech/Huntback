import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Query } from './types.ts';
import { availableProviders } from './providers/index.ts';
import { loadPreset, validate } from './query.ts';
import { countNewRequests, plannedRequests, runSearch } from './search.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5178);
const providers = availableProviders();
/** Ход текущего поиска — интерфейс опрашивает его раз в секунду. */
let progress = { running: false, done: 0, total: 0, errors: 0, lastError: '' };

function send(res: import('node:http').ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(res, 200, await readFile(join(root, 'public/index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && req.url === '/api/progress') return send(res, 200, progress);
    if (req.method === 'GET' && req.url === '/api/config') {
      return send(res, 200, {
        preset: await loadPreset(join(root, 'presets/valencia-december.json')),
        providers: providers.map((p) => ({ id: p.id, label: p.label })),
      });
    }
    if (req.method === 'POST' && (req.url === '/api/search' || req.url === '/api/estimate')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { query, providerIds } = JSON.parse(raw) as { query: Query; providerIds: string[] };
      const errors = validate(query);
      if (errors.length) return send(res, 400, { errors });
      const chosen = providers.filter((p) => providerIds.includes(p.id));
      if (!chosen.length) return send(res, 400, { errors: ['Выберите источник данных.'] });
      if (req.url === '/api/estimate') {
        return send(res, 200, {
          total: plannedRequests(query).length * chosen.length,
          fresh: await countNewRequests(query, chosen, { cacheDir: join(root, '.cache') }),
        });
      }
      if (progress.running) return send(res, 409, { errors: ['Предыдущий поиск ещё идёт — дождитесь его.'] });
      const started = Date.now();
      progress = { running: true, done: 0, total: plannedRequests(query).length * chosen.length, errors: 0, lastError: '' };
      try {
        const result = await runSearch(query, chosen, {
          cacheDir: join(root, '.cache'),
          onProgress(done, total, e) {
            progress.done = done;
            if (e.error) { progress.errors++; progress.lastError = e.error; }
            // Демо и кэш не печатаем: их сотни и они мгновенные.
            if (e.provider !== 'mock' && !e.cached) {
              console.log(`[${done}/${total}] ${e.provider} ${e.from}→${e.to} ${e.date}: ${e.error ? `ОШИБКА ${e.error}` : `${e.found} вариантов`}`);
            }
          },
        });
        const fresh = result.log.filter((l) => !l.cached && l.provider !== 'mock').length;
        if (fresh) console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с: новых запросов ${fresh}, ошибок ${progress.errors}.`);
        return send(res, 200, { ...result, requests: progress.total, ms: Date.now() - started });
      } finally {
        progress.running = false;
      }
    }
    send(res, 404, { errors: ['Нет такого адреса'] });
  } catch (e) {
    send(res, 500, { errors: [(e as Error).message] });
  }
}).listen(port, () => {
  console.log(`Поиск билетов: http://localhost:${port}`);
  console.log(`Источники: ${providers.map((p) => p.label).join(', ')}`);
});
