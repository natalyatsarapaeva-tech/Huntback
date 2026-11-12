// Демо-режим: работает без Google, D1 и OpenAI, чтобы интерфейс можно было
// открыть и посмотреть.
//
// ВСЕ КОМПАНИИ И ЛЮДИ ЗДЕСЬ ВЫМЫШЛЕНЫ, и это требование, а не стилистика:
// демо публикуется на GitHub Pages, то есть публично, а сигнал вроде «раунд
// Series C» или «пожар на заводе» — это утверждение о факте. Про реальную
// компанию такое утверждение было бы опубликованной неправдой, поэтому в
// демо-данных не должно появляться ни одного существующего названия.
//
// Важное свойство: подделаны ТОЛЬКО модель и база. Аудит профиля, совпадение,
// блокеры и проверки документов считает настоящее ядро @huntback/core — то же,
// что в воркере. Поэтому демо не врёт: если снять блокер языка, он снимется по
// настоящему правилу, а не по заранее записанному ответу.

import {
  auditProfile, computeScore, coverage, checkLetter, checkResume,
  reanalyseAfterProfileChange, checkBudget, findDuplicate, companyKey,
  estimateRunSeconds, matchPotential, applyWordingFix, applyAllWordingFixes, dismissFix, applyAnsweredFix,
  coachAgenda, coachProgress, factReviewQueue, defaultFactQuestion, splitJobTexts, cleanJobText,
  type Demand, type ExpectationFix, type DocumentReview, type ResumeDoc, type CheckResult,
} from '@huntback/core';
import type {
  Api, Profile, Fact, Opportunity, Analysis, OpportunityDetail,
  DocumentRecord, ImportResult, ParsedJob, UsageSummary, Me, DocEvent, CoachView, MasterResume,
  CoachMessage, CoachProposal,
} from './types.ts';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Демо-кандидат ───────────────────────────────────────────────────────────
const RESUME = `Maria Kovaleva — VP Operations / Head of Supply Chain

Nordic Freight Group, Stockholm — Head of Operations, 2021 — present
Responsible for operations in Sweden, Denmark and Finland. Grew the operations team
from 8 to 25 people, including 4 managers, budget EUR 4.2M.
Cut delivery lead time by 40% in two quarters by rebuilding planning across
sites. Moved the warehouse network to a single WMS, saving EUR 620K a year.
Kept the team through the 2023 reorganisation: one person out of 25 left.

Baltic Logistics, Riga — Operations Manager, 2017 — 2021
Team of 8. Launched two new sites, reached planned volume
in 5 months instead of 9. Reduced late shipments from 12% to 3%.

Rautala Group, Helsinki — Supply Chain Analyst, 2014 — 2017
S&OP analytics. Built a demand forecasting model, accuracy improved by 18%.

Education: MSc Industrial Engineering, KTH, 2014.`;

const EXTRAS = `Grew four specialists into managers — two of them now run
their own areas. Gap 2020–2021 — studies, Executive programme at SSE.
Ready to relocate within the EU, no relocation package needed.`;

let profile: Profile = {
  resume_text: RESUME,
  extras_text: EXTRAS,
  perimeter: 'VP Operations; Head of Supply Chain; Director of Logistics',
  industries: 'logistics, retail, manufacturing',
  exclude: 'consulting, agencies',
  geo: 'Sweden, Germany',
  breadth: 'medium',
  languages: [{ lang: 'Russian', cefr: 'C2' }, { lang: 'English', cefr: 'C1' }, { lang: 'Swedish', cefr: 'B1' }],
  work_auth: [{ region: 'Sweden', status: 'permit' }, { region: 'EU', status: 'permit' }],
  relocation: { ready: 'yes', package_needed: false },
  scale: { team_max: 25, managers_max: 4, budget_max: 4_200_000, pnl: false, geo_scope: '3 countries', users_or_clients: '' },
  years_exp: 12,
  gaps: [{ from: '2020-02-01', to: '2021-01-01', reason: 'studies, SSE Executive programme' }],
  salary_range: '',
  linkedin_url: 'https://linkedin.com/in/mkovaleva',
  linkedin_complete: false,
  photo_policy: 'auto',
  roles: [
    { company: 'Nordic Freight Group', role_title: 'Head of Operations', from: '2021-02-01', to: null },
    { company: 'Baltic Logistics', role_title: 'Operations Manager', from: '2017-01-01', to: '2021-01-01' },
    { company: 'Rautala Group', role_title: 'Supply Chain Analyst', from: '2014-06-01', to: '2017-01-01' },
  ],
};

const f = (
  id: string, action: string, result: string, metric: number | null, unit: string,
  role: string, tags: Fact['scale_tags'], hint: string, confirmed = true,
): Fact => ({
  id, action, result, metric_value: metric, metric_unit: unit, role_title: role,
  scale_tags: tags, domain_tags: ['logistics'], quantified: metric != null,
  source_hint: hint, confirmed, how: '',
});

const q = (question: string, why: string): Fact['review'] => ({ kind: 'question', question, rewrite: null, why, status: 'pending' });
const rw = (action: string, how: string, result: string, why: string): Fact['review'] => ({ kind: 'rewrite', question: '', rewrite: { action, how, result }, why, status: 'pending' });

