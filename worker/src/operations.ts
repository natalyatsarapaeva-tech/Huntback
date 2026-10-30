// AI-операции: сборка контекста, callModel, санитайз, валидация правилами.
// Всё, что можно посчитать без модели, считается без неё.

import {
  type Analysis, type Fact, type Opportunity, type Profile, type HuntbackConfig,
  type Demand, type CheckContext, type FormatVariant, type AngleOutcome, type DiscoverItem,
  sanitizeAnalysis, sanitizeFact, sanitizeIngest, sanitizeResume, sanitizeLetter,
  sanitizeDiscoverItem, computeScore, reconcileBlockers, demoteUnverified,
  sourceHintFound, auditProfile, checkResume, checkLetter, applySwapResult, parseCefr,
} from '@huntback/core';
import { type Env, ApiError, uid } from './env.ts';
import { callModel, mapWithConcurrency } from './ai.ts';
import { getPrompt, fillPrompt } from './prompts.ts';
import {
  ANALYSE_SCHEMA, AUDIT_SCHEMA, RESUME_SCHEMA, LETTER_SCHEMA,
  INGEST_SCHEMA, DISCOVER_SCHEMA, CLASSIFY_SCHEMA, SWAP_SCHEMA,
} from './schemas.ts';

export interface Ctx {
  env: Env; cfg: HuntbackConfig; prompts: Record<string, string>; userId: string;
}

/**
 * Стабильный префикс промпта: профиль и банк фактов в неизменном порядке.
 * Именно на нём работает кэширование входа со скидкой до 90 процентов (§10.2),
 * поэтому порядок и содержание префикса НЕ зависят от конкретного места.
 */
function stablePrefix(profile: Profile, facts: Fact[]): string {
  const confirmed = facts.filter(f => f.confirmed);
  const full = confirmed.filter(f => f.quantified);
  const compact = confirmed.filter(f => !f.quantified);
  return [
    'You work with ONE candidate. Below are the profile and the fact bank; they do not change between requests. Always answer in English.',
    '',
    '=== PROFILE ===',
    profile.resume_text,
    profile.extras_text ? 'Additional notes: ' + profile.extras_text : '',
    '',
    '=== STRUCTURED FIELDS ===',
    'Scale: ' + JSON.stringify(profile.scale ?? {}),
    'Work authorization: ' + JSON.stringify(profile.work_auth ?? []),
    'Languages (CEFR): ' + JSON.stringify(profile.languages ?? []),
    'Relocation: ' + JSON.stringify(profile.relocation ?? {}),
    'Career gaps: ' + JSON.stringify(profile.gaps ?? []),
    '',
    // Селективный дамп (приём twin): важное полностью, остальное строкой.
    '=== FACT BANK (confirmed, quantified) ===',
    ...full.map(f => [f.id, f.action, f.how ?? '', f.result ?? '', '[' + f.source_hint + ']'].join(' · ')),
    '',
    '=== FACT BANK (confirmed, without a number) ===',
    ...compact.map(f => f.id + ' · ' + f.action),
  ].filter(x => x !== '').join('\n');
}

/**
 * Классификатор (§10.2 в редакции 1.2): дешёвый вызов сужает внимание дорогого.
 * Кэш при этом цел — префикс не меняется, а результат едет СУФФИКСОМ как список
 * указателей, а не как выборка фактов.
 */
async function focusFactIds(ctx: Ctx, facts: Fact[], jd: string): Promise<string[]> {
  const confirmed = facts.filter(f => f.confirmed);
  if (confirmed.length <= 25) return confirmed.map(f => f.id);
  const index = confirmed.map(f => [f.id, f.action, f.role_title ?? ''].join(' · ')).join('\n');
  try {
    const { data } = await callModel<{ fact_ids: string[] }>(ctx.env, ctx.cfg, ctx.userId, {
      operation: 'classify',
      prefix: 'You select relevant facts. Answer only with ids from the given list.',
      instruction: fillPrompt(getPrompt(ctx.prompts, 'classify'), { FACTS_INDEX: index, JD: jd }),
      schema: CLASSIFY_SCHEMA, temperature: 0, maxOutputTokens: 400,
    });
    const known = new Set(confirmed.map(f => f.id));
    const picked = (data.fact_ids ?? []).filter(id => known.has(id));
    return picked.length ? picked : confirmed.map(f => f.id);
  } catch {
    // Классификатор — оптимизация, а не обязательный шаг: его отказ не должен
    // ронять разбор. Падаем на «рассмотри всё».
    return confirmed.map(f => f.id);
  }
}

