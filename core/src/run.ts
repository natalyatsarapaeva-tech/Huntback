// Прогон поиска: этапы, оценка времени и прогресс (§9 в редакции 1.3).
//
// Очередей нет. Поиск выполняется прямо в запросе, а прогресс стримится
// клиенту, поэтому и сервер, и экран должны считать проценты ОДНОЙ функцией —
// иначе полоса на экране разойдётся с тем, что на самом деле происходит.
//
// Главное правило этого модуля: полоса двигается от РЕАЛЬНЫХ событий, а не от
// таймера. Основное время уходит на веб-поиск по направлениям периметра, и
// каждое завершённое направление — настоящий факт, который можно показать
// («3 из 6»). Таймер используется только чтобы полоса не выглядела замёрзшей
// внутри одного шага, и никогда не может обогнать реальный этап.

export interface RunStage {
  id: RunStageId;
  label: string;
  /** Доля общего времени, которую занимает этап. Сумма по всем = 1. */
  weight: number;
}

export type RunStageId = 'plan' | 'search' | 'dedup' | 'save' | 'done';

export const RUN_STAGES: RunStage[] = [
  { id: 'plan', label: 'Формирую поисковые запросы', weight: 0.04 },
  { id: 'search', label: 'Ищу вакансии и компании с сигналами', weight: 0.86 },
  { id: 'dedup', label: 'Проверяю на дубли', weight: 0.06 },
  { id: 'save', label: 'Сохраняю найденное', weight: 0.04 },
];

/** Сколько примерно занимает один поисковый запрос с веб-поиском, секунд. */
export const DEFAULT_PER_ANGLE_SEC = 45;
/** Постоянные расходы: план, дедуп, запись. */
const OVERHEAD_SEC = 14;

/**
 * Оценка длительности прогона. Считается из ФАКТИЧЕСКОГО числа направлений и
 * параллелизма, а не берётся константой: узкий периметр ищется минуту, широкий
 * с шестью направлениями — несколько минут, и обещать одно и то же нельзя.
 */
export function estimateRunSeconds(
  angles: number,
  concurrency: number,
  perAngleSec = DEFAULT_PER_ANGLE_SEC,
): number {
  const n = Math.max(1, angles);
  const waves = Math.ceil(n / Math.max(1, concurrency));
  return Math.round(OVERHEAD_SEC + waves * perAngleSec);
}

function stageStart(id: RunStageId): number {
  let acc = 0;
  for (const s of RUN_STAGES) {
    if (s.id === id) return acc;
    acc += s.weight;
  }
  return 1;
}

function stageWeight(id: RunStageId): number {
  return RUN_STAGES.find(s => s.id === id)?.weight ?? 0;
}

export interface ProgressInput {
  stage: RunStageId;
  /** Завершённых направлений поиска (только для этапа search). */
  anglesDone?: number;
  anglesTotal?: number;
  /** Секунд с начала прогона — только чтобы полоса не стояла на месте. */
  elapsedSec?: number;
  estimateSec?: number;
}

export interface RunProgress {
  stage: RunStageId;
  label: string;
  /** 0..1 — то, что рисует полоса. */
  fraction: number;
  percent: number;
  elapsedSec: number;
  estimateSec: number;
  /** Сколько осталось по оценке; 0, когда прогон закончен. */
  remainingSec: number;
  /** «3 из 6 направлений» — если этап это позволяет. */
  detail: string | null;
}

export function runProgress(input: ProgressInput): RunProgress {
  const {
    stage, anglesDone = 0, anglesTotal = 0, elapsedSec = 0,
    estimateSec = estimateRunSeconds(anglesTotal || 1, 3),
  } = input;

  if (stage === 'done') {
    return {
      stage, label: 'Готово', fraction: 1, percent: 100,
      elapsedSec, estimateSec, remainingSec: 0, detail: null,
    };
  }

  const start = stageStart(stage);
  const weight = stageWeight(stage);
  let within = 0;
  let detail: string | null = null;

  if (stage === 'search' && anglesTotal > 0) {
    // Настоящий прогресс: доля завершённых направлений.
    within = Math.min(1, anglesDone / anglesTotal);
    detail = `${anglesDone} из ${anglesTotal} направлений`;
    // Внутри незавершённого направления даём полосе доползти до его границы по
    // времени, но НЕ дальше: обгонять реальный факт она не имеет права.
    if (anglesDone < anglesTotal && estimateSec > 0) {
      const byTime = Math.min(1, elapsedSec / estimateSec);
      const nextBoundary = Math.min(1, (anglesDone + 1) / anglesTotal);
      within = Math.max(within, Math.min(nextBoundary - 0.005, byTime));
    }
  } else if (estimateSec > 0) {
    const byTime = (elapsedSec / estimateSec - start) / (weight || 1);
    within = Math.max(0, Math.min(0.95, byTime));
  }

  const fraction = Math.max(0, Math.min(0.99, start + weight * within));
  const remaining = Math.max(0, Math.round(estimateSec * (1 - fraction)));
  return {
    stage,
    label: RUN_STAGES.find(s => s.id === stage)?.label ?? 'Работаю',
    fraction,
    percent: Math.round(fraction * 100),
    elapsedSec,
    estimateSec,
    remainingSec: remaining,
    detail,
  };
}

