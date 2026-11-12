// Сквозной прогон API против локального воркера и заглушки OpenAI.
import { RESUME, EXTRAS, POSTINGS } from './persona.mjs';
const B = process.env.BASE ?? 'http://127.0.0.1:8787';
const H = { Cookie: 'sid=sid-test; csrf=csrf-test', 'X-Huntback-CSRF': 'csrf-test', 'Content-Type': 'application/json' };
const call = async (method, path, body, extra = {}) => {
  const r = await fetch(B + '/api' + path, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
  return extra.Accept ? t : JSON.parse(t);
};
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

await call('POST', '/account/reset', { scope: 'all' });
await call('PUT', '/profile', { resume_text: RESUME, extras_text: EXTRAS, perimeter: 'Head of Operations; VP Supply Chain', geo: 'Sweden, Germany' });
const a = await call('POST', '/profile/audit');
ok(a.facts.length >= 6, `audit: ${a.facts.length} facts`);
ok(!a.facts.some(f => /award/.test(f.action)), 'audit: invented quote dropped');
ok(a.facts.every(f => f.review && f.review.status === 'pending'), 'audit: every fact has a review');
const q = a.facts.find(f => f.review.kind === 'question');
const rw = a.facts.find(f => f.review.kind === 'rewrite');
ok(!!q && !!rw, `audit: question (${q?.review.question.slice(0, 50)}) and rewrite (${rw?.review.rewrite?.action})`);

const ans = await call('POST', `/profile/facts/${q.id}/answer`, { answer: 'Cut carrier costs by 18% in the first year' });
ok(ans.fact.confirmed && /18/.test(ans.fact.result) && ans.fact.review.status === 'answered', 'fact answer: rewritten and confirmed');
await call('PATCH', `/profile/facts/${rw.id}`, { ...rw.review.rewrite, confirmed: true, review: { ...rw.review, status: 'accepted' } });
const prof = await call('GET', '/profile');
for (const f of prof.facts) if (!f.confirmed) await call('PATCH', `/profile/facts/${f.id}`, { confirmed: true, review: { ...f.review, status: 'accepted' } });
ok((await call('GET', '/profile')).facts.every(f => f.confirmed), 'all facts confirmed');

let c = await call('GET', '/coach');
ok(c.agenda.length > 1, `coach agenda: ${c.agenda.map(t => t.kind).join(', ')}`);
c = await call('POST', '/coach/message', { text: '' });
ok(c.messages.length === 1, 'coach: opening question: ' + c.messages[0].text.slice(0, 80));
c = await call('POST', '/coach/message', { text: 'At Baltic Logistics I cut warehouse picking errors by 35% in one year' });
const prop = c.proposals.find(p => p.status === 'open');
ok(!!prop, 'coach: proposal from answer: ' + prop?.label);
c = await call('POST', `/coach/proposals/${prop.id}`, { action: 'apply' });
ok(prop.kind === 'profile' ? c.profile.scale?.team_max === 35 : c.facts.some(f => /35%/.test(f.result ?? '')), 'coach: proposal applied (' + prop.kind + ')');
ok(!c.agenda.some(t => t.id === 'scale') || prop.kind !== 'profile', 'coach: answered topic left the agenda');
c = await call('POST', '/coach/message', { text: 'I am not sure, maybe later' });
ok(!c.proposals.some(p => p.status === 'open' && /maybe later/.test(p.label)), 'coach: no fact from an answer without a number');

const mr = await call('POST', '/profile/master-resume', {}, { Accept: 'application/x-ndjson' });
const mrEvents = mr.trim().split('\n').map(l => JSON.parse(l));
const mrDone = mrEvents.at(-1);
ok(!mrDone.error && mrDone.result.review.rounds.length === 2, `master resume: ${mrEvents.length} events, rounds ${mrDone.result?.review?.rounds?.length}, rewrites ${mrDone.result?.review?.rewrites}`);
ok(!JSON.stringify(mrDone.result.doc).includes('Spearheaded'), 'master resume: AI-ism removed by the review loop');

const batch = await call('POST', '/opportunities/import/batch', { text: POSTINGS.join('\n---\n') });
ok(batch.results.filter(r => r.ok).length === 3, 'batch import: ' + batch.results.map(r => r.ok ? r.company : r.error).join(' | '));
const list = await call('GET', '/opportunities');
const fj = list.find(o => /Fjällbo/.test(o.company));
ok(fj && !/Easy Apply|applicants/.test(fj.jd_text), 'batch import: LinkedIn noise cleaned');

const an = await call('POST', `/opportunities/${fj.id}/analyse`);
const fixes = an.analysis.expectations.map(e => e.fix?.reason ?? 'none');
ok(fixes.includes('wording') && fixes.includes('missing_fact'), 'analyse fixes: ' + fixes.join(', '));
ok(!an.analysis.expectations.some(e => e.fix?.reason === 'wording' && /140/.test(e.fix.rewrite)), 'invented 140-person wording turned into a question');
ok(an.potential.afterWording >= an.potential.now, `potential: ${an.potential.now}% → ${an.potential.afterWording}% → ${an.potential.afterAnswers}%`);
const fx = await call('POST', `/opportunities/${fj.id}/fix`, { action: 'apply_all' });
ok(fx.analysis.score >= an.analysis.score, `apply_all: ${an.analysis.score}% → ${fx.analysis.score}%`);
const qi = fx.analysis.expectations.findIndex(e => e.fix?.reason === 'missing_fact' && e.fix.status === 'open');
const fa = await call('POST', `/opportunities/${fj.id}/fix`, { index: qi, action: 'answer', answer: 'Yes, I ran carrier tenders for 14 carriers, saving 9% on freight' });
ok(fa.analysis.expectations[qi].fix.status === 'answered' && fa.analysis.score > fx.analysis.score, `answer: ${fx.analysis.score}% → ${fa.analysis.score}% (${fa.note})`);

const rs = await call('POST', `/opportunities/${fj.id}/resume`, {}, { Accept: 'application/x-ndjson' });
const rsEv = rs.trim().split('\n').map(l => JSON.parse(l));
const rsDone = rsEv.at(-1).result;
ok(rsDone && rsDone.review.rewrites >= 1 && !JSON.stringify(rsDone.doc).includes('Spearheaded'), `resume: stages ${rsEv.map(e => e.stage).join('>')}`);
const r1 = rsDone.review.rounds[0];
ok(r1.issues.every(i => i.quote !== 'synergistic paradigm shift'), 'reviewer: invented quote dropped');
const lt = await call('POST', `/opportunities/${fj.id}/letter`, {}, { Accept: 'application/x-ndjson' });
const ltDone = lt.trim().split('\n').map(l => JSON.parse(l)).at(-1).result;
ok(ltDone && !/excited to apply/i.test(ltDone.doc.body), `letter: rewrites ${ltDone?.review.rewrites}, checks: ${ltDone?.checks.filter(c => c.level !== 'info').map(c => c.rule).join(',') || 'clean'}`);
const det = await call('GET', `/opportunities/${fj.id}`);
ok(det.documents.length === 2 && det.documents.every(d => d.review), 'documents saved with review trail');

const save = await call('PUT', `/documents/${det.documents.find(d => d.kind === 'letter').id}`, { body: ltDone.doc.body + '\n\nI spearheaded everything.' });
ok(save.checks.some(c => c.rule === 'ai_isms'), 'edited letter re-checked: AI-ism flagged');

const run = await call('POST', '/runs', { mode: 'vacancies' }, { Accept: 'application/x-ndjson' });
const runDone = run.trim().split('\n').map(l => JSON.parse(l)).at(-1);
const after = await call('GET', '/opportunities');
const li = after.filter(o => /linkedin\.com\/jobs\/view\/\d+\/$/.test(o.source_url ?? ''));
ok(runDone.stage === 'done' && li.length >= 1, `search: found ${runDone.found}, added ${runDone.added}, LinkedIn canonical ${li.length}`);
ok(!after.some(o => /Search Page Co/.test(o.company)), 'search: LinkedIn search page dropped');
ok(after.filter(o => /Fjordline/.test(o.company)).length === li.length, 'search: same LinkedIn job not duplicated');
console.log(runDone.notes?.join('\n'));
const usage = await call('GET', '/usage');
console.log('usage by operation:', Object.entries(usage.byOperation).map(([k, v]) => `${k}:${v.count}${v.failed ? '/' + v.failed + ' failed' : ''}`).join(' '));
