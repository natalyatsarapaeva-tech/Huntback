// Как поднять совпадение (§10.4 в редакции 1.3). Модель предлагает правку,
// ядро решает, честная ли она, и считает, сколько она даёт.
//
// Главный принцип: правка не может добавить опыт. Формулировка (`wording`)
// меняет слова, но не числа — каждое её число обязано быть в исходном факте
// или в профиле. Иначе это не «другие слова», а новое утверждение, и оно
// превращается в вопрос пользователю.

import type {
  Expectation, ExpectationFix, Fact, FactReview, GapReason, Strength, Profile, FixScope,
} from './types.ts';
import { computeScore } from './score.ts';
import { extractNumbers, normalize } from './text.ts';

const STRENGTH_RANK: Record<Strength, number> = { gap: 0, partial: 1, strong: 2 };
const REASONS: GapReason[] = ['wording', 'missing_fact', 'real_gap'];
const STRENGTHS: Strength[] = ['strong', 'partial', 'gap'];

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Все значимые числа текста. Однозначные — шум («2 sites», «1 of 25»), но их тоже сверяем. */
function numbersOf(text: string): string[] {
  return extractNumbers(text).map(n => n.replace(/^0+(?=\d)/, ''));
}

/**
 * Числа `text`, которых нет в источниках. Сверка строгая по значению, но
 * терпимая к записи: «620K» и «620 000» — разные строки, поэтому «K/M» в
 * источнике раскрываются.
 */
export function unbackedNumbers(text: string, sources: string[]): string[] {
  const known = new Set<string>();
  for (const s of sources) {
    for (const n of numbersOf(s)) known.add(n);
    // «EUR 4.2M» → 4.2, 4200000; «620K» → 620, 620000
    for (const m of String(s).matchAll(/(\d+(?:[.,]\d+)?)\s*([kKmM])\b/g)) {
      const v = Number(m[1].replace(',', '.')) * (/[kK]/.test(m[2]) ? 1e3 : 1e6);
      known.add(String(Math.round(v)));
    }
  }
  return [...new Set(numbersOf(text))].filter(n => !known.has(n));
}

/** Текст профиля и банка фактов — всё, чем можно подтвердить число. */
export function evidenceCorpus(profile: Profile | null | undefined, facts: Fact[]): string[] {
  return [
    profile?.resume_text ?? '', profile?.extras_text ?? '',
    ...facts.flatMap(f => [f.action, f.how ?? '', f.result ?? '', f.user_input ?? '', ...(f.wordings ?? []),
      f.metric_value != null ? String(f.metric_value) : '']),
  ];
}

/**
 * Приведение правки от модели. Правило честности: формулировка с числом, которого
 * нет ни в факте, ни в профиле, — не формулировка; она становится вопросом.
 */
export function sanitizeFix(
  raw: unknown, e: Pick<Expectation, 'strength' | 'fact_id'>, facts: Fact[], profile?: Profile | null,
): ExpectationFix | null {
  if (e.strength === 'strong') return null;
  const o = (raw || {}) as Record<string, unknown>;
  let reason = (REASONS as string[]).includes(String(o.reason)) ? (o.reason as GapReason) : null;
  if (!reason) return null;
  const known = new Set(facts.map(f => f.id));
  let fact_id = str(o.fact_id, 64) || e.fact_id || null;
  if (fact_id && !known.has(fact_id)) fact_id = null;
  let rewrite = str(o.rewrite, 500);
  let question = str(o.question, 400);
  let strength_after = (STRENGTHS as string[]).includes(String(o.strength_after))
    ? (o.strength_after as Strength) : 'partial';

  if (reason === 'wording') {
    const unbacked = rewrite ? unbackedNumbers(rewrite, evidenceCorpus(profile, facts)) : ['∅'];
    if (!rewrite || unbacked.length) {
      // Число из ниоткуда: спрашиваем, а не утверждаем.
      reason = 'missing_fact';
      // Выдуманную формулировку пользователю НЕ показываем даже как вопрос:
      // «Верно ли, что вы руководили 140 людьми?» подсказывает число, которого
      // никто не называл. Спрашиваем нейтрально, своими словами пользователя.
      question = question || 'Do you have experience that matches this? Describe it in a sentence or two, with the real numbers.';
      rewrite = '';
    }
  }
  if (reason === 'missing_fact' && !question) {
    question = 'Do you have experience that matches this? Describe it in a sentence or two, with numbers if you have them.';
  }
  if (reason === 'real_gap') { rewrite = ''; question = ''; strength_after = e.strength; }
  // Правка не может ухудшить совпадение.
  if (STRENGTH_RANK[strength_after] < STRENGTH_RANK[e.strength]) strength_after = e.strength;
  return { reason, fact_id, rewrite, question, strength_after, status: 'open' };
}

