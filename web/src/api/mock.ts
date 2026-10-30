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
  evaluateGaps, reanalyseAfterProfileChange, checkBudget, findDuplicate, companyKey,
  estimateRunSeconds, type Demand,
} from '@huntback/core';
import type {
  Api, Profile, Fact, Opportunity, Analysis, OpportunityDetail,
  DocumentRecord, ImportResult, ParsedJob, UsageSummary, Me,
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
];

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
) => ({ expectation, weight, evidence, fact_id, source_hint: hint, strength, gap_class: gap, bridge, gap_answer: answer });

const analyses: Record<string, Analysis> = {
  o1: {
    expectations: [
      exp('Running operations across several Nordic countries', 'must', 'Operations in Sweden, Denmark and Finland at Nordic Freight', 'f9', 'operations in Sweden, Denmark and Finland', 'strong'),
      exp('A team of 40+ with managers reporting in', 'must', 'Team of 25, 4 managers', 'f1', 'team from 8 to 25 people', 'partial', 'soft', 'trajectory', 'Tripled the team in three years and manages managers, not just specialists'),
      exp('Measurable operating cost reduction', 'must', 'Single WMS, saving EUR 620K a year', 'f3', 'single WMS, saving EUR 620K', 'strong'),
      exp('Experience scaling a network fast', 'important', 'Two sites at planned volume in 5 months instead of 9', 'f5', 'planned volume in 5 months', 'strong'),
      exp('Working-level Swedish', 'important', 'Swedish B1', null, '', 'partial', 'soft', 'analogous_tools', 'B1 plus working English; operations meetings at Nordic Freight ran in English'),
      exp('Last-mile experience', 'nice', 'Freight logistics experience, not last mile', null, '', 'gap', 'soft', 'transferable_metrics', 'Lead time and late-shipment metrics read the same in both models'),
    ],
    blockers: [], score: 0,
    uvp: 'The only candidate with proven experience running operations in three Nordic countries at once and a demonstrated 40% cut in delivery lead time — exactly the task that comes with entering Denmark.',
    objection: { risk: 'Can’t handle the scale: we have 40+ people, the candidate had 25', answer: 'The team grew from 8 to 25 under the candidate and already includes four managers — that is managing managers, not just specialists' },
    reconstructed: false,
  },
  o2: {
    expectations: [
      exp('Fluent German', 'must', 'No German in the profile', null, '', 'gap', 'hard'),
      exp('Managing a team of 60+', 'must', 'Team of 25, 4 managers', 'f1', 'team from 8 to 25 people', 'partial', 'soft', 'trajectory', 'Team growth trajectory and managing managers'),
      exp('E-commerce fulfilment experience', 'must', 'Freight and warehouse logistics experience', 'f3', 'single WMS, saving EUR 620K', 'partial', 'soft', 'transferable_metrics', 'WMS and lead time metrics transfer between models'),
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

const usageLog = [
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

  async getProfile() {
    await delay(140);
    return { profile, audit: auditProfile(profile, facts), facts };
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
    const base = analyses[id] ?? analyses.o1;
    analyses[id] = base;
    const a = withBlockers(id, base);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, status: 'analysed', score: a.score } : o));
    return { analysis: a, coverage: coverage(a.expectations) };
  },

  async makeResume(id) {
    await delay(1800);
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
      facts_used: doc.facts_used, checks, created_at: new Date().toISOString(),
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'resume'), rec];
    return { doc, checks };
  },

  async makeLetter(id) {
    await delay(1900);
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
      facts_used: ['f2', 'f3', 'f1'], checks, created_at: new Date().toISOString(),
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'letter'), rec];
    return { doc, checks };
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
    languages: [], work_auth: [], scale: null, relocation: null, gaps: [], roles: [],
    linkedin_url: '', linkedin_complete: false, years_exp: null,
  };
  facts = [];
}

/** Демо-профиль без немецкого — блокер на месте o2 виден сразу. */
export function demoProfile(): Profile { return profile; }
