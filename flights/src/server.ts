import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Query } from './types.ts';
import { availableProviders } from './providers/index.ts';
import { loadPreset, validate } from './query.ts';
import { plannedRequests, runSearch } from './search.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5178);
const providers = availableProviders();

function send(res: import('node:http').ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(res, 200, await readFile(join(root, 'public/index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && req.url === '/api/config') {
      return send(res, 200, {
        preset: await loadPreset(join(root, 'presets/valencia-december.json')),
        providers: providers.map((p) => ({ id: p.id, label: p.label })),
      });
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { query, providerIds } = JSON.parse(raw) as { query: Query; providerIds: string[] };
      const errors = validate(query);
      if (errors.length) return send(res, 400, { errors });
      const chosen = providers.filter((p) => providerIds.includes(p.id));
      if (!chosen.length) return send(res, 400, { errors: ['Выберите источник данных.'] });
      const started = Date.now();
      const result = await runSearch(query, chosen, { cacheDir: join(root, '.cache') });
      return send(res, 200, { ...result, requests: plannedRequests(query).length * chosen.length, ms: Date.now() - started });
    }
    send(res, 404, { errors: ['Нет такого адреса'] });
  } catch (e) {
    send(res, 500, { errors: [(e as Error).message] });
  }
}).listen(port, () => {
  console.log(`Поиск билетов: http://localhost:${port}`);
  console.log(`Источники: ${providers.map((p) => p.label).join(', ')}`);
});
