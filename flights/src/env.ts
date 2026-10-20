// Ключи из flights/.env. Свой разбор вместо `node --env-file`, потому что тот
// молча не видит ключ в файлах, которые обычно получаются в Блокноте Windows:
// UTF-8 с BOM, UTF-16, имя .env.txt, ключ без «SERPAPI_KEY=».

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const KNOWN = ['SERPAPI_KEY', 'DUFFEL_TOKEN'];

export function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const line of lines) {
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)$/.exec(line);
    if (m) out[m[1].toUpperCase()] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    // Одна строка из 64 hex-символов — это ключ SerpAPI, вписанный без имени.
    else if (/^[0-9a-f]{64}$/i.test(line)) out.SERPAPI_KEY = line;
  }
  return out;
}

/** Читает ключи в process.env и возвращает строки для журнала запуска. */
export function loadEnv(dir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const report: string[] = [];
  let found: string | null = null;
  for (const name of ['.env', '.env.txt', 'env.txt', 'env']) {
    try {
      const vars = parseEnv(decode(readFileSync(join(dir, name))));
      found = name;
      for (const [k, v] of Object.entries(vars)) if (v && !env[k]) env[k] = v;
      if (name !== '.env') report.push(`Ключи прочитаны из ${name} (можно переименовать в .env, но и так работает).`);
      break;
    } catch { /* нет такого файла */ }
  }
  for (const k of KNOWN) {
    if (env[k]) report.push(`${k}: найден, заканчивается на …${env[k]!.slice(-4)}`);
  }
  if (!KNOWN.some((k) => env[k])) {
    report.push(found
      ? `В ${join(dir, found)} нет строки SERPAPI_KEY=ваш_ключ — работаю на демо-данных.`
      : `Файла с ключом нет в ${dir} — работаю на демо-данных. Создайте там .env со строкой SERPAPI_KEY=ваш_ключ.`);
  }
  return report;
}