// ── Аудит профиля (§10.4a) ──────────────────────────────────────────────────
export async function runAudit(ctx: Ctx, profile: Profile, existing: Fact[]) {
  const { data, model, degraded } = await callModel<{
    facts: unknown[]; roles: unknown[]; questions: { about: string; question: string }[];
    recommendations: string[];
  }>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'audit',
    prefix: 'You break an executive resume down into atomic facts. Answer strictly by the schema, in English.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'audit'), {
      RESUME: profile.resume_text, EXTRAS: profile.extras_text,
    }),
    schema: AUDIT_SCHEMA, temperature: 0, maxOutputTokens: 6000,
  });

  const haystack = profile.resume_text + '\n' + profile.extras_text;
  const tol = ctx.cfg.thresholds.sourceHintTolerance;
  // Факт без подтверждённой цитаты отбрасывается МОЛЧА (§10.4a).
  const facts = (data.facts ?? [])
    .map(raw => sanitizeFact(raw, uid))
    .filter((f): f is Fact => f !== null && sourceHintFound(haystack, f.source_hint, tol));

  // Ранее подтверждённые факты переживают повторный аудит.
  const confirmedBefore = new Map(existing.filter(f => f.confirmed).map(f => [f.source_hint, f]));
  const merged = facts.map(f => {
    const prev = confirmedBefore.get(f.source_hint);
    return prev ? { ...f, id: prev.id, confirmed: true } : f;
  });

  const roles = (data.roles ?? []).map(r => {
    const o = r as Record<string, unknown>;
    return {
      company: String(o.company ?? ''), role_title: String(o.role_title ?? ''),
      from: String(o.from ?? ''), to: String(o.to ?? '') || null,
    };
  }).filter(r => r.from);

  const withRoles: Profile = { ...profile, roles: roles.length ? roles : profile.roles };
  const report = auditProfile(withRoles, merged, ctx.cfg.thresholds);
  return {
    facts: merged, roles, model, degraded,
    report: { ...report, questions: data.questions ?? [], recommendations: data.recommendations ?? [] },
  };
}

// ── Разбор (§10.4) ──────────────────────────────────────────────────────────
export async function runAnalyse(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, demand: Demand,
): Promise<{ analysis: Analysis; model: string; degraded: boolean }> {
  const jd = opp.jd_text ?? '';
  const focus = await focusFactIds(ctx, facts, jd || (opp.role_title + ' @ ' + opp.company));

  const branch = jd
    ? 'You HAVE the job posting text. EXTRACT the expectations from it and rank them by importance. No guessing: what is not in the text is not in the expectations.'
    : 'There is NO job posting text. Reconstruct the expectations from the role, industry, company size and signal, and set reconstructed: true.';

  const location = [opp.city, opp.country].filter(Boolean).join(', ');
  const { data, model, degraded } = await callModel<Analysis>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'analyse',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'analyse'), {
      JD_BRANCH: branch,
      OPPORTUNITY: [
        'Company: ' + opp.company,
        'Role: ' + opp.role_title,
        opp.industry ? 'Industry: ' + opp.industry : '',
        location ? 'Location: ' + location : '',
        opp.size ? 'Size: ' + opp.size : '',
        opp.signal ? 'Signal: ' + opp.signal : '',
      ].filter(Boolean).join('\n'),
      JD: jd ? '=== JOB POSTING TEXT ===\n' + jd : '',
      FOCUS: focus.join(', '),
    }),
    schema: ANALYSE_SCHEMA, temperature: 0.2, maxOutputTokens: 4000,
  });

  const analysis = sanitizeAnalysis(data);
  analysis.reconstructed = !jd;

  // Антигаллюцинация (§10.4): непроверенная цитата понижает ожидание до gap.
  const byId = new Map(facts.map(f => [f.id, f]));
  analysis.expectations = demoteUnverified(analysis.expectations, (hint, factId) => {
    if (factId) {
      const f = byId.get(factId);
      if (f && f.confirmed) return true;
    }
    return sourceHintFound(haystackOf(profile), hint, ctx.cfg.thresholds.sourceHintTolerance);
  });

  // Правила главнее модели.
  analysis.blockers = reconcileBlockers(analysis.blockers, demand, profile, ctx.cfg.thresholds);
  analysis.score = computeScore(analysis.expectations);
  return { analysis, model, degraded };
}

const haystackOf = (p: Profile) => p.resume_text + '\n' + p.extras_text;