export interface MatchPotential {
  now: number;
  /** Если принять все формулировки — без модели и без новых фактов. */
  afterWording: number;
  /** Если ещё и ответить «да» на все вопросы. */
  afterAnswers: number;
  wordingFixes: number;
  questions: number;
  realGaps: number;
}

/** Сколько даёт каждая ступень. Прогноз, а не обещание: ответ может быть «нет». */
export function matchPotential(expectations: Expectation[]): MatchPotential {
  const list = expectations || [];
  const open = (e: Expectation, r: GapReason) => e.fix?.status === 'open' && e.fix.reason === r;
  const lift = (e: Expectation, reasons: GapReason[]): Expectation =>
    reasons.some(r => open(e, r)) ? { ...e, strength: e.fix!.strength_after } : e;
  return {
    now: computeScore(list),
    afterWording: computeScore(list.map(e => lift(e, ['wording']))),
    afterAnswers: computeScore(list.map(e => lift(e, ['wording', 'missing_fact']))),
    wordingFixes: list.filter(e => open(e, 'wording')).length,
    questions: list.filter(e => open(e, 'missing_fact')).length,
    realGaps: list.filter(e => e.fix?.reason === 'real_gap' || (e.strength === 'gap' && !e.fix)).length,
  };
}

/**
 * Принять формулировку: ожидание закрывается тем же фактом, но в словах
 * работодателя. Банк фактов не меняется — формулировка живёт в разборе этого
 * места и через `evidence` попадает к писателю резюме и письма.
 */
export function applyWordingFix(e: Expectation, scope: FixScope = 'place'): Expectation {
  if (!e.fix || e.fix.reason !== 'wording' || e.fix.status !== 'open') return e;
  // «Переиспользовать» без факта некуда сохранить — остаётся правкой этого места.
  const s: FixScope = scope === 'reuse' && e.fix.fact_id ? 'reuse' : 'place';
  return {
    ...e,
    strength: e.fix.strength_after,
    evidence: e.fix.rewrite,
    fact_id: e.fix.fact_id ?? e.fact_id,
    gap_class: e.fix.strength_after === 'strong' ? null : e.gap_class,
    fix: { ...e.fix, status: 'applied', scope: s },
  };
}

/** Уже принятую «для этого места» формулировку — ещё и в банк фактов. */
export function reuseAppliedFix(e: Expectation): Expectation {
  if (!e.fix || e.fix.reason !== 'wording' || e.fix.status !== 'applied' || !e.fix.fact_id) return e;
  return { ...e, fix: { ...e.fix, scope: 'reuse' } };
}

export function applyAllWordingFixes(list: Expectation[], scope: FixScope = 'place'): { expectations: Expectation[]; applied: number } {
  let applied = 0;
  const expectations = list.map(e => {
    const n = applyWordingFix(e, scope);
    if (n !== e) applied++;
    return n;
  });
  return { expectations, applied };
}

/**
 * Формулировки, которые надо сохранить в банк: fact_id → тексты. Только
 * переиспользуемые и только с существующим фактом.
 */
export function wordingsToSave(list: Expectation[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of list) {
    const f = e.fix;
    if (f?.reason === 'wording' && f.status === 'applied' && f.scope === 'reuse' && f.fact_id && f.rewrite) {
      out.set(f.fact_id, [...(out.get(f.fact_id) ?? []), f.rewrite]);
    }
  }
  return out;
}

/** Максимум альтернативных формулировок у одного факта: больше — шум в промпте. */
export const MAX_WORDINGS = 5;

/**
 * Добавить формулировку к факту. Без дублей (в том числе с исходным текстом
 * факта), новые — в конец, старые вытесняются при переполнении. Возвращает
 * null, если менять нечего.
 */