let facts: Fact[] = [
  f('f1', 'Grew the operations team', 'from 8 to 25 people, 4 managers', 25, 'people', 'Head of Operations', ['team', 'managers'], 'team from 8 to 25 people'),
  f('f2', 'Cut delivery lead time', 'by 40% in two quarters', 40, '%', 'Head of Operations', [], 'delivery lead time by 40%'),
  f('f3', 'Moved the warehouse network to a single WMS', 'saving EUR 620K a year', 620000, 'EUR', 'Head of Operations', ['budget'], 'single WMS, saving EUR 620K'),
  f('f4', 'Kept the team through a reorganisation', '1 person out of 25 left', 1, 'people', 'Head of Operations', ['team'], 'one person out of 25 left'),
  f('f5', 'Launched two new sites', 'planned volume in 5 months instead of 9', 5, 'months', 'Operations Manager', [], 'planned volume in 5 months'),
  f('f6', 'Reduced late shipments', 'from 12% to 3%', 3, '%', 'Operations Manager', [], 'late shipments from 12% to 3%'),
  f('f7', 'Built a demand forecasting model', 'accuracy improved by 18%', 18, '%', 'Supply Chain Analyst', [], 'accuracy improved by 18%'),
  f('f8', 'Grew four specialists into managers', 'two now run their own areas', 4, 'managers', 'Head of Operations', ['managers'], 'four specialists into managers'),
  f('f9', 'Ran operations in three countries', 'Sweden, Denmark, Finland', null, '', 'Head of Operations', ['geo'], 'operations in Sweden, Denmark and Finland'),
  f('f10', 'Built S&OP analytics', '', null, '', 'Supply Chain Analyst', [], 'S&OP analytics', false),
  f('f11', 'Responsible for operations', 'in Sweden, Denmark and Finland', null, '', 'Head of Operations', ['geo'], 'Responsible for operations in Sweden', false),
].map(x => ({
  ...x,
  review: x.id === 'f9' ? q('How many sites, warehouses or people did operations in the three countries cover?', 'Scale is the first thing a screener checks for a multi-country role.')
    : x.id === 'f10' ? q('What decision did the S&OP analytics change, and by how much — forecast error, stock, service level?', 'Analytics without an outcome reads as a duty, not an achievement.')
      : x.id === 'f11' ? rw('Ran operations across Sweden, Denmark and Finland', 'as Head of Operations at Nordic Freight Group', 'for the whole Nordic network', '“Responsible for” is a duty; “ran” is an achievement.')
        : x.id === 'f4' ? rw('Kept the team through the 2023 reorganisation', 'by running it openly with the team leads', '1 person out of 25 left', 'Leads with what you did, not with what happened to you.')
          : { kind: 'ok' as const, question: '', rewrite: null, why: '', status: 'pending' as const },
}));

// ── Демо-места ──────────────────────────────────────────────────────────────
const opp = (o: Partial<Opportunity> & { id: string; company: string; role_title: string }): Opportunity => ({
  company_key: companyKey(o.company), kind: 'vacancy', origin: 'discovered',
  status: 'new', channel: 'cold', updated_at: new Date().toISOString(), ...o,
} as Opportunity);

let opportunities: Opportunity[] = [
  opp({
    id: 'o1', company: 'Nordpakk', role_title: 'VP Operations', industry: 'last-mile logistics',
    city: 'Stockholm', country: 'Sweden', size: '900+', kind: 'vacancy', status: 'analysed', score: 78,
    source_url: 'https://example.com/jobs/nordpakk-vp-ops',
    jd_text: 'We are looking for a VP Operations to lead our Nordic operations...',
    signal: 'Expansion into Denmark, announced June 2026',
  }),
  opp({
    id: 'o2', company: 'Kleiderwerk Logistik SE', role_title: 'Director of Fulfilment', industry: 'e-commerce',
    city: 'Berlin', country: 'Germany', size: '5000+', kind: 'vacancy', status: 'analysed', score: 64,
    source_url: 'https://example.com/jobs/kleiderwerk-dir-fulfilment',
    jd_text: 'Fließend Deutsch erforderlich. Verantwortung für ein Team von 60 Mitarbeitenden...',
    signal: 'New distribution centre near Leipzig, August 2026',
  }),
  opp({
    id: 'o3', company: 'Norrbröd', role_title: 'Head of Supply Chain', industry: 'food manufacturing',
    city: 'Umeå', country: 'Sweden', size: '400', kind: 'hypothesis', status: 'new',
    source_url: 'https://example.com/news/norrbrod-expansion',
    source_date: '2026-07-14',
    signal: 'Second line launched after a fire at the main plant, July 2026 — operations rarely keep pace with production',
  }),
  opp({
    id: 'o4', company: 'Snabbud', role_title: 'Head of Network Operations', industry: 'delivery',
    city: 'Stockholm', country: 'Sweden', size: '600', kind: 'hypothesis', status: 'new',
    source_url: 'https://example.com/news/snabbud-series-c',
    source_date: '2026-05-22',
    signal: 'Series C round in May 2026, entry into three new markets announced',
    label: 'low_chance',
  }),
  opp({
    id: 'o5', company: 'Matkassen', role_title: 'VP Supply Chain', industry: 'online groceries',
    city: 'Oslo', country: 'Norway', size: '1200', kind: 'vacancy', status: 'new',
    source_url: 'https://example.com/jobs/matkassen-vp-sc',
    signal: 'Supply chain reorganisation after a CEO change, April 2026',
  }),
];

// Требования мест — то, что в проде извлекает ingest (§10.8) и хранит воркер.
const demands: Record<string, Demand> = {
  o1: { country: 'Sweden', scale: { team: 40 }, manages_managers: true },
  // Зато вот здесь — настоящий жёсткий блокер: немецкий обязателен, у неё его нет.
  o2: {
    country: 'Germany', manages_managers: true, scale: { team: 60 },
    language: { lang: 'German', min: 'C1', mandatory: true },
  },
  o3: { country: 'Sweden', scale: { team: 15 } },
  o4: { country: 'Sweden', scale: { team: 30 }, manages_managers: true },
  o5: { country: 'Norway', scale: { team: 45 }, manages_managers: true },
};

const exp = (
  expectation: string, weight: 'must' | 'important' | 'nice', evidence: string,
  fact_id: string | null, hint: string, strength: 'strong' | 'partial' | 'gap',
  gap: 'hard' | 'soft' | null = null, bridge: Analysis['expectations'][0]['bridge'] = null, answer = '',
  fix: ExpectationFix | null = null,
) => ({ expectation, weight, evidence, fact_id, source_hint: hint, strength, gap_class: gap, bridge, gap_answer: answer, fix });

