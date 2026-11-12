// Доведение документов и профиля до ума: проверяющий, коуч, переписывание
// фактов по ответам. Всё, что можно проверить кодом, проверяется кодом —
// модель предлагает, ядро решает, честно ли это.

import {
  type Analysis, type Fact, type Opportunity, type Profile, type CheckResult, type ReviewIssue,
  type ReviewRound, type DocumentReview, type ResumeDoc, type LetterDoc, type CoachMessage,
  type CoachProposal, type CoachTopic, type Expectation, type Strength, type ScaleTag,
  REVIEW_ISSUE_TYPES, SCALE_TAGS, resumeText, normalize, unbackedNumbers, evidenceCorpus,
  sourceHintFound, coachAgenda,
} from '@huntback/core';
import { uid } from './env.ts';
import { callModel } from './ai.ts';
import { getPrompt, fillPrompt } from './prompts.ts';
import { REVIEW_SCHEMA, COACH_SCHEMA, REFINE_FACT_SCHEMA, RESCORE_SCHEMA } from './schemas.ts';
import { type Ctx, type Revision, stableContext } from './operations.ts';

// ── Проверяющий ─────────────────────────────────────────────────────────────

/** Событие прогресса генерации документа: что сейчас происходит и сколько замечаний. */
export interface DocEvent {
  stage: 'draft' | 'review' | 'revise' | 'final' | 'done';
  round?: number;
  issues?: number;
  message?: string;
  error?: string;
  result?: unknown;
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Цитата проверяющего обязана быть в документе: замечание к несуществующей
 * фразе — это галлюцинация проверяющего, и писатель, исправляя её, испортил
 * бы годный текст.
 */
function quoteInDocument(quote: string, doc: string): boolean {
  const q = normalize(quote);
  if (!q) return false;
  return normalize(doc).includes(q) || sourceHintFound(doc, quote, 0.25);
}

export function sanitizeReview(raw: unknown, docText: string, round: number, codeIssues: string[]): ReviewRound {
  const o = (raw || {}) as Record<string, unknown>;
  const issues: ReviewIssue[] = (Array.isArray(o.issues) ? o.issues : []).map(x => {
    const i = (x || {}) as Record<string, unknown>;
    const type = (REVIEW_ISSUE_TYPES as string[]).includes(String(i.type)) ? i.type as ReviewIssue['type'] : 'other';
    return {
      type, quote: str(i.quote, 400), problem: str(i.problem, 400), fix: str(i.fix, 500),
      severity: (i.severity === 'high' ? 'high' : 'low') as ReviewIssue['severity'],
    };
  }).filter(i => i.problem && quoteInDocument(i.quote, docText)).slice(0, 15);
  const verdict = issues.some(i => i.severity === 'high') || o.verdict === 'revise' && issues.length ? 'revise' : 'pass';
  return { round, verdict, issues, code_issues: codeIssues };
}

/** Замечания кода, которые писатель может исправить сам. Подсказки info — нет. */
export function fixableCodeIssues(checks: CheckResult[]): string[] {
  return checks
    .filter(c => c.level === 'block' || c.level === 'warn')
    .filter(c => c.rule !== 'spelling')
    .map(c => `[${c.rule}] ${c.message}`);
}

export function commentsFor(round: ReviewRound): string[] {
  return [
    ...round.issues.map(i => `[${i.type}${i.severity === 'high' ? ', must fix' : ''}] “${i.quote}” — ${i.problem}. Fix: ${i.fix}`),
    ...round.code_issues,
  ];
}

export interface ReviewTarget {
  kind: 'resume' | 'letter';
  target: string;
  expectations: string;
  extra: string;
}

export async function runReview(
  ctx: Ctx, profile: Profile, facts: Fact[], t: ReviewTarget, docText: string, codeIssues: string[], round: number,
): Promise<ReviewRound> {
  const { data } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'review',
    prefix: stableContext(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'review'), {
      KIND: t.kind === 'resume' ? 'tailored resume' : 'cover letter',
      TARGET: t.target, EXPECTATIONS: t.expectations, EXTRA: t.extra,
      DOCUMENT: docText,
      CODE_ISSUES: codeIssues.length ? codeIssues.map(c => '- ' + c).join('\n') : '- none',
    }),
    schema: REVIEW_SCHEMA, temperature: 0, maxOutputTokens: 3000,
  });
  return sanitizeReview(data, docText, round, codeIssues);
}