export function addWording(f: Fact, text: string): string[] | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const key = normalize(t);
  const own = normalize([f.action, f.how, f.result].filter(Boolean).join(' '));
  const cur = f.wordings ?? [];
  if (key === own || cur.some(w => normalize(w) === key)) return null;
  return [...cur, t].slice(-MAX_WORDINGS);
}

export function dismissFix(e: Expectation): Expectation {
  return e.fix ? { ...e, fix: { ...e.fix, status: 'dismissed' } } : e;
}

/** Ответ пользователя закрыл ожидание: новый факт и оценка переоценки. */
export function applyAnsweredFix(
  e: Expectation, answer: string, verdict: { strength: Strength; evidence: string; fact_id: string | null },
): Expectation {
  const strength = STRENGTH_RANK[verdict.strength] >= STRENGTH_RANK[e.strength] ? verdict.strength : e.strength;
  return {
    ...e,
    strength,
    evidence: verdict.evidence || e.evidence,
    fact_id: verdict.fact_id ?? e.fact_id,
    gap_class: strength === 'strong' ? null : e.gap_class,
    fix: e.fix ? { ...e.fix, status: 'answered', answer } : null,
  };
}

// ── Разбор фактов ───────────────────────────────────────────────────────────

/**
 * Вопрос по шаблону — когда модель не предложила своего, а у факта нет числа.
 * Вопрос конкретный: «сколько», а не «расскажите подробнее».
 */
export function defaultFactQuestion(f: Fact): string {
  const t = new Set(f.scale_tags);
  const a = normalize(f.action);
  if (t.has('team') || t.has('managers') || /\b(team|hired|grew|built|led|managed)\b/.test(a)) {
    return 'How many people were involved — on your team and reporting to you? Any managers among them?';
  }
  if (t.has('budget') || t.has('pnl') || /\b(budget|cost|saving|revenue|p l|spend)\b/.test(a)) {
    return 'What was the money involved — budget, savings or revenue — and over what period?';
  }
  if (t.has('geo')) return 'How many countries, sites or markets did this cover?';
  if (/\b(launch|introduc|implement|rolled out|migrat|moved)\w*/.test(a)) {
    return 'What changed after it went live, in numbers — time, cost, volume or errors — and how fast did you deliver it?';
  }
  return 'What was the measurable result — a percentage, an amount, a time saved — compared with before?';
}

/** Подсказка аудита к факту, с проверкой честности формулировки. */
export function sanitizeFactReview(raw: unknown, f: Fact, sources: string[]): FactReview {
  const o = (raw || {}) as Record<string, unknown>;
  const kind = o.kind === 'rewrite' || o.kind === 'question' || o.kind === 'ok' ? o.kind : null;
  const r = (o.rewrite || {}) as Record<string, unknown>;
  const rewrite = { action: str(r.action, 300), how: str(r.how, 400), result: str(r.result, 400) };
  const why = str(o.why, 300);
  let question = str(o.question, 400);
  const rewriteText = [rewrite.action, rewrite.how, rewrite.result].join(' ');
  const rewriteOk = !!rewrite.action && !unbackedNumbers(rewriteText, [...sources, f.action, f.how ?? '', f.result ?? '']).length;

  if (kind === 'rewrite' && rewriteOk) {
    return { kind: 'rewrite', question: f.quantified ? '' : (question || defaultFactQuestion(f)), rewrite, why, status: 'pending' };
  }
  if (kind === 'ok' && f.quantified) return { kind: 'ok', question: '', rewrite: null, why, status: 'pending' };
  // Без числа факт всегда получает вопрос: это главный рычаг на скрининге.
  if (!f.quantified || kind === 'question' || kind === 'rewrite') {
    question = question || defaultFactQuestion(f);
    return { kind: 'question', question, rewrite: rewriteOk ? rewrite : null, why, status: 'pending' };
  }
  return { kind: 'ok', question: '', rewrite: null, why, status: 'pending' };
}

/** Порядок разбора: сначала без числа и неподтверждённые — там больше всего пользы. */
export function factReviewQueue(facts: Fact[]): Fact[] {
  const score = (f: Fact) => (f.review?.status === 'pending' || !f.review ? 0 : 10)
    + (f.confirmed ? 4 : 0) + (f.quantified ? 2 : 0) + (f.review?.kind === 'ok' ? 1 : 0);
  return [...facts].sort((a, b) => score(a) - score(b));
}