const wording = (fact_id: string, rewrite: string, after: 'strong' | 'partial' = 'strong'): ExpectationFix =>
  ({ reason: 'wording', fact_id, rewrite, question: '', strength_after: after, status: 'open' });
const ask = (question: string): ExpectationFix =>
  ({ reason: 'missing_fact', fact_id: null, rewrite: '', question, strength_after: 'strong', status: 'open' });
const realGap = (): ExpectationFix =>
  ({ reason: 'real_gap', fact_id: null, rewrite: '', question: '', strength_after: 'gap', status: 'open' });

const analyses: Record<string, Analysis> = {
  o1: {
    expectations: [
      exp('Running operations across several Nordic countries', 'must', 'Operations in Sweden, Denmark and Finland at Nordic Freight', 'f9', 'operations in Sweden, Denmark and Finland', 'strong'),
      exp('A team of 40+ with managers reporting in', 'must', 'Team of 25, 4 managers', 'f1', 'team from 8 to 25 people', 'partial', 'soft', 'trajectory', 'Tripled the team in three years and manages managers, not just specialists',
        ask('Beyond your 25 direct and indirect reports, did you lead anyone else day to day — contractors, 3PL staff, temporary warehouse crews? How many at peak?')),
      exp('Measurable operating cost reduction', 'must', 'Single WMS, saving EUR 620K a year', 'f3', 'single WMS, saving EUR 620K', 'strong'),
      exp('Owning network KPIs: on-time delivery and cost per parcel', 'must', 'Late shipments and lead time — but not named as network KPIs', 'f6', 'late shipments from 12% to 3%', 'gap', 'soft', 'transferable_metrics', '',
        wording('f6', 'Owned on-time delivery as a network KPI: cut late shipments from 12% to 3%')),
      exp('Experience scaling a network fast', 'important', 'Two sites at planned volume in 5 months instead of 9', 'f5', 'planned volume in 5 months', 'strong'),
      exp('Working-level Swedish', 'important', 'Swedish B1', null, '', 'partial', 'soft', 'analogous_tools', 'B1 plus working English; operations meetings at Nordic Freight ran in English',
        realGap()),
      exp('Last-mile experience', 'nice', 'Freight logistics experience, not last mile', null, '', 'gap', 'soft', 'transferable_metrics', 'Lead time and late-shipment metrics read the same in both models',
        wording('f2', 'Cut end-to-end delivery lead time, including the final delivery leg, by 40% in two quarters', 'partial')),
    ],
    blockers: [], score: 0,
    uvp: 'The only candidate with proven experience running operations in three Nordic countries at once and a demonstrated 40% cut in delivery lead time — exactly the task that comes with entering Denmark.',
    objection: { risk: 'Can’t handle the scale: we have 40+ people, the candidate had 25', answer: 'The team grew from 8 to 25 under the candidate and already includes four managers — that is managing managers, not just specialists' },
    reconstructed: false,
  },
  o2: {
    expectations: [
      exp('Fluent German', 'must', 'No German in the profile', null, '', 'gap', 'hard', null, '', realGap()),
      exp('Managing a team of 60+', 'must', 'Team of 25, 4 managers', 'f1', 'team from 8 to 25 people', 'partial', 'soft', 'trajectory', 'Team growth trajectory and managing managers',
        ask('Have you ever had 60 or more people in your organisation, including indirect reports or seasonal staff?')),
      exp('E-commerce fulfilment experience', 'must', 'Freight and warehouse logistics experience', 'f3', 'single WMS, saving EUR 620K', 'partial', 'soft', 'transferable_metrics', 'WMS and lead time metrics transfer between models',
        wording('f3', 'Consolidated fulfilment warehouses onto a single WMS, saving EUR 620K a year', 'strong')),
      exp('Warehouse process optimisation', 'important', 'Single WMS, saving EUR 620K a year', 'f3', 'single WMS, saving EUR 620K', 'strong'),
      exp('Working in a matrix structure', 'nice', 'Three countries, four managers', 'f8', 'four specialists into managers', 'strong'),

    ],
    blockers: [], score: 0,
    uvp: 'A warehouse transformation with proven savings of EUR 620K a year and experience launching sites nearly twice as fast as planned.',
    objection: { risk: 'Language: without German the candidate can’t work with warehouse staff', answer: '' },
    reconstructed: false,
  },
};

// Блокеры считает НАСТОЯЩЕЕ правило ядра, а не заранее записанный ответ.
function withBlockers(id: string, a: Analysis): Analysis {
  const next = reanalyseAfterProfileChange(a, demands[id] ?? {}, profile);
  return { ...next, score: computeScore(next.expectations) };
}

let documents: Record<string, DocumentRecord[]> = {};

