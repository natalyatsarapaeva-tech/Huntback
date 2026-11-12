import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAiIsms, dashDensity, findDuplicates, checkStyle, checkResume,
  unbackedNumbers, sanitizeFix, matchPotential, applyWordingFix, applyAllWordingFixes, applyAnsweredFix,
  sanitizeFactReview, defaultFactQuestion, factReviewQueue, coachAgenda, coachProgress,
  type Expectation, type Fact, type Profile, type ResumeDoc,
} from '../src/index.ts';

const fact = (o: Partial<Fact> & { id: string; action: string }): Fact => ({
  scale_tags: [], domain_tags: [], quantified: false, source_hint: 'x y z', confirmed: true, ...o,
});

const exp = (o: Partial<Expectation>): Expectation => ({
  expectation: 'x', weight: 'must', evidence: '', fact_id: null, source_hint: '',
  strength: 'gap', gap_class: 'soft', bridge: null, gap_answer: '', ...o,
});

const profile = (o: Partial<Profile> = {}): Profile => ({
  resume_text: 'Cut delivery lead time by 40%. Budget EUR 4.2M. Saving EUR 620K a year.', extras_text: '',
  perimeter: 'VP Operations', industries: '', exclude: '', geo: 'Sweden', breadth: 'medium',
  languages: [], work_auth: [], relocation: null, scale: null, years_exp: 12, gaps: [],
  salary_range: '', linkedin_url: '', linkedin_complete: false, photo_policy: 'auto', roles: [], ...o,
});

// ── Стиль ───────────────────────────────────────────────────────────────────
test('ИИ-измы: словоформы ловятся, обычные слова — нет', () => {
  const hits = findAiIsms('I spearheaded a seamless migration and delved into data. We moved warehouses.');
  assert.deepEqual(hits.map(h => h.phrase).sort(), ['delve', 'seamless', 'spearheaded']);
  assert.deepEqual(findAiIsms('Cut lead time by 40% in two quarters'), []);
});

test('тире: плотность на 100 слов', () => {
  assert.equal(dashDensity('one two three four'), 0);
  assert.ok(dashDensity('a — b — c — d') > 10);
});

test('повторы: одно достижение дважды — по словам и по числу', () => {
  const d = findDuplicates([
    'Cut delivery lead time by 40% in two quarters',
    'Moved warehouses to a single WMS saving EUR 620K',
    'Reduced delivery lead time by 40% across sites',
    'Grew the team from 8 to 25 people',
  ]);
  assert.deepEqual(d.map(x => [x.a, x.b]), [[0, 2]]);
});

test('стиль в резюме: повторы буллитов и однообразные глаголы', () => {
  const doc: ResumeDoc = {
    headline: 'VP Operations', summary: [], facts_line: '', competencies: ['S&OP', 'WMS', 'Lean', 'KPIs', 'Budgeting', 'Hiring'],
    experience: [{
      company: 'A', role_title: 'Head', period_from: '2021', period_to: null, context_line: '',
      bullets: ['Led planning rebuild, lead time down 40%', 'Led WMS move saving EUR 620K', 'Led hiring of 17 people', 'Led reorganisation keeping 24 of 25'],
    }],
    education: [], format_variant: 'intl', language: 'en', facts_used: [],
  };
  const rules = checkStyle('x', { items: doc.experience[0].bullets }).map(c => c.rule);
  assert.ok(rules.includes('repeated_opening'));
  assert.ok(checkResume(doc).some(c => c.rule === 'repeated_opening'));
});

// ── Правки совпадения ───────────────────────────────────────────────────────
test('числа без источника: K и M раскрываются', () => {
  assert.deepEqual(unbackedNumbers('saved EUR 620000 and cut 40%', ['saving EUR 620K', 'by 40%']), []);
  assert.deepEqual(unbackedNumbers('team of 60', ['team of 25']), ['60']);
});

test('формулировка с выдуманным числом превращается в вопрос', () => {
  const facts = [fact({ id: 'f1', action: 'Grew the team', result: 'from 8 to 25 people', quantified: true })];
  const honest = sanitizeFix({ reason: 'wording', fact_id: 'f1', rewrite: 'Built and led a 25-person operations organisation', question: '', strength_after: 'strong' },
    exp({ strength: 'partial', fact_id: 'f1' }), facts, profile());
  assert.equal(honest!.reason, 'wording');
  const invented = sanitizeFix({ reason: 'wording', fact_id: 'f1', rewrite: 'Led a 60-person organisation', question: '', strength_after: 'strong' },
    exp({ strength: 'partial' }), facts, profile());
  assert.equal(invented!.reason, 'missing_fact');
  assert.equal(invented!.rewrite, '');
  assert.doesNotMatch(invented!.question, /60/, 'the invented number is never suggested to the user');
});