interface Draft<D> { doc: D; checks: CheckResult[]; model: string; degraded: boolean }

/**
 * Писатель → проверяющий → писатель → проверяющий (→ писатель).
 *
 * Два ревью всегда: так пользователь видит текст, который критиковали дважды.
 * Переписываний — от нуля до двух: если проверяющий и код молчат, текст не
 * трогается (переписывание без причины только портит). Третьего ревью нет
 * намеренно: цикл обязан закончиться, а остаток замечаний второго ревью
 * писатель уже получил.
 */
export async function writeReviewed<D>(opts: {
  write: (rev?: Revision) => Promise<Draft<D>>;
  text: (d: D) => string;
  review: (text: string, codeIssues: string[], round: number) => Promise<ReviewRound>;
  onEvent?: (e: DocEvent) => void;
}): Promise<Draft<D> & { review: DocumentReview }> {
  const say = opts.onEvent ?? (() => {});
  say({ stage: 'draft', message: 'Writing the first draft' });
  let draft = await opts.write();
  const rounds: ReviewRound[] = [];
  let rewrites = 0;

  for (let round = 1; round <= 2; round++) {
    say({ stage: 'review', round, message: `Reviewer, round ${round}: checking facts, repeats, clichés and AI-isms` });
    let r: ReviewRound;
    try {
      r = await opts.review(opts.text(draft.doc), fixableCodeIssues(draft.checks), round);
    } catch {
      // Проверяющий — улучшение, а не условие показа: его отказ не должен
      // отнимать у пользователя готовый черновик. Но это видно в отчёте.
      r = { round, verdict: 'pass', issues: [], code_issues: fixableCodeIssues(draft.checks) };
      rounds.push(r);
      say({ stage: 'review', round, issues: 0, message: `Reviewer, round ${round}: unavailable — kept the draft` });
      continue;
    }
    rounds.push(r);
    const comments = commentsFor(r);
    say({ stage: 'review', round, issues: comments.length, message: `Reviewer, round ${round}: ${comments.length} remark${comments.length === 1 ? '' : 's'}` });
    if (!comments.length) continue;
    say({ stage: 'revise', round, message: `Rewriting to address ${comments.length} remark${comments.length === 1 ? '' : 's'}` });
    try {
      draft = await opts.write({ previous: opts.text(draft.doc), comments });
      rewrites++;
    } catch {
      // Переписать не вышло — остаётся предыдущий черновик, замечания видны.
      break;
    }
  }
  say({ stage: 'final', message: 'Final checks' });
  return { ...draft, review: { rounds, rewrites } };
}

// ── Текст документа для проверяющего ────────────────────────────────────────
export function resumeForReview(doc: ResumeDoc): string {
  let n = 0;
  return [
    doc.headline,
    ...(doc.summary || []).map(s => 'Summary: ' + s),
    'Facts line: ' + doc.facts_line,
    'Competencies: ' + (doc.competencies || []).join(', '),
    ...(doc.experience || []).flatMap(r => [
      `${r.role_title} — ${r.company} (${r.period_from} – ${r.period_to ?? 'present'}) ${r.context_line}`,
      ...(r.bullets || []).map(b => `  ${++n}. ${b}`),
    ]),
    ...(doc.education || []),
  ].filter(Boolean).join('\n');
}

export function letterForReview(doc: LetterDoc): string {
  return `Subject: ${doc.subject}\n\n${doc.body}`;
}

export const resumePlain = (d: ResumeDoc) => resumeText(d);

export function reviewTargetFor(kind: 'resume' | 'letter', opp: Opportunity | null, analysis: Analysis | null, perimeter = ''): ReviewTarget {
  return {
    kind,
    target: opp ? `${opp.company} · ${opp.role_title}` : `master resume for: ${perimeter}`,
    expectations: (analysis?.expectations ?? []).map(e => `[${e.weight}] ${e.expectation} -> ${e.evidence}`).join('\n') || 'none (general resume)',
    extra: opp ? [opp.signal ? 'Signal: ' + opp.signal : '', opp.jd_text ? 'Posting (excerpt): ' + opp.jd_text.slice(0, 3000) : ''].filter(Boolean).join('\n') : '',
  };
}