let usageLog = [
  { operation: 'audit' as const, model: 'gpt-5.6-sol', tokens_in: 12000, tokens_out: 3100, tool_calls: 0, cost_usd: 0.11, ok: true, created_at: new Date(Date.now() - 5 * 864e5).toISOString() },
  { operation: 'discover' as const, model: 'gpt-5.6-terra', tokens_in: 22000, tokens_out: 4200, tool_calls: 6, cost_usd: 0.16, ok: true, created_at: new Date(Date.now() - 4 * 864e5).toISOString() },
  { operation: 'analyse' as const, model: 'gpt-5.6-sol', tokens_in: 18000, tokens_out: 2200, tool_calls: 0, cost_usd: 0.036, ok: true, created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
  { operation: 'analyse' as const, model: 'gpt-5.6-sol', tokens_in: 17500, tokens_out: 2100, tool_calls: 0, cost_usd: 0.034, ok: true, created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
  { operation: 'letter' as const, model: 'gpt-5.6-terra', tokens_in: 9000, tokens_out: 700, tool_calls: 0, cost_usd: 0.011, ok: true, created_at: new Date(Date.now() - 864e5).toISOString() },
  { operation: 'letter' as const, model: 'gpt-5.6-terra', tokens_in: 0, tokens_out: 0, tool_calls: 0, cost_usd: 0, ok: false, created_at: new Date(Date.now() - 3600e3).toISOString() },
];

export const mockApi: Api = {
  async me(): Promise<Me> {
    await delay(120);
    return {
      user: { email: 'maria@example.com', name: 'Maria Kovaleva' },
      profile_filled: profile.resume_text.trim().length > 0,
      spreadsheet_url: 'https://docs.google.com/spreadsheets/d/demo',
      reauth_required: false,
    };
  },

  async logout() {
    await delay(80);
  },

  async resetData(scope) {
    await delay(300);
    if (scope === 'all' || scope === 'search') {
      opportunities = [];
      documents = {};
      for (const k of Object.keys(analyses)) delete analyses[k];
    }
    if (scope === 'all' || scope === 'profile') { resetToBlankProfile(); coachMessages = []; coachProposals = []; coachSkipped = []; masterResume = null; }
    if (scope === 'all' || scope === 'budget') usageLog = [];
  },

  async getProfile() {
    await delay(140);
    return { profile, audit: auditProfile(profile, facts), facts: factReviewQueue(facts), master_resume: masterResume };
  },

  async saveProfile(patch) {
    await delay(200);
    profile = { ...profile, ...patch };
    return { profile, audit: auditProfile(profile, facts) };
  },

  async runAudit() {
    await delay(1500);   // аудит в проде идёт до минуты — этап должен быть видно
    return { audit: auditProfile(profile, facts), facts };
  },

  async patchFact(id, patch) {
    await delay(90);
    facts = facts.map(x => (x.id === id ? { ...x, ...patch } : x));
  },

  async deleteFact(id) {
    await delay(90);
    facts = facts.filter(x => x.id !== id);
  },

  async listOpportunities() {
    await delay(160);
    return opportunities.filter(o => o.status !== 'archived').map(o => {
      const a = analyses[o.id];
      return a ? { ...o, score: withBlockers(o.id, a).score } : o;
    });
  },

  async getOpportunity(id): Promise<OpportunityDetail> {
    await delay(180);
    const o = opportunities.find(x => x.id === id)!;
    const raw = analyses[id];
    const analysis = raw ? withBlockers(id, raw) : null;
    return {
      opportunity: o, analysis, documents: documents[id] ?? [],
      coverage: analysis ? coverage(analysis.expectations) : null,
      potential: analysis ? matchPotential(analysis.expectations) : null,
    };
  },

  async patchOpportunity(id, patch) {
    await delay(120);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, ...patch, updated_at: new Date().toISOString() } : o));
    const raw = analyses[id];
    return raw ? { analysis: withBlockers(id, raw) } : {};
  },

  async fetchJobText(id) {
    await delay(900);
    const o = opportunities.find(x => x.id === id)!;
    const jd_text = `${o.role_title} — ${o.company}, ${o.city ?? ''}\n\n`
      + 'Demo mode: in the live app this is the text downloaded from the source link.';
    opportunities = opportunities.map(x => (x.id === id ? { ...x, jd_text } : x));
    return { jd_text };
  },

  async archiveOpportunity(id) {
    await delay(120);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, status: 'archived' } : o));
  },

  async importJob(input): Promise<ImportResult> {
    await delay(1200);
    if (input.url && !input.text) {
      // Ровно то, что делают LinkedIn и Indeed (§10.8) — ветка не аварийная.
      if (/linkedin|indeed/i.test(input.url)) {
        throw Object.assign(new Error(
          'The page blocks downloading: LinkedIn, Indeed and some corporate ATSs do this. '
          + 'Open it in your browser, copy the job posting text and paste it into the text field.'), { code: 'jd_fetch_blocked' });
      }
    }
    const text = input.text ?? 'Head of Logistics, Stockholm. We are looking for an experienced operations leader...';
    const parsed: ParsedJob = {
      company: 'Apotekly', role_title: 'Head of Logistics', city: 'Stockholm', country: 'Sweden',
      industry: 'e-commerce', size: '1000+', language: 'sv', seniority: 'Head',
      requirements: ['Managing a warehouse team of 30+', 'Working-level Swedish', 'WMS'],
      responsibilities: ['Warehouse operations', 'Network planning'],
      contact_email: '', salary: '', posted_date: '2026-09-01',
      confidence: 'high', is_job_posting: true,
    };
    const dup = findDuplicate({ company: parsed.company, role_title: parsed.role_title },
      opportunities.map(o => ({ id: o.id, company_key: o.company_key, role_title: o.role_title })));
    return { parsed, jd_text: text, duplicate_of: dup, source_url: input.url ?? null };
  },

  async confirmImport(r) {
    await delay(300);
    const id = 'o' + (opportunities.length + 1);
    opportunities = [opp({
      id, company: r.parsed.company, role_title: r.parsed.role_title,
      city: r.parsed.city, country: r.parsed.country, industry: r.parsed.industry,
      size: r.parsed.size, kind: 'vacancy', origin: r.source_url ? 'manual_url' : 'manual_text',
      jd_text: r.jd_text, source_url: r.source_url ?? undefined, status: 'new',
    }), ...opportunities];
    demands[id] = { country: r.parsed.country };
    return { id };
  },

  async analyse(id) {
    await delay(2200);
    // Копия, а не общий объект: правки одного места не должны менять другое.
    const base = structuredClone(analyses[id] ?? analyses.o1);
    analyses[id] = base;
    const a = withBlockers(id, base);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, status: 'analysed', score: a.score } : o));
    return { analysis: a, coverage: coverage(a.expectations), potential: matchPotential(a.expectations) };
  },

  async fixExpectation(id, b) {
    await delay(b.action === 'answer' ? 1400 : 200);
    const a = analyses[id];
    if (!a) throw new Error('Analyse this place’s expectations first');
    let note = '';
    if (b.action === 'apply_all') {
      const r = applyAllWordingFixes(a.expectations);
      a.expectations = r.expectations;
      note = `${r.applied} wording fix${r.applied === 1 ? '' : 'es'} applied`;
    } else {
      const i = Number(b.index);
      const e = a.expectations[i];
      if (b.action === 'apply') a.expectations[i] = applyWordingFix(e);
      if (b.action === 'dismiss') a.expectations[i] = dismissFix(e);
      if (b.action === 'answer') {
        const answer = String(b.answer ?? '').trim();
        // Демо: ответ «нет» оставляет гэп, иначе ответ становится фактом.
        if (/^(no|nope|never|нет)\b/i.test(answer)) {
          a.expectations[i] = { ...e, fix: e.fix ? { ...e.fix, status: 'answered', answer } : null };
          note = 'The answer doesn’t cover this expectation — it stays a gap';
        } else {
          const nf: Fact = {
            id: 'n' + Date.now(), action: answer.length > 90 ? answer.slice(0, 90) + '…' : answer, result: '',
            metric_value: null, metric_unit: null, scale_tags: [], domain_tags: [], quantified: /\d/.test(answer),
            source_hint: answer.slice(0, 120), confirmed: true, user_input: answer, review: null,
          };
          facts = [...facts, nf];
          a.expectations[i] = applyAnsweredFix(e, answer, { strength: /\d/.test(answer) ? 'strong' : 'partial', evidence: answer, fact_id: nf.id });
          note = 'Added to your fact bank and counted for this place';
        }
      }
    }
    const w = withBlockers(id, a);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, score: w.score } : o));
    return { analysis: w, coverage: coverage(w.expectations), potential: matchPotential(w.expectations), note };
  },

  async makeResume(id, onEvent) {
    const review = await simulateReview('resume', onEvent);
    const o = opportunities.find(x => x.id === id)!;
    const doc = {
      headline: o.role_title,
      summary: [
        'Operations leader who has run the supply chain across three Nordic countries.',
        'Team of up to 25 people and four managers, budget EUR 4.2M.',
      ],
      summary_support: [0, 1],
      facts_line: 'EU work permit — no sponsorship needed · English C1, Swedish B1, Russian C2 · open to relocation · linkedin.com/in/mkovaleva',
      competencies: ['S&OP', 'WMS', 'Network planning', 'Budgeting', 'Lean', 'Site launches', 'Operations KPIs'],
      experience: [
        {
          company: 'Nordic Freight Group', role_title: 'Head of Operations',
          period_from: '2021-02', period_to: null,
          context_line: 'Team of 25, 4 managers, budget EUR 4.2M, 3 countries',
          bullets: [
            'Cut delivery lead time by 40% in two quarters by rebuilding planning across sites',
            'Moved the warehouse network to a single WMS — saving EUR 620K a year',
            'Grew the team from 8 to 25 people, including 4 managers',
            'Kept the team through the 2023 reorganisation: 1 person out of 25 left',
          ], condensed: false,
        },
        {
          company: 'Baltic Logistics', role_title: 'Operations Manager',
          period_from: '2017-01', period_to: '2021-01',
          context_line: 'Team of 8',
          bullets: [
            'Launched two sites — planned volume in 5 months instead of 9',
            'Reduced late shipments from 12% to 3%',
          ], condensed: false,
        },
      ],
      education: ['MSc Industrial Engineering, KTH, 2014'],
      format_variant: 'nordic_nl' as const, language: 'en',
      facts_used: ['f2', 'f3', 'f1', 'f4', 'f5', 'f6'],
    };
    const checks = checkResume(doc, { language: 'en', facts, profile, analysis: analyses[id] ?? null });
    const rec: DocumentRecord = {
      id: 'd-' + id + '-r', kind: 'resume', version: 1, subject: null,
      body: JSON.stringify(doc), edited_by_user: false, format_variant: doc.format_variant,
      facts_used: doc.facts_used, checks, created_at: new Date().toISOString(), review,
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'resume'), rec];
    opportunities = opportunities.map(x => (x.id === id ? { ...x, status: 'drafted' } : x));
    return { id: rec.id, doc, checks, review };
  },

  async makeLetter(id, _tone, onEvent) {
    const review = await simulateReview('letter', onEvent);
    const o = opportunities.find(x => x.id === id)!;
    const body = o.kind === 'hypothesis'
      ? `In July 2026 you launched a second line after the fire at your main plant. In my experience a launch like that breaks planning for a quarter: production reaches volume before shipping is rebuilt around it, and late deliveries appear where there were none before.

I went through that kind of transition in a network of a similar size. I cut delivery lead time by 40% in two quarters by rebuilding planning across sites, and reduced late shipments from 12% to 3%.

As far as I can see from outside, there is no role for this at your company yet. Perhaps it isn't needed. But if the question is already on the table, would you be open to a short twenty-minute call next week?

I took your contact from the leadership page on the company website. If you'd rather not receive emails like this, reply with one word and I won't write again.`
      : `You announced the expansion into Denmark in June 2026, and that is exactly the moment when operations in three countries stop being three national operations. I ran exactly that setup — Sweden, Denmark, Finland — and cut delivery lead time by 40% in two quarters.

What I bring to your requirements: a single WMS instead of three warehouse set-ups, saving EUR 620K a year; two sites launched and at planned volume in 5 months instead of 9; a team that grew from 8 to 25 people, four of them managers.

On scale, plainly: your posting mentions 40+ people, I had 25. But those 25 grew from eight under my management, and four of them are managers, so I manage managers, not only specialists. The difference between 25 and 40 here is about hiring pace, not the type of work.

Why Nordpakk and why now: the Danish last-mile market works differently from the Swedish one, and a mistake at the start costs a year. It is this window that interests me, not the role in general.

Would you be open to a twenty-minute call in the week of 15 September?`;
    const doc = { subject: o.kind === 'hypothesis' ? 'Shipping after the second line launch' : 'Operations in three countries — 20 minutes?', body };
    const checks = checkLetter(
      { ...doc, word_count: 0, bridge_used: 'trajectory', facts_used: ['f2', 'f3', 'f1'], language: 'en' },
      o.kind,
      { language: 'en', facts, profile, analysis: analyses[id] ?? null,
        opportunity: { company: o.company, signal: o.signal, jd_text: o.jd_text } },
    );
    const rec: DocumentRecord = {
      id: 'd-' + id + '-l', kind: 'letter', version: 1, subject: doc.subject,
      body: doc.body, edited_by_user: false, format_variant: null,
      facts_used: ['f2', 'f3', 'f1'], checks, created_at: new Date().toISOString(), review,
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'letter'), rec];
    opportunities = opportunities.map(x => (x.id === id ? { ...x, status: 'drafted' } : x));
    return { id: rec.id, doc, checks, review };
  },

  async answerFact(id, answer) {
    await delay(900);
    const cur = facts.find(x => x.id === id);
    if (!cur) throw new Error('Fact not found');
    const num = answer.match(/\d[\d.,]*\s*(%|people|sites|EUR|K|M)?/i)?.[0] ?? null;
    const next: Fact = {
      ...cur,
      result: num ? [cur.result, answer].filter(Boolean).join('; ') : cur.result,
      metric_value: num ? Number(num.replace(/[^\d.]/g, '')) || cur.metric_value || null : cur.metric_value,
      metric_unit: num ? (num.replace(/[\d.,\s]/g, '') || cur.metric_unit || '') : cur.metric_unit,
      quantified: cur.quantified || !!num,
      user_input: [cur.user_input, answer].filter(Boolean).join('\n'),
      confirmed: true,
      review: cur.review ? { ...cur.review, status: 'answered' } : null,
    };
    facts = facts.map(x => (x.id === id ? next : x));
    return { fact: next };
  },

  async coach() {
    await delay(150);
    return coachView();
  },

  async coachMessage(text, topicId) {
    await delay(text ? 1300 : 700);
    const agenda = coachAgenda(profile, facts, { skipped: coachSkipped });
    const current = topicId ?? [...coachMessages].reverse().find(m => m.role === 'coach')?.topic_id ?? agenda[0]?.id;
    const now = new Date().toISOString();
    if (text) {
      coachMessages.push({ role: 'user', text, at: now, topic_id: current });
      const topic = agenda.find(t => t.id === current);
      // Демо-коуч честен так же, как настоящий: факт — только из числа в словах пользователя.
      if (topic && /\d/.test(text)) {
        if (topic.kind === 'fact_number' && topic.fact_id) {
          const fct = facts.find(x => x.id === topic.fact_id);
          coachProposals.push({ id: 'p' + Date.now(), kind: 'update_fact', status: 'open', fact_id: topic.fact_id,
            label: `Update “${fct?.action}” → ${text}`, fact: { result: text, quantified: true, user_input: text } });
        } else if (topic.kind === 'scale') {
          const n = Number(text.match(/\d+/)?.[0]);
          coachProposals.push({ id: 'p' + Date.now(), kind: 'profile', status: 'open', label: `Profile: team ${n}`,
            profile: { scale: { ...(profile.scale ?? {}), team_max: n } } });
        } else {
          coachProposals.push({ id: 'p' + Date.now(), kind: 'new_fact', status: 'open', label: text,
            fact: { action: text, result: '', quantified: true, source_hint: text.slice(0, 120), user_input: text, scale_tags: [], domain_tags: [] } });
        }
      }
      if (current && !coachSkipped.includes(current)) coachSkipped.push(current);
    }
    const next = coachAgenda(profile, facts, { skipped: coachSkipped })[0];
    coachMessages.push({ role: 'coach', text: coachQuestion(next, !!text), at: now, topic_id: next?.id });
    return coachView();
  },

  async coachSkip(topicId) {
    await delay(100);
    if (!coachSkipped.includes(topicId)) coachSkipped.push(topicId);
    return coachView();
  },

  async coachProposal(id, action) {
    await delay(250);
    const prop = coachProposals.find(x => x.id === id);
    if (prop && prop.status === 'open') {
      if (action === 'apply') {
        if (prop.kind === 'new_fact' && prop.fact) {
          facts = [...facts, { id: 'c' + Date.now(), action: String(prop.fact.action), result: prop.fact.result, metric_value: null,
            metric_unit: null, scale_tags: [], domain_tags: [], quantified: !!prop.fact.quantified,
            source_hint: String(prop.fact.source_hint ?? ''), confirmed: true, user_input: prop.fact.user_input, review: null }];
        }
        if (prop.kind === 'update_fact' && prop.fact_id) {
          facts = facts.map(x => (x.id === prop.fact_id ? { ...x, ...prop.fact, confirmed: true } : x));
        }
        if (prop.kind === 'profile' && prop.profile) profile = { ...profile, ...prop.profile };
      }
      prop.status = action === 'apply' ? 'applied' : 'dismissed';
    }
    return { ...coachView(), profile, facts: factReviewQueue(facts) };
  },

  async coachReset() {
    coachMessages = []; coachProposals = []; coachSkipped = [];
    return coachView();
  },

  async buildMasterResume(onEvent) {
    const review = await simulateReview('resume', onEvent);
    const doc = masterDoc();
    const checks = checkResume(doc, { language: 'en', facts, profile, analysis: null });
    masterResume = { doc, checks, review, created_at: new Date().toISOString() };
    return masterResume;
  },

  async questions() {
    await delay(150);
    const W = { must: 0, important: 1, nice: 2 } as const;
    const out = opportunities.filter(o => !o.label && o.status !== 'archived' && analyses[o.id]).flatMap(o =>
      analyses[o.id].expectations.map((e, index) => ({ e, index })).filter(({ e }) => e.fix?.reason === 'missing_fact' && e.fix.status === 'open')
        .map(({ e, index }) => ({ opportunity_id: o.id, company: o.company, role_title: o.role_title, index,
          expectation: e.expectation, weight: e.weight, question: e.fix!.question, drafted: o.status === 'drafted' })));
    return { questions: out.sort((a, b) => W[a.weight] - W[b.weight]) };
  },

  async importBatch(text) {
    await delay(1600);
    const parts = splitJobTexts(text);
    if (!parts.length) throw new Error('Paste at least one job posting (200+ characters). Separate several with a line of ---');
    return {
      results: parts.map((t, index) => {
        const lines = cleanJobText(t).split('\n').map(l => l.trim()).filter(Boolean);
        const role = lines[0]?.slice(0, 80) ?? 'Role';
        const company = (lines[1]?.split(/[·|,]/)[0] ?? 'Company').trim().slice(0, 60);
        const dup = findDuplicate({ company, role_title: role },
          opportunities.map(o => ({ id: o.id, company_key: o.company_key, role_title: o.role_title })));
        if (dup) {
          opportunities = opportunities.map(o => (o.id === dup ? { ...o, jd_text: t, kind: 'vacancy' } : o));
          return { index, ok: true as const, id: dup, merged: true, company, role_title: role };
        }
        const id = 'o' + (opportunities.length + 1) + '-' + index;
        opportunities = [opp({ id, company, role_title: role, kind: 'vacancy', origin: 'manual_text', jd_text: t, status: 'new', country: 'Sweden' }), ...opportunities];
        demands[id] = { country: 'Sweden' };
        return { index, ok: true as const, id, merged: false, company, role_title: role };
      }),
    };
  },

  async saveDocument(id, patch) {
    await delay(250);
    let out: DocumentRecord | undefined;
    for (const list of Object.values(documents)) {
      const hit = list.find(d => d.id === id);
      if (hit) out = hit;
    }
    if (!out) return { checks: [] };
    const oppId = Object.keys(documents).find(k => documents[k].some(d => d.id === id))!;
    const o = opportunities.find(x => x.id === oppId)!;
    out.body = patch.body ?? out.body;
    out.subject = patch.subject ?? out.subject;
    out.edited_by_user = true;
    out.checks = out.kind === 'letter'
      ? checkLetter({ subject: out.subject ?? '', body: out.body, word_count: 0, bridge_used: null, facts_used: out.facts_used, language: 'en' },
        o.kind, { language: 'en', facts, profile, analysis: analyses[oppId] ?? null,
          opportunity: { company: o.company, signal: o.signal, jd_text: o.jd_text } })
      : checkResume(JSON.parse(out.body), { language: 'en', facts, profile, analysis: analyses[oppId] ?? null });
    return { checks: out.checks };
  },

  async runSearch(mode, onEvent) {
    // Имитируем ровно ту же последовательность событий, что присылает воркер,
    // с правдоподобными задержками: полосу прогресса надо проверять на том же
    // потоке, который будет в проде, а не на мгновенном результате.
    const anglesTotal = mode === 'vacancies' ? 2 : 4;
    const estimateSec = estimateRunSeconds(anglesTotal, 3);
    onEvent({ stage: 'plan', anglesTotal, estimateSec });
    await delay(500);
    onEvent({ stage: 'search', anglesDone: 0, anglesTotal, estimateSec });
    for (let i = 1; i <= anglesTotal; i++) {
      await delay(1400);
      onEvent({ stage: 'search', anglesDone: i, anglesTotal, estimateSec });
    }
    onEvent({ stage: 'dedup', anglesDone: anglesTotal, anglesTotal, estimateSec });
    await delay(500);
    onEvent({ stage: 'save', anglesDone: anglesTotal, anglesTotal, estimateSec });
    await delay(400);
    // Демо ничего не дописывает в список — иначе повторные прогоны его засорят.
    onEvent({ stage: 'done', found: 7, added: 0, estimateSec });
  },

  async usage(): Promise<UsageSummary> {
    await delay(140);
    const status = checkBudget(usageLog);
    const byOperation: UsageSummary['byOperation'] = {};
    for (const e of usageLog) {
      const agg = byOperation[e.operation] ??= { count: 0, cost: 0, failed: 0 };
      agg.count++; agg.cost += e.cost_usd;
      if (!e.ok) agg.failed++;
    }
    return { ...status, byOperation, failed: usageLog.filter(e => !e.ok).length };
  },
};

