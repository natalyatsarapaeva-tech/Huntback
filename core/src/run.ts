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
}