// ── Факт по ответу пользователя ─────────────────────────────────────────────

const tags = (v: unknown): ScaleTag[] => (Array.isArray(v) ? v : [])
  .filter((t): t is ScaleTag => (SCALE_TAGS as string[]).includes(String(t)));
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Переписать факт с учётом ответа. Любое число, которого нет ни в факте,
 * ни в ответе, ни в профиле, — отказ: модель добавила то, чего человек не говорил.
 */
export async function runRefineFact(ctx: Ctx, profile: Profile, facts: Fact[], f: Fact, answer: string): Promise<Partial<Fact>> {
  const question = f.review?.question ?? '';
  const { data } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'refine',
    prefix: 'You rewrite one resume fact from the candidate\'s answer. Answer strictly by the schema, in English.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'refine'), {
      FACT: [f.action, f.how, f.result].filter(Boolean).join(' · '),
      QUOTE: f.source_hint, QUESTION: question || 'What was the measurable result?', ANSWER: answer,
    }),
    schema: REFINE_FACT_SCHEMA, temperature: 0, maxOutputTokens: 800,
  });
  const next = {
    action: str(data.action, 300) || f.action,
    how: str(data.how, 400),
    result: str(data.result, 400),
    metric_value: numOrNull(data.metric_value),
    metric_unit: str(data.metric_unit, 40) || null,
    scale_tags: tags(data.scale_tags).length ? tags(data.scale_tags) : f.scale_tags,
  };
  const sources = [answer, f.action, f.how ?? '', f.result ?? '', f.source_hint, f.user_input ?? '', ...evidenceCorpus(profile, [])];
  const extra = unbackedNumbers([next.action, next.how, next.result, next.metric_value ?? ''].join(' '), sources);
  if (extra.length) {
    // Не «подправляем» молча: число из ниоткуда — это ошибка, о ней надо сказать.
    throw new Error(`The rewrite added numbers you did not give (${extra.join(', ')}). Try answering with the exact figure.`);
  }
  return {
    ...next,
    user_input: [f.user_input, answer].filter(Boolean).join('\n'),
    confirmed: true,
    review: f.review ? { ...f.review, status: 'answered' } : null,
  };
}

/** Ответ на вопрос разбора места: годится ли он и каким фактом он станет. */
export async function runRescore(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, e: Expectation, answer: string,
): Promise<{ relevant: boolean; strength: Strength; evidence: string; fact: Fact | null }> {
  const { data } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'refine',
    prefix: 'You judge whether a candidate\'s answer meets one employer expectation. Be honest; answer by the schema in English.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'rescore'), {
      EXPECTATION: e.expectation, WEIGHT: e.weight, QUESTION: e.fix?.question ?? '',
      ANSWER: answer, OPPORTUNITY: `${opp.company} · ${opp.role_title}`,
    }),
    schema: RESCORE_SCHEMA, temperature: 0, maxOutputTokens: 900,
  });
  const relevant = data.relevant === true;
  const strength = (['strong', 'partial', 'gap'] as const).includes(data.strength as Strength) ? data.strength as Strength : 'gap';
  const rf = (data.fact || {}) as Record<string, unknown>;
  const action = str(rf.action, 300);
  let fact: Fact | null = null;
  if (relevant && action) {
    const text = [action, str(rf.how, 400), str(rf.result, 400)].join(' ');
    const extra = unbackedNumbers(text + ' ' + (numOrNull(rf.metric_value) ?? ''), [answer, ...evidenceCorpus(profile, facts)]);
    const metric = numOrNull(rf.metric_value);
    fact = {
      id: uid(), company: str(rf.company, 160) || undefined, role_title: str(rf.role_title, 160) || undefined,
      action, how: str(rf.how, 400) || undefined, result: str(rf.result, 400) || undefined,
      metric_value: extra.length ? null : metric, metric_unit: str(rf.metric_unit, 40) || null,
      scale_tags: tags(rf.scale_tags), domain_tags: [],
      quantified: !extra.length && (metric != null || /\d/.test(str(rf.result, 400))),
      source_hint: (str(rf.user_quote, 200) && sourceHintFound(answer, str(rf.user_quote, 200), 0.3)) ? str(rf.user_quote, 200) : answer.slice(0, 120),
      confirmed: true, review: null, user_input: answer,
    };
    if (extra.length) return { relevant: false, strength: e.strength, evidence: e.evidence, fact: null };
  }
  return { relevant, strength: relevant ? strength : e.strength, evidence: str(data.evidence, 400), fact };
}