test('правка не ухудшает силу, у закрытого ожидания правки нет, неизвестный факт обнуляется', () => {
  const f = sanitizeFix({ reason: 'wording', fact_id: 'nope', rewrite: 'Ran operations', question: '', strength_after: 'gap' },
    exp({ strength: 'partial' }), [], profile());
  assert.equal(f!.strength_after, 'partial');
  assert.equal(f!.fact_id, null);
  assert.equal(sanitizeFix({ reason: 'wording' }, exp({ strength: 'strong' }), [], profile()), null);
});

test('потенциал совпадения: сейчас → после формулировок → после ответов', () => {
  const list = [
    exp({ strength: 'strong', weight: 'must' }),
    exp({ strength: 'gap', weight: 'must', fix: { reason: 'wording', fact_id: 'f1', rewrite: 'r', question: '', strength_after: 'strong', status: 'open' } }),
    exp({ strength: 'gap', weight: 'important', fix: { reason: 'missing_fact', fact_id: null, rewrite: '', question: 'q', strength_after: 'strong', status: 'open' } }),
    exp({ strength: 'gap', weight: 'nice', fix: { reason: 'real_gap', fact_id: null, rewrite: '', question: '', strength_after: 'gap', status: 'open' } }),
  ];
  const p = matchPotential(list);
  assert.equal(p.now, 33);
  assert.equal(p.afterWording, 67);
  assert.equal(p.afterAnswers, 89);
  assert.deepEqual([p.wordingFixes, p.questions, p.realGaps], [1, 1, 1]);

  const { expectations, applied } = applyAllWordingFixes(list);
  assert.equal(applied, 1);
  assert.equal(expectations[1].strength, 'strong');
  assert.equal(expectations[1].evidence, 'r');
  assert.equal(expectations[1].fix!.status, 'applied');
  assert.equal(applyWordingFix(expectations[1]), expectations[1]);

  const answered = applyAnsweredFix(list[2], 'yes, 30 people', { strength: 'strong', evidence: 'Managed 30 people', fact_id: 'n1' });
  assert.equal(answered.strength, 'strong');
  assert.equal(answered.fix!.status, 'answered');
});

// ── Разбор фактов ───────────────────────────────────────────────────────────
test('факт без числа всегда получает вопрос; формулировка без выдуманных чисел', () => {
  const f = fact({ id: 'f', action: 'Grew the operations team', scale_tags: ['team'] });
  const r = sanitizeFactReview({ kind: 'ok', question: '', rewrite: null, why: '' }, f, ['Grew the operations team']);
  assert.equal(r.kind, 'question');
  assert.match(r.question, /How many people/);
  const bad = sanitizeFactReview({ kind: 'rewrite', rewrite: { action: 'Grew team to 40', how: '', result: '' }, question: '', why: '' }, f, ['Grew the operations team']);
  assert.equal(bad.kind, 'question');
  assert.equal(bad.rewrite, null);
  const q = fact({ id: 'g', action: 'Cut lead time', result: 'by 40%', quantified: true });
  const good = sanitizeFactReview({ kind: 'rewrite', rewrite: { action: 'Cut delivery lead time', how: 'by rebuilding planning', result: '40% faster' }, question: '', why: 'clearer' }, q, ['lead time by 40%']);
  assert.equal(good.kind, 'rewrite');
  assert.equal(good.question, '');
});

test('шаблонные вопросы и очередь разбора', () => {
  assert.match(defaultFactQuestion(fact({ id: 'a', action: 'Moved to a single WMS' })), /went live/);
  assert.match(defaultFactQuestion(fact({ id: 'b', action: 'Optimised costs', scale_tags: ['budget'] })), /money/);
  const q = factReviewQueue([
    fact({ id: 'done', action: 'x', quantified: true, review: { kind: 'ok', question: '', rewrite: null, why: '', status: 'accepted' } }),
    fact({ id: 'new', action: 'y', confirmed: false }),
  ]);
  assert.equal(q[0].id, 'new');
});