// ── Ingest (§10.8) ──────────────────────────────────────────────────────────
const UA = 'HuntbackBot/1.0 (+https://huntback.app/about)';

const blockedMessage = () =>
  'The page blocks downloading: LinkedIn, Indeed and some corporate ATSs do this. '
  + 'Open it in your browser, copy the job posting text and paste it into the text field.';

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function fetchJobPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
    if ([401, 403, 429].includes(res.status)) throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
    if (!res.ok) throw new ApiError('jd_fetch_failed', 'The page did not open. Paste the job posting text.', 422);
    const raw = (await res.text()).slice(0, 2 * 1024 * 1024);
    const text = htmlToText(raw);
    if (text.length < 400) throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
  } finally {
    clearTimeout(timer);
  }
}

/** Требования места для правил блокеров (§10.4). Извлекаются один раз при ingest. */
export function demandFromIngest(raw: Record<string, unknown>, country: string): Demand {
  const d = (raw.demand ?? {}) as Record<string, unknown>;
  const langRaw = String(d.language_required ?? '');
  const cefr = parseCefr(langRaw);
  const langName = langRaw.replace(/[A-C][12]/gi, '').replace(/[-]/g, ' ').trim();
  return {
    country: country || null,
    language: langName ? { lang: langName, min: cefr ?? 'C1', mandatory: d.language_mandatory === true } : null,
    sponsorship_offered: typeof d.sponsorship_offered === 'boolean' ? d.sponsorship_offered : null,
    scale: (d.team_size || d.budget)
      ? { team: (d.team_size as number) ?? null, budget: (d.budget as number) ?? null }
      : null,
    manages_managers: d.manages_managers === true,
    lead_without_authority: d.lead_without_authority === true,
    license: d.license_required ? { name: String(d.license_required), mandatory: d.license_mandatory === true } : null,
    salary_max: (d.salary_max as number) ?? null,
  };
}

export async function runIngest(ctx: Ctx, text: string) {
  const { data, model } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'ingest',
    prefix: 'You extract the structure of a job posting from text. An empty string instead of a guess.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'ingest'), { TEXT: text.slice(0, 30_000) }),
    schema: INGEST_SCHEMA, temperature: 0, maxOutputTokens: 2500,
  });
  const parsed = sanitizeIngest(data, text);
  return { parsed, demand: demandFromIngest(data, parsed.country), jd_text: text, model };
}

// ── Документы (§10.5, §10.5a, §10.10) ───────────────────────────────────────
const FORMAT_BY_COUNTRY: Record<string, FormatVariant> = {
  'united kingdom': 'uk_ie', uk: 'uk_ie', ireland: 'uk_ie', ирландия: 'uk_ie', великобритания: 'uk_ie',
  sweden: 'nordic_nl', norway: 'nordic_nl', denmark: 'nordic_nl', finland: 'nordic_nl',
  netherlands: 'nordic_nl', швеция: 'nordic_nl', нидерланды: 'nordic_nl',
  germany: 'de_at', austria: 'de_at', switzerland: 'de_at', германия: 'de_at', австрия: 'de_at',
};

export function formatForCountry(country?: string | null): FormatVariant {
  return FORMAT_BY_COUNTRY[String(country ?? '').toLowerCase().trim()] ?? 'intl';
}

function formatRules(v: FormatVariant): string {
  const rules: Record<FormatVariant, string> = {
    intl: 'International format: no photo, no date of birth, marital status or citizenship.',
    uk_ie: 'UK and Ireland: no photo or personal data (anti-discrimination practice), two pages is normal.',
    nordic_nl: 'Nordics and the Netherlands: no photo, a short personal line is acceptable.',
    de_at: 'DACH: a photo is appropriate; date and place of birth only with the user\'s explicit consent.',
    europass: 'Europass structure.',
  };
  return rules[v] + ' One column, standard headings, no tables, text boxes, icons or skill bars.';
}

/**
 * Язык резюме, письма и комментариев по совпадению — английский по умолчанию,
 * независимо от страны места. Параметр оставлен, чтобы язык можно было снова
 * сделать зависимым от места, не трогая вызовы.
 */
function documentLanguage(_opp: Opportunity): string {
  return 'en';
}

