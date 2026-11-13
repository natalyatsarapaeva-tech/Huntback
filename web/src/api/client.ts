// Клиент API воркера. Мутирующие запросы несут CSRF-заголовок из
// non-HttpOnly cookie (double submit, §5.3).

import type { Api, RunEvent, SearchMode, DocEvent, GeneratedDoc, MasterResume } from './types.ts';

function csrf(): string {
  const hit = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('csrf='));
  return hit ? hit.slice(5) : '';
}

export class ApiFailure extends Error {
  code: string;
  retryAfter?: number;
  constructor(code: string, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(['GET', 'HEAD'].includes(method) ? {} : { 'X-Huntback-CSRF': csrf() }),
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; retry_after?: number } }).error;
    throw new ApiFailure(e?.code ?? 'unknown', e?.message ?? 'Something went wrong', e?.retry_after);
  }
  return data as T;
}

const post = <T>(p: string, body?: unknown) =>
  call<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

/**
 * Читает построчный NDJSON-поток прогона. EventSource здесь не подходит: он
 * умеет только GET и не может послать CSRF-заголовок, а мутирующий запрос без
 * него воркер отклонит. Поэтому обычный POST и чтение тела ридером.
 */
async function streamNdjson<E = RunEvent>(path: string, payload: unknown, onEvent: (e: E) => void): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Huntback-CSRF': csrf(), Accept: 'application/x-ndjson' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const e = (data as { error?: { code: string; message: string; retry_after?: number } }).error;
    throw new ApiFailure(e?.code ?? 'unknown', e?.message ?? 'Could not start the search', e?.retry_after);
  }
  if (!res.body) throw new ApiFailure('no_stream', 'The server did not send a progress stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Последний фрагмент может быть неполной строкой — оставляем его в буфере.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line) as E); } catch { /* битую строку пропускаем */ }
    }
  }
  if (buffer.trim()) {
    try { onEvent(JSON.parse(buffer) as E); } catch { /* пусто */ }
  }
}

/**
 * Генерация документа со стримом: черновик, два ревью, переписывания. Результат
 * приходит в последнем событии; ошибка — там же, а не обрывом соединения.
 */
async function streamResult<T>(path: string, payload: unknown, onEvent?: (e: DocEvent) => void): Promise<T> {
  let result: T | undefined;
  let error: string | undefined;
  await streamNdjson<DocEvent>(path, payload, e => {
    if (e.stage === 'done') {
      if (e.error) error = e.error; else result = e.result as T;
      return;
    }
    onEvent?.(e);
  });
  if (error) throw new ApiFailure('generation_failed', error);
  if (result === undefined) throw new ApiFailure('no_result', 'The connection closed before the document was ready. Open the place again — it may already be saved.');
  return result;
}

export const httpApi: Api = {
  me: () => call('/me'),
  logout: () => post('/auth/logout'),
  resetData: scope => post('/account/reset', { scope }),
  getProfile: () => call('/profile'),
  saveProfile: patch => call('/profile', { method: 'PUT', body: JSON.stringify(patch) }),
  runAudit: () => post('/profile/audit'),
  patchFact: (id, patch) => call(`/profile/facts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteFact: id => call(`/profile/facts/${id}`, { method: 'DELETE' }),
  listOpportunities: () => call('/opportunities'),
  getOpportunity: id => call(`/opportunities/${id}`),
  patchOpportunity: (id, patch) => call(`/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  archiveOpportunity: id => call(`/opportunities/${id}`, { method: 'DELETE' }),
  fetchJobText: id => post(`/opportunities/${id}/jd`),
  importJob: input => post('/opportunities/import', input),
  confirmImport: r => post('/opportunities/import/confirm', r),
  analyse: id => post(`/opportunities/${id}/analyse`),
  makeResume: (id, onEvent) => streamResult<GeneratedDoc>(`/opportunities/${id}/resume`, {}, onEvent),
  makeLetter: (id, tone, onEvent) => streamResult<GeneratedDoc>(`/opportunities/${id}/letter`, { tone }, onEvent),
  answerFact: (id, answer) => post(`/profile/facts/${id}/answer`, { answer }),
  coach: () => call('/coach'),
  coachMessage: (text, topic_id) => post('/coach/message', { text, topic_id }),
  coachSkip: topic_id => post('/coach/skip', { topic_id }),
  coachProposal: (id, action) => post(`/coach/proposals/${id}`, { action }),
  coachReset: () => post('/coach/reset'),
  buildMasterResume: onEvent => streamResult<MasterResume>('/profile/master-resume', {}, onEvent),
  importBatch: text => post('/opportunities/import/batch', { text }),
  questions: () => call('/questions'),
  fixExpectation: (id, b) => post(`/opportunities/${id}/fix`, b),
  saveDocument: (id, patch) => call(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  runSearch: (mode: SearchMode, onEvent) => streamNdjson('/runs', { mode }, onEvent),
  usage: () => call('/usage'),
};