// ── Коуч ────────────────────────────────────────────────────────────────────
test('повестка коуча: неподтверждённые, роли без чисел, пустые поля; пропуск работает', () => {
  const p = profile({
    roles: [{ company: 'Nordic', role_title: 'Head of Ops', from: '2021-01-01', to: null }],
    gaps: [{ from: '2020-01', to: '2021-01' }],
  });
  const facts = [
    fact({ id: 'u', action: 'Unconfirmed thing', confirmed: false }),
    fact({ id: 'n', action: 'Ran S&OP', company: 'Nordic', role_title: 'Head of Ops', period_from: '2021' }),
  ];
  const a = coachAgenda(p, facts, { now: new Date('2026-11-12') });
  assert.equal(a[0].kind, 'review_facts');
  const kinds = a.map(t => t.kind);
  for (const k of ['role_achievements', 'fact_number', 'scale', 'languages', 'work_auth', 'gap_reason', 'relocation', 'master_resume']) {
    assert.ok(kinds.includes(k as never), k);
  }
  assert.equal(a[a.length - 1].kind, 'master_resume');
  const skipped = coachAgenda(p, facts, { now: new Date('2026-11-12'), skipped: ['scale', 'languages'] }).map(t => t.id);
  assert.ok(!skipped.includes('scale') && !skipped.includes('languages'));
  assert.ok(coachProgress(p, facts).percent < 50);
});

test('регрессия: metric_value null — это «числа нет», а не 0', async () => {
  const { sanitizeFact } = await import('../src/index.ts');
  const f = sanitizeFact({ action: 'Improved stakeholder communication', source_hint: 'improved stakeholder communication', metric_value: null, result: '' }, () => 'x')!;
  assert.equal(f.metric_value, null);
  assert.equal(f.quantified, false);
});

test('регрессия: «20-minute call» не блокирует письмо как непроверенное число', async () => {
  const { checkLetter } = await import('../src/index.ts');
  const body = 'Would you be open to a 20-minute call next week? I cut costs by 99%.';
  const r = checkLetter({ subject: '', body, word_count: 0, bridge_used: null, facts_used: [], language: 'en' }, 'vacancy', {});
  const nums = r.filter(c => c.rule === 'number_consistency').map(c => c.message);
  assert.equal(nums.length, 1);
  assert.match(nums[0], /99/);
});

test('правка «только здесь» и «переиспользовать»: что уходит в банк фактов', async () => {
  const { reuseAppliedFix, wordingsToSave, addWording, MAX_WORDINGS } = await import('../src/index.ts');
  const fix = (fact_id: string | null, rewrite: string) => ({ reason: 'wording' as const, fact_id, rewrite, question: '', strength_after: 'strong' as const, status: 'open' as const });
  const a = exp({ strength: 'partial', fix: fix('f1', 'Owned on-time delivery as a network KPI') });
  const b = exp({ strength: 'gap', fix: fix('f2', 'Ran last-mile delivery') });
  const c = exp({ strength: 'gap', fix: fix(null, 'No fact to save into') });

  const place = applyWordingFix(a);
  assert.equal(place.fix!.scope, 'place');
  const reused = applyWordingFix(b, 'reuse');
  assert.equal(reused.fix!.scope, 'reuse');
  assert.equal(applyWordingFix(c, 'reuse').fix!.scope, 'place', 'без факта сохранять некуда');

  assert.deepEqual([...wordingsToSave([place, reused]).entries()], [['f2', ['Ran last-mile delivery']]]);
  const upgraded = reuseAppliedFix(place);
  assert.equal(upgraded.fix!.scope, 'reuse');
  assert.equal(reuseAppliedFix(exp({ strength: 'gap', fix: fix('f1', 'x') })).fix!.scope, undefined, 'открытую правку так не сохранить');

  const all = applyAllWordingFixes([a, b], 'reuse');
  assert.equal(wordingsToSave(all.expectations).size, 2);

  const f = fact({ id: 'f1', action: 'Reduced late shipments', result: 'from 12% to 3%' });
  assert.deepEqual(addWording(f, 'Owned on-time delivery: late shipments 12% → 3%'), ['Owned on-time delivery: late shipments 12% → 3%']);
  assert.equal(addWording({ ...f, wordings: ['Owned on-time delivery'] }, 'owned on-time delivery'), null, 'без дублей');
  assert.equal(addWording(f, 'Reduced late shipments from 12% to 3%'), null, 'не повторяет сам факт');
  const many = Array.from({ length: MAX_WORDINGS }, (_, i) => 'w' + i);
  assert.deepEqual(addWording({ ...f, wordings: many }, 'new')!.slice(-1), ['new']);
  assert.equal(addWording({ ...f, wordings: many }, 'new')!.length, MAX_WORDINGS);
});