export async function runResume(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, analysis: Analysis,
  opts: { format_variant?: FormatVariant; pages?: 1 | 2 } = {},
) {
  const variant = opts.format_variant ?? formatForCountry(opp.country);
  const pages = opts.pages ?? ((profile.years_exp ?? 0) >= ctx.cfg.thresholds.twoPageYears ? 2 : 1);
  const lang = documentLanguage(opp);
  const where = [opp.city, opp.country].filter(Boolean).join(', ');

  const { data, model, degraded } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'resume',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'resume'), {
      OPPORTUNITY: [opp.company, opp.role_title, where].filter(Boolean).join(' · '),
      EXPECTATIONS: analysis.expectations
        .map(e => '[' + e.weight + '] ' + e.expectation + ' -> ' + e.evidence).join('\n'),
      FORMAT: formatRules(variant), PAGES: pages, LANG: lang,
    }),
    schema: RESUME_SCHEMA, temperature: 0.2, maxOutputTokens: 5000,
  });

  const doc = sanitizeResume({ ...data, format_variant: variant, language: lang }, variant);
  const checks = checkResume(doc, { cfg: ctx.cfg, language: lang, facts, profile, analysis });
  return { doc, checks, model, degraded };
}

export async function runLetter(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, analysis: Analysis,
  opts: { tone?: 'neutral' | 'direct' | 'warm' } = {},
) {
  const isVacancy = opp.kind === 'vacancy';
  const range = isVacancy ? ctx.cfg.thresholds.letterVacancy : ctx.cfg.thresholds.letterHypothesis;
  const lang = documentLanguage(opp);
  const softest = analysis.expectations.find(e => e.gap_class === 'soft' && e.bridge);

  const branch = isVacancy
    ? 'Write a COVER letter in five blocks in a fixed order: (1) a hook with something specific about the company and a relevant fact with a number; (2) 2-3 achievements matching the must-have expectations, worded differently from the resume, with the same numbers; (3) a bridge closing the main soft gap, without excuses; (4) why this company and why now, with the answer to the objection built in; (5) a calm close with one specific ask.'
    : 'Write a COLD first letter to an executive: an observation about the company visible from outside, with the signal date; then the problem such an event usually creates, and a candidate fact with a number proving they have solved it; then a proposal for a short conversation. The role may be framed as one that does not exist yet. At the end, state where the contact came from and how to opt out of further emails. Retelling the resume, listing competencies and attachments are banned.';

  const channelLine = opp.channel === 'cold'
    ? 'cold application'
    : (opp.channel === 'referral' ? 'referral' : 'warm contact')
      + '; introduced by: ' + (opp.referral_name ?? '') + ' — name them in the FIRST sentence';

  const { data, model, degraded } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'letter',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'letter'), {
      BRANCH: branch,
      OPPORTUNITY: [
        opp.company + ' · ' + opp.role_title,
        opp.signal ? 'Signal: ' + opp.signal : '',
        opp.jd_text ? 'From the posting: ' + opp.jd_text.slice(0, 4000) : '',
      ].filter(Boolean).join('\n'),
      EXPECTATIONS: analysis.expectations.filter(e => e.weight === 'must')
        .map(e => e.expectation + ' -> ' + e.evidence).join('\n'),
      BRIDGE: softest ? softest.bridge + ': ' + softest.gap_answer : 'no soft gaps; write a paragraph about scale or trajectory',
      OBJECTION: analysis.objection ? analysis.objection.risk + ' -> ' + analysis.objection.answer : '',
      CHANNEL: channelLine,
      TONE: opts.tone ?? 'neutral',
      WORDS: range[0] + '-' + range[1],
      LANG: lang,
    }),
    schema: LETTER_SCHEMA, temperature: 0.4, maxOutputTokens: 1600,
  });

  const doc = sanitizeLetter({ ...data, language: lang });
  const checkCtx: CheckContext = {
    cfg: ctx.cfg, language: lang, facts, profile, analysis,
    opportunity: { company: opp.company, signal: opp.signal, jd_text: opp.jd_text },
  };
  const checks = checkLetter(doc, opp.kind, checkCtx);
  return { doc, checks, model, degraded };
}

/** Swap-тест (§10.10): подмену делает КОД, вопрос задаётся модели. */
export async function runSwapTest(ctx: Ctx, body: string, opp: Opportunity) {
  let swapped = body.split(opp.company).join('Vertigo Systems').split(opp.role_title).join('Head of Widgets');
  if (opp.contact_name) swapped = swapped.split(opp.contact_name).join('Alex Doe');
  const { data } = await callModel<{ broken: string[]; generic: string[] }>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'check',
    prefix: 'You check a letter for template-like writing. Answer strictly by the schema.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'check'), { LETTER: swapped }),
    schema: SWAP_SCHEMA, temperature: 0, maxOutputTokens: 800,
  });
  return applySwapResult({ broken: data.broken ?? [], generic: data.generic ?? [] }, ctx.cfg);
}