/** Демо-профиль без структурированных полей — для показа онбординга с нуля. */
export function resetToBlankProfile(): void {
  profile = {
    ...profile, resume_text: '', extras_text: '', perimeter: '', geo: '',
    industries: '', exclude: '', breadth: 'medium', salary_range: '', photo_policy: 'auto',
    languages: [], work_auth: [], scale: null, relocation: null, gaps: [], roles: [],
    linkedin_url: '', linkedin_complete: false, years_exp: null,
  };
  facts = [];
}

/** Демо-профиль без немецкого — блокер на месте o2 виден сразу. */
export function demoProfile(): Profile { return profile; }

// ── Демо: коуч, ревью, мастер-резюме ────────────────────────────────────────
let coachMessages: CoachMessage[] = [];
let coachProposals: CoachProposal[] = [];
let coachSkipped: string[] = [];
let masterResume: MasterResume | null = null;

function coachView(): CoachView {
  return {
    messages: coachMessages, proposals: coachProposals,
    agenda: coachAgenda(profile, facts, { skipped: coachSkipped }), progress: coachProgress(profile, facts),
  };
}

/** Вопрос демо-коуча по теме повестки — та же повестка, что у настоящего. */
function coachQuestion(t: ReturnType<typeof coachAgenda>[number] | undefined, answered: boolean): string {
  const ack = answered ? 'Got it — I’ve turned that into a suggestion below; apply it if it’s accurate. ' : 'Let’s make your resume screen-proof, one question at a time. ';
  if (!t) return ack + 'That covers it.';
  switch (t.kind) {
    case 'review_facts': return ack + 'First, a few facts from your resume are still unconfirmed — open “Review facts” and go through them; it takes about two minutes.';
    case 'fact_number': {
      const fct = facts.find(x => x.id === t.fact_id);
      return ack + `About “${fct?.action ?? t.title}”: ${fct ? defaultFactQuestion(fct) : 'what was the measurable result?'}`;
    }
    case 'role_achievements': return ack + `In your role ${t.role}, what was the single biggest result — what changed, by how much, compared with what?`;
    case 'scale': return ack + 'What was the largest team you were responsible for, direct and indirect, and how many of them were managers?';
    case 'languages': return ack + 'Which languages do you work in, and at what CEFR level (A1–C2)?';
    case 'work_auth': return ack + 'Where can you work without sponsorship?';
    case 'gap_reason': return ack + `What did you do during ${t.title.replace('The gap ', '')}? One plain sentence is enough.`;
    case 'relocation': return ack + 'Are you open to relocating, and would you need a relocation package?';
    case 'perimeter': return ack + 'Which 2–4 role titles are you targeting, and where?';
    case 'master_resume': return ack + 'Your profile covers what a screener looks for. Build the master resume — it goes through two review rounds before you see it.';
  }
}