// ── Коуч ────────────────────────────────────────────────────────────────────

export interface CoachTurn {
  reply: string;
  topic_id: string;
  topic_done: boolean;
  proposals: CoachProposal[];
}

function agendaText(agenda: CoachTopic[]): string {
  return agenda.slice(0, 8).map(t => `${t.id} · ${t.title} · ${t.goal}`).join('\n');
}

/**
 * Один ход чата. Предложения проверяются: факт держится на ДОСЛОВНЫХ словах
 * пользователя, его числа — из этих слов или из профиля. Всё остальное
 * отбрасывается молча: лучше потерять предложение, чем приписать человеку
 * то, чего он не говорил.
 */
export async function runCoachTurn(
  ctx: Ctx, profile: Profile, facts: Fact[], history: CoachMessage[], message: string,
  agenda: CoachTopic[], currentTopic: string | null,
): Promise<CoachTurn> {
  const topic = agenda.find(t => t.id === currentTopic) ?? agenda[0];
  const userWords = [...history.filter(m => m.role === 'user').map(m => m.text), message].join('\n');
  const { data } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'coach',
    prefix: stableContext(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'coach'), {
      PERIMETER: profile.perimeter || 'not set yet',
      AGENDA: agendaText(agenda),
      TOPIC: topic ? `${topic.id} · ${topic.title}` : 'none',
      HISTORY: history.slice(-12).map(m => `${m.role === 'coach' ? 'Coach' : 'Candidate'}: ${m.text}`).join('\n') || '(start of the conversation)',
      MESSAGE: message || (history.length
        ? '(no answer — the candidate resolved the previous topic elsewhere; ask the next question)'
        : '(the candidate opened the coach — greet briefly and ask the first question)'),
    }),
    schema: COACH_SCHEMA, temperature: 0.3, maxOutputTokens: 2000,
  });

  const sources = [userWords];
  const proposals: CoachProposal[] = [];
  const quoteOk = (q: string) => !!q && sourceHintFound(message || userWords, q, 0.3);

  for (const raw of Array.isArray(data.new_facts) ? data.new_facts : []) {
    const r = (raw || {}) as Record<string, unknown>;
    const action = str(r.action, 300);
    const quote = str(r.user_quote, 300);
    if (!action || !quoteOk(quote)) continue;
    const text = [action, str(r.how, 400), str(r.result, 400)].join(' ');
    if (unbackedNumbers(text + ' ' + (numOrNull(r.metric_value) ?? ''), [...sources, ...evidenceCorpus(profile, facts)]).length) continue;
    const metric = numOrNull(r.metric_value);
    proposals.push({
      id: uid(), kind: 'new_fact', status: 'open',
      label: [action, str(r.result, 400)].filter(Boolean).join(' — '),
      fact: {
        company: str(r.company, 160) || undefined, role_title: str(r.role_title, 160) || undefined,
        action, how: str(r.how, 400) || undefined, result: str(r.result, 400) || undefined,
        metric_value: metric, metric_unit: str(r.metric_unit, 40) || null,
        scale_tags: tags(r.scale_tags), domain_tags: [],
        quantified: metric != null || /\d/.test(str(r.result, 400)),
        source_hint: quote, user_input: quote,
      },
    });
  }

  const byId = new Map(facts.map(f => [f.id, f]));
  for (const raw of Array.isArray(data.fact_updates) ? data.fact_updates : []) {
    const r = (raw || {}) as Record<string, unknown>;
    const f = byId.get(str(r.fact_id, 64));
    const quote = str(r.user_quote, 300);
    if (!f || !quoteOk(quote)) continue;
    const next = {
      action: str(r.action, 300) || f.action, how: str(r.how, 400) || f.how, result: str(r.result, 400) || f.result,
      metric_value: numOrNull(r.metric_value) ?? f.metric_value ?? null, metric_unit: str(r.metric_unit, 40) || f.metric_unit || null,
    };
    const text = [next.action, next.how, next.result, next.metric_value ?? ''].join(' ');
    if (unbackedNumbers(text, [...sources, f.action, f.how ?? '', f.result ?? '', f.user_input ?? '', ...evidenceCorpus(profile, [])]).length) continue;
    proposals.push({
      id: uid(), kind: 'update_fact', status: 'open', fact_id: f.id,
      label: `Update “${f.action}” → ${[next.action, next.result].filter(Boolean).join(' — ')}`,
      fact: { ...next, user_input: [f.user_input, quote].filter(Boolean).join('\n') },
    });
  }

  const pu = (data.profile_updates || {}) as Record<string, unknown>;
  const said = (n: number | null) => n != null && !unbackedNumbers(String(n), [message, ...sources]).length;
  const patch: Partial<Profile> = {};
  const labels: string[] = [];
  const scale = { ...(profile.scale ?? {}) };
  let scaleChanged = false;
  for (const [k, label] of [['team_max', 'team'], ['managers_max', 'managers'], ['budget_max', 'budget']] as const) {
    const v = numOrNull(pu[k]);
    if (v != null && said(v)) { (scale as Record<string, unknown>)[k] = v; scaleChanged = true; labels.push(`${label} ${v.toLocaleString('en')}`); }
  }
  if (str(pu.geo_scope, 120)) { scale.geo_scope = str(pu.geo_scope, 120); scaleChanged = true; labels.push(`scope ${scale.geo_scope}`); }
  if (scaleChanged) patch.scale = scale;
  const langs = (Array.isArray(pu.languages) ? pu.languages : []) as { lang?: string; cefr?: string }[];
  if (langs.length) {
    const merged = [...profile.languages];
    for (const l of langs) {
      if (!l.lang || !l.cefr) continue;
      const i = merged.findIndex(x => normalize(x.lang) === normalize(l.lang!));
      const item = { lang: String(l.lang), cefr: l.cefr as Profile['languages'][number]['cefr'] };
      if (i >= 0) merged[i] = item; else merged.push(item);
      labels.push(`${l.lang} ${l.cefr}`);
    }
    patch.languages = merged;
  }
  const auth = (Array.isArray(pu.work_auth) ? pu.work_auth : []) as { region?: string; status?: string }[];
  if (auth.length) {
    const merged = [...profile.work_auth];
    for (const a of auth) {
      if (!a.region || !a.status) continue;
      const i = merged.findIndex(x => normalize(x.region) === normalize(a.region!));
      const item = { region: String(a.region), status: a.status as Profile['work_auth'][number]['status'] };
      if (i >= 0) merged[i] = item; else merged.push(item);
      labels.push(`work: ${a.region} (${a.status.replace('_', ' ')})`);
    }
    patch.work_auth = merged;
  }
  if (pu.relocation === 'yes' || pu.relocation === 'no' || pu.relocation === 'conditional') {
    patch.relocation = { ready: pu.relocation, package_needed: profile.relocation?.package_needed ?? false };
    labels.push(`relocation: ${pu.relocation}`);
  }
  const gapReason = str(pu.gap_reason, 200);
  if (gapReason && topic?.kind === 'gap_reason') {
    const from = topic.id.replace(/^gap:/, '');
    patch.gaps = profile.gaps.map(g => (g.from === from ? { ...g, reason: gapReason } : g));
    labels.push(`gap: ${gapReason}`);
  }
  if (str(pu.perimeter, 300)) { patch.perimeter = str(pu.perimeter, 300); labels.push(`target roles: ${patch.perimeter}`); }
  if (Object.keys(patch).length) {
    proposals.push({ id: uid(), kind: 'profile', status: 'open', label: 'Profile: ' + labels.join(', '), profile: patch });
  }

  const known = new Set(agenda.map(t => t.id));
  return {
    reply: str(data.reply, 1500) || 'Thanks. Let’s continue.',
    topic_id: known.has(str(data.topic_id, 120)) ? str(data.topic_id, 120) : (topic?.id ?? ''),
    topic_done: data.topic_done === true,
    proposals,
  };
}

export { coachAgenda };