/** «около 2 минут», «около 40 секунд» — для подписи рядом с полосой. */
export function humanDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 45) return `около ${Math.max(5, Math.round(s / 5) * 5)} секунд`;
  const min = Math.round(s / 60);
  if (min <= 1) return 'около минуты';
  if (min < 5) return `около ${min} минут`;
  return `около ${Math.round(min)} минут`;
}

/** Событие, которое воркер стримит клиенту по ходу прогона. */
export interface RunEvent {
  stage: RunStageId;
  anglesDone?: number;
  anglesTotal?: number;
  estimateSec?: number;
  /** Заполняется на завершающем событии. */
  found?: number;
  added?: number;
  error?: string;
  /** Что случилось с каждым направлением — видно, почему найдено мало или ноль. */
  notes?: string[];
}

/** Итог одного прохода одного направления поиска. */
export interface AngleOutcome {
  angle: string;
  /** vacancies — только сайты вакансий и ATS; signals — гипотезы по сигналам. */
  pass?: 'vacancies' | 'signals';
  /** Из сохранённого: сколько вакансий и сколько гипотез. */
  vacancies?: number;
  hypotheses?: number;
  /** Что модель искала и откуда пришли результаты — без этого не понять «одни гипотезы». */
  queries?: string[];
  domains?: string[];
  /** Сколько мест вернула модель. */
  returned: number;
  /** Сколько из них прошло санитайз (гипотеза без даты и ссылки отбрасывается, §10.3). */
  kept: number;
  error?: string;
}

/**
 * Строки для экрана: по одной на направление. Без них прогон с нулём
 * неотличим от прогона, где упал каждый запрос, — а это разные поломки.
 */
export function describeAngleOutcomes(outcomes: AngleOutcome[]): string[] {
  return outcomes.map(o => {
    const pass = o.pass === 'vacancies' ? ' · вакансии' : o.pass === 'signals' ? ' · сигналы' : '';
    const name = `«${o.angle.length > 60 ? o.angle.slice(0, 60) + '…' : o.angle}»${pass}`;
    return `${name}: ${outcomeText(o)}${traceText(o)}`;
  });
}

function outcomeText(o: AngleOutcome): string {
  if (o.error) return `ошибка — ${o.error}`;
  if (!o.returned) return 'модель не нашла ни одного места';
  const split = o.vacancies != null && o.hypotheses != null
    ? ` (вакансий ${o.vacancies}, гипотез ${o.hypotheses})` : '';
  const dropped = o.returned - o.kept;
  if (!dropped) return `найдено ${o.kept}${split}`;
  return `модель вернула ${o.returned}, отброшено ${dropped} `
    + `(гипотеза без датированного сигнала и ссылки или без компании и роли)${split}`;
}

function traceText(o: AngleOutcome): string {
  const parts: string[] = [];
  if (o.queries?.length) parts.push(`запросы: ${o.queries.slice(0, 4).map(q => `«${q}»`).join(', ')}`);
  if (o.domains?.length) parts.push(`источники: ${o.domains.slice(0, 6).join(', ')}`);
  else if (o.queries) parts.push('источников нет');
  return parts.length ? `. ${parts.join('; ')}` : '';
}

/** Запросы и домены источников из output ответа Responses API — без текста страниц. */
export function searchTrace(output: unknown): { queries: string[]; domains: string[] } {
  const queries: string[] = [];
  const domains = new Map<string, number>();
  const addUrl = (u: unknown) => {
    if (typeof u !== 'string') return;
    try {
      const host = new URL(u).hostname.replace(/^www\./, '');
      domains.set(host, (domains.get(host) ?? 0) + 1);
    } catch { /* не URL */ }
  };
  for (const item of Array.isArray(output) ? output : []) {
    const it = (item ?? {}) as { type?: string; action?: Record<string, unknown>; content?: unknown[] };
    if (it.type === 'web_search_call' && it.action) {
      const a = it.action;
      if (typeof a.query === 'string' && a.query.trim()) queries.push(a.query.trim());
      if (Array.isArray(a.queries)) for (const q of a.queries) if (typeof q === 'string') queries.push(q);
      addUrl(a.url);
      if (Array.isArray(a.sources)) for (const s of a.sources) addUrl((s as { url?: unknown })?.url);
    }
    if (it.type === 'message' && Array.isArray(it.content)) {
      for (const c of it.content) {
        const ann = (c as { annotations?: { url?: unknown }[] })?.annotations;
        if (Array.isArray(ann)) for (const x of ann) addUrl(x?.url);
      }
    }
  }
  // Чаще встречающиеся источники — первыми.
  const sorted = [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  return { queries: [...new Set(queries)], domains: sorted };
}
