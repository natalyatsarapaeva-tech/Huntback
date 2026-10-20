import type { Provider } from '../types.ts';
import { mockProvider } from './mock.ts';
import { serpProvider } from './serpapi.ts';
import { duffelProvider } from './duffel.ts';

/** Провайдеры, для которых есть ключи в окружении. Демо доступно всегда. */
export function availableProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const list: Provider[] = [];
  if (env.SERPAPI_KEY) list.push(serpProvider(env.SERPAPI_KEY));
  if (env.DUFFEL_TOKEN) list.push(duffelProvider(env.DUFFEL_TOKEN));
  list.push(mockProvider);
  return list;
}