// ── Discover (§10.3, §9.1) ──────────────────────────────────────────────────
function splitPerimeter(perimeter: string, max: number): string[] {
  const parts = String(perimeter || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, max) : [perimeter || 'suitable leadership roles'];
}

/** Направления поиска — по ним же считается оценка времени и прогресс. */
export function discoverAngles(ctx: Ctx, profile: Profile): string[] {
  return splitPerimeter(profile.perimeter, ctx.cfg.models.maxConcurrency * 2);
}

/**
 * Два прохода на направление. В одном общем веб-поиске новости о раундах и
 * реорганизациях забивали выдачу, и находились одни гипотезы. Теперь:
 *   vacancies — веб-поиск только по сайтам вакансий и ATS (cfg.jobDomains);
 *   signals   — прежний поиск гипотез по датированным сигналам.
 */
export const DISCOVER_PASSES = ['vacancies', 'signals'] as const;
export type DiscoverPass = typeof DISCOVER_PASSES[number];

/**
 * Режим поиска: `all` — вакансии и гипотезы, `vacancies` — только вакансии.
 * Во втором режиме проход по сигналам не запускается вовсе, а гипотезы,
 * попавшиеся в проходе по вакансиям, отбрасываются.
 */
export type SearchMode = 'all' | 'vacancies';

export function passesFor(mode: SearchMode): readonly DiscoverPass[] {
  return mode === 'vacancies' ? ['vacancies'] : DISCOVER_PASSES;
}

export async function runDiscover(
  ctx: Ctx, profile: Profile, known: string[], count = 8,
  onAngleDone?: (done: number, total: number) => void,
  mode: SearchMode = 'all',
) {
  // Запросы идут ПУЛОМ, а не последовательно: §14 требует p95 < 180 с, и
  // последовательный обход шести веб-запросов в него не укладывается (§4.3.3).
  const angles = discoverAngles(ctx, profile);
  const perAngle = Math.ceil(count / angles.length) + 1;
  const tasks = angles.flatMap(angle => passesFor(mode).map(pass => ({ angle, pass })));
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  const outcomes: AngleOutcome[] = [];
  const batches = await mapWithConcurrency(tasks, ctx.cfg.models.maxConcurrency, async ({ angle, pass }) => {
    try {
      const tokens = {
        PERIMETER: angle, GEO: profile.geo, EXCLUDE: profile.exclude,
        KNOWN: known.join(', '), BREADTH: profile.breadth, COUNT: perAngle, TODAY: today,
      };
      const { data, trace } = await callModel<{ items: unknown[] }>(ctx.env, ctx.cfg, ctx.userId, {
        operation: 'discover',
        prefix: 'The candidate is looking for a job. Profile: ' + profile.resume_text.slice(0, 6000),
        instruction: fillPrompt(getPrompt(ctx.prompts, pass === 'vacancies' ? 'discover_vacancies' : 'discover'), tokens),
        // Рассуждение и разбор найденного у рассуждающей модели съедают лимит
        // ответа: при 4000 JSON обрезался, и прогон находил ноль. Платится
        // только использованное, так что запас ничего не стоит.
        schema: DISCOVER_SCHEMA, temperature: 0.5, maxOutputTokens: 16000, webSearch: true,
        searchDomains: pass === 'vacancies' ? ctx.cfg.jobDomains : undefined,
      });
      const raw = data.items ?? [];
      const kept = (raw.map(sanitizeDiscoverItem).filter(Boolean) as DiscoverItem[])
        .filter(k => mode !== 'vacancies' || k.kind === 'vacancy');
      outcomes.push({
        angle, pass, returned: raw.length, kept: kept.length,
        vacancies: kept.filter(k => k.kind === 'vacancy').length,
        hypotheses: kept.filter(k => k.kind === 'hypothesis').length,
        queries: trace.queries, domains: trace.domains,
      });
      return kept;
    } catch (e) {
      // Один неудачный проход не роняет прогон целиком — но причина не теряется:
      // она уходит в итог прогона, иначе «ноль найдено» неотличимо от поломки.
      outcomes.push({ angle, pass, returned: 0, kept: 0, error: e instanceof Error ? e.message : String(e) });
      return [];
    } finally {
      // Сообщаем о завершении и удачного, и неудачного направления: полоса
      // прогресса не должна останавливаться из-за того, что один запрос упал.
      onAngleDone?.(++done, tasks.length);
    }
  });
  return { items: batches.flat(), outcomes };
}