const DEMO_REVIEWS: Record<'resume' | 'letter', DocumentReview> = {
  resume: {
    rewrites: 1,
    rounds: [
      {
        round: 1, verdict: 'revise', code_issues: ['[ai_isms] Reads as machine-written: “spearheaded”'],
        issues: [
          { type: 'factual', severity: 'high', quote: 'Led a 30-person operations organisation', problem: 'The fact bank says 25 people, not 30', fix: 'Grew the operations team from 8 to 25 people, including 4 managers' },
          { type: 'duplication', severity: 'high', quote: 'Cut delivery lead time by 40%', problem: 'The 40% lead-time cut appears in the summary and in two bullets', fix: 'Keep it in the first Nordic Freight bullet only; use the WMS saving in the summary' },
          { type: 'ai_ism', severity: 'low', quote: 'Spearheaded a seamless WMS migration', problem: '“Spearheaded” and “seamless” read as generated', fix: 'Moved the warehouse network to a single WMS — saving EUR 620K a year' },
        ],
      },
      { round: 2, verdict: 'pass', code_issues: [], issues: [] },
    ],
  },
  letter: {
    rewrites: 2,
    rounds: [
      {
        round: 1, verdict: 'revise', code_issues: ['[stoplist] Stop-list phrase: “i am excited to apply”'],
        issues: [
          { type: 'cliche', severity: 'low', quote: 'I am excited to apply', problem: 'Banned opening, says nothing', fix: 'Open with the Denmark expansion and the three-country fact' },
          { type: 'far_fetched', severity: 'high', quote: 'your culture of innovation', problem: 'Nothing in the signal or posting says this', fix: 'Remove; talk about the expansion instead' },
        ],
      },
      {
        round: 2, verdict: 'revise', code_issues: [],
        issues: [
          { type: 'duplication', severity: 'high', quote: 'cut delivery lead time by 40%', problem: 'The same number in the first and the fourth paragraph', fix: 'Keep it in the first paragraph only' },
        ],
      },
    ],
  },
};

/** Тот же поток событий, что присылает воркер: черновик, два ревью, переписывания. */
async function simulateReview(kind: 'resume' | 'letter', onEvent?: (e: DocEvent) => void): Promise<DocumentReview> {
  const r = DEMO_REVIEWS[kind];
  const say = onEvent ?? (() => {});
  say({ stage: 'draft', message: 'Writing the first draft' });
  await delay(900);
  for (const round of r.rounds) {
    say({ stage: 'review', round: round.round, message: `Reviewer, round ${round.round}: checking facts, repeats, clichés and AI-isms` });
    await delay(800);
    const n = round.issues.length + round.code_issues.length;
    say({ stage: 'review', round: round.round, issues: n, message: `Reviewer, round ${round.round}: ${n} remark${n === 1 ? '' : 's'}` });
    if (n) {
      say({ stage: 'revise', round: round.round, message: `Rewriting to address ${n} remark${n === 1 ? '' : 's'}` });
      await delay(900);
    }
  }
  say({ stage: 'final', message: 'Final checks' });
  await delay(200);
  return r;
}

function masterDoc(): ResumeDoc {
  const confirmed = facts.filter(x => x.confirmed);
  return {
    headline: profile.perimeter.split(';')[0]?.trim() || 'Operations leader',
    summary: [
      'Operations leader who ran a three-country Nordic network and cut delivery lead time by 40% in two quarters.',
      'Grew teams from 8 to 25 people, including 4 managers; budget EUR 4.2M.',
    ],
    summary_support: [0, 2],
    facts_line: 'EU work permit — no sponsorship needed · English C1, Swedish B1, Russian C2 · open to relocation · linkedin.com/in/mkovaleva',
    competencies: ['S&OP', 'WMS', 'Network planning', 'Budgeting', 'Lean', 'Site launches', 'Operations KPIs'],
    experience: [
      {
        company: 'Nordic Freight Group', role_title: 'Head of Operations', period_from: '2021-02', period_to: null,
        context_line: 'Team of 25, 4 managers, budget EUR 4.2M, 3 countries',
        bullets: confirmed.filter(x => x.role_title === 'Head of Operations').slice(0, 5)
          .map(x => [x.action, x.result].filter(Boolean).join(' — ')),
        condensed: false,
      },
      {
        company: 'Baltic Logistics', role_title: 'Operations Manager', period_from: '2017-01', period_to: '2021-01',
        context_line: 'Team of 8',
        bullets: confirmed.filter(x => x.role_title === 'Operations Manager').map(x => [x.action, x.result].filter(Boolean).join(' — ')),
        condensed: false,
      },
    ],
    education: ['MSc Industrial Engineering, KTH, 2014'],
    format_variant: 'intl', language: 'en',
    facts_used: confirmed.map(x => x.id).slice(0, 8),
  };
}

export type { CheckResult };
