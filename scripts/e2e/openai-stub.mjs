// Заглушка OpenAI Responses API для сквозной проверки без ключа.
//
// Отвечает по имени схемы (text.format.name) и строит ответ ИЗ ПРОМПТА: факты
// режет из текста резюме, ожидания — из текста вакансии, резюме — из банка
// фактов. Поэтому настоящая логика воркера работает по-настоящему: цитаты
// сверяются с резюме, числа — с фактами, ревью находит то, что в черновике
// действительно есть. Специально заложены ошибки, которые должны быть пойманы:
//   — формулировка с выдуманным числом (ядро обязано превратить её в вопрос);
//   — первый черновик резюме с ИИ-измами и повтором (ревью обязано вернуть);
//   — первый черновик письма со штампом в начале.
//
// Запуск: node scripts/e2e/openai-stub.mjs [порт]; журнал вызовов — GET /log.

import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8799);
const log = [];

const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = b ? s.indexOf(b, i + a.length) : -1;
  return s.slice(i + a.length, j < 0 ? undefined : j).trim();
};
const sentencesOf = t => t.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
const words = t => t.toLowerCase().match(/[a-z0-9%]+/g) ?? [];
const STOP = new Set('the a an and or of to in on for with by from at as is was were be that this it its into our you your we will who are have has'.split(' '));
const content = t => new Set(words(t).filter(w => w.length > 3 && !STOP.has(w)));

/** Банк фактов из стабильного префикса: «id · action · how · result · [hint]». */
function factBank(prefix) {
  const out = [];
  for (const line of prefix.split('\n')) {
    const m = line.match(/^([0-9a-f-]{36}|[a-z0-9]{1,12}) · (.+)$/i);
    if (!m) continue;
    const parts = m[2].split(' · ');
    out.push({ id: m[1], action: parts[0], how: parts[1] ?? '', result: parts[2] ?? '', text: m[2].replace(/\[.*\]$/, '') });
  }
  return out;
}

// ── Аудит ───────────────────────────────────────────────────────────────────
function audit(instr) {
  const resume = between(instr, 'RESUME:', 'ADDITIONAL NOTES:');
  const facts = [];
  const roles = [];
  let company = '', role = '', from = '', to = '';
  for (const raw of resume.split('\n')) {
    const line = raw.trim();
    const head = line.match(/^(.+?),\s*([^—]+?)\s+—\s+(.+?),\s*(\d{4})\s*[—–-]\s*(\d{4}|present)/i);
    if (head) {
      company = head[1].trim(); role = head[3].trim(); from = head[4]; to = head[5] === 'present' ? '' : head[5];
      roles.push({ company, role_title: role, from: from + '-01-01', to: to ? to + '-01-01' : '' });
      continue;
    }
    if (!company) continue;
    for (const sent of sentencesOf(line)) {
      const ws = sent.split(/\s+/);
      if (ws.length < 4 || /^(education|skills)/i.test(sent)) continue;
      const hint = ws.slice(0, Math.min(6, ws.length)).join(' ').replace(/[.,;]$/, '');
      const num = sent.match(/(\d[\d.,]*)\s*(%|people|managers|sites|countries|months|M|K)?/);
      const quantified = !!num;
      const kind = /^responsible/i.test(sent) ? 'rewrite' : quantified ? 'ok' : 'question';
      facts.push({
        company, role_title: role, period_from: from, period_to: to,
        action: sent.replace(/\.$/, '').split(/,| by | from /)[0],
        how: '', result: quantified ? sent.slice(sent.indexOf(num[0])).replace(/\.$/, '') : '',
        metric_value: quantified ? Number(num[1].replace(/,/g, '')) : null, metric_unit: num?.[2] ?? '',
        scale_tags: /team|people|managers/i.test(sent) ? ['team'] : /budget|EUR|saving/i.test(sent) ? ['budget'] : [],
        domain_tags: ['operations'], source_hint: hint,
        review: {
          kind,
          question: kind === 'question' ? `What changed because of this, in numbers — for “${hint}”?` : '',
          rewrite: kind === 'rewrite'
            ? { action: sent.replace(/^responsible for/i, 'Ran').replace(/\.$/, ''), how: '', result: '' }
            : { action: '', how: '', result: '' },
          why: kind === 'rewrite' ? '“Responsible for” is a duty; a verb shows what you did.' : kind === 'question' ? 'A number is the strongest signal at screening.' : '',
        },
      });
    }
  }
  // Одна выдуманная цитата: воркер обязан её отбросить.
  facts.push({ ...facts[0], action: 'Won an industry award', source_hint: 'won the national logistics award', result: '', metric_value: null, review: { kind: 'ok', question: '', rewrite: { action: '', how: '', result: '' }, why: '' } });
  return {
    facts, roles,
    questions: [{ about: 'team', question: 'How many people were on your largest team?' }],
    recommendations: ['Lead each role with the biggest measurable result.'],
  };
}

// ── Вакансии ────────────────────────────────────────────────────────────────
function ingest(instr) {
  const text = between(instr, 'TEXT:', '\nRules:');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const [role = '', second = ''] = lines;
  const company = second.split(/[·|,]/)[0].trim();
  const city = (second.split(/[·|]/)[1] ?? '').split(',')[0].trim();
  const country = /stockholm|göteborg|sweden/i.test(text) ? 'Sweden' : /berlin|munich|germany/i.test(text) ? 'Germany' : /oslo|norway/i.test(text) ? 'Norway' : '';
  const reqs = lines.filter(l => /^[-•]/.test(l)).map(l => l.replace(/^[-•]\s*/, ''));
  const team = text.match(/team of (\d+)/i);
  const german = /fluent german|deutsch/i.test(text);
  return {
    company, role_title: role, city, country, industry: 'logistics', size: '', language: 'en', seniority: 'Head',
    requirements: reqs, responsibilities: [], contact_email: '', salary: '', posted_date: '',
    confidence: company && role ? 'high' : 'low', is_job_posting: !!(company && role),
    demand: {
      language_required: german ? 'German C1' : '', language_mandatory: german, sponsorship_offered: null,
      team_size: team ? Number(team[1]) : null, budget: null, manages_managers: /managers/i.test(text),
      lead_without_authority: false, license_required: '', license_mandatory: false, salary_max: null,
    },
  };
}

function analyse(prefix, instr) {
  const facts = factBank(prefix);
  const jd = between(instr, '=== JOB POSTING TEXT ===', null);
  let reqs = jd.split('\n').map(l => l.trim()).filter(l => /^[-•]/.test(l)).map(l => l.replace(/^[-•]\s*/, '')).slice(0, 6);
  if (!reqs.length) reqs = ['Leading operations across several sites', 'Managing managers', 'Cost reduction with measurable results', 'Stakeholder management at executive level', 'Scaling a network'];
  while (reqs.length < 5) reqs.push('Experience in a fast-growing company');
  let inventedOnce = false;
  const expectations = reqs.map((req, i) => {
    const cw = content(req);
    const best = facts.map(f => ({ f, n: [...content(f.text)].filter(w => cw.has(w)).length }))
      .sort((a, b) => b.n - a.n)[0];
    const weight = i < 3 ? 'must' : i < 5 ? 'important' : 'nice';
    const base = { expectation: req, weight, bridge: null, gap_answer: '', gap_class: null };
    if (best && best.n >= 3) {
      return { ...base, evidence: best.f.text, fact_id: best.f.id, source_hint: '', strength: 'strong',
        fix: { reason: null, fact_id: null, rewrite: '', question: '', strength_after: 'strong' } };
    }
    if (best && best.n === 2) {
      return { ...base, evidence: best.f.text, fact_id: best.f.id, source_hint: '', strength: 'partial', gap_class: 'soft', bridge: 'transferable_metrics',
        fix: { reason: 'wording', fact_id: best.f.id, rewrite: `${best.f.action} — ${req.toLowerCase()}`, question: '', strength_after: 'strong' } };
    }
    if (!inventedOnce && facts[0]) {
      inventedOnce = true;
      // Выдуманное число в формулировке: ядро должно превратить это в вопрос.
      return { ...base, evidence: 'No direct evidence', fact_id: null, source_hint: '', strength: 'gap', gap_class: 'soft', bridge: 'trajectory',
        fix: { reason: 'wording', fact_id: facts[0].id, rewrite: `Led a 140-person organisation delivering ${req.toLowerCase()}`, question: '', strength_after: 'strong' } };
    }
    if (/german/i.test(req)) {
      return { ...base, evidence: 'No German in the profile', fact_id: null, source_hint: '', strength: 'gap', gap_class: 'hard',
        fix: { reason: 'real_gap', fact_id: null, rewrite: '', question: '', strength_after: 'gap' } };
    }
    return { ...base, evidence: 'Not stated in the profile', fact_id: null, source_hint: '', strength: 'gap', gap_class: 'soft', bridge: 'transferable_metrics',
      fix: { reason: 'missing_fact', fact_id: null, rewrite: '', question: `Have you done this: ${req.toLowerCase()}? With what result?`, strength_after: 'strong' } };
  });
  return {
    expectations, blockers: [],
    uvp: `Ran operations with measured results: ${facts.slice(0, 2).map(f => f.result || f.action).join('; ')}.`,
    objection: { risk: 'Will the candidate handle a bigger organisation?', answer: 'Grew the team and manages managers already.' },
    reconstructed: !jd,
  };
}

// ── Документы ───────────────────────────────────────────────────────────────
function resume(prefix, instr) {
  const facts = factBank(prefix).filter(f => /\d/.test(f.text));
  const revision = instr.includes('=== REVISION ===');
  const role = between(instr, 'Opportunity:', '\n').split(' · ')[1] || 'Operations leader';
  const bullets = facts.slice(0, 6).map(f => [f.action, f.result].filter(Boolean).join(' — '));
  if (!revision) {
    // Первый черновик с типичными огрехами генерации.
    bullets.unshift('Spearheaded a seamless transformation of the operating model, delivering robust results');
    if (bullets[1]) bullets.push(bullets[1] + ' across the network');
  }
  return {
    headline: role,
    summary: [`Operations leader: ${facts[0] ? (facts[0].result || facts[0].action) : 'measurable results'}.`],
    summary_support: [revision ? 0 : 1],
    facts_line: 'Work authorization: EU permit · English C1 · open to relocation',
    competencies: ['S&OP', 'WMS', 'Network planning', 'Budgeting', 'Lean', 'KPIs'],
    experience: [{
      company: 'Nordic Freight Group', role_title: 'Head of Operations', period_from: '2021', period_to: '',
      context_line: 'Three countries', bullets, condensed: false,
    }],
    education: ['MSc Industrial Engineering, KTH'],
    facts_used: facts.slice(0, 6).map(f => f.id),
  };
}

function letter(prefix, instr) {
  const facts = factBank(prefix).filter(f => /\d/.test(f.text));
  const revision = instr.includes('=== REVISION ===');
  const [company, role] = between(instr, 'Opportunity:', '\n').split(' · ');
  const f1 = facts[0], f2 = facts[1];
  const open = revision
    ? `${company} is hiring a ${role} while it grows the network, and that is the work I have done for the last four years.`
    : 'I am excited to apply for this role, which aligns perfectly with my passion for operations.';
  const body = [
    open,
    `At my current company I ${f1 ? (f1.action + ' ' + f1.result).toLowerCase() : 'ran operations'}. ${f2 ? 'I also ' + (f2.action + ' ' + f2.result).toLowerCase() + '.' : ''}`,
    `What ${company} needs from a ${role} is a network that keeps its delivery promise while it grows; I have built exactly that, and I can show the numbers behind it.`,
    'The posting asks for more scale than I have run so far. The team I lead grew threefold under me, and the planning model behind it was designed to grow further.',
    'Would you be open to a 20-minute call next week?',
  ].join('\n\n');
  return { subject: `${role} — operations in numbers`, body, bridge_used: 'trajectory', facts_used: facts.slice(0, 2).map(f => f.id) };
}

function review(instr) {
  const doc = between(instr, '=== DOCUMENT ===', '=== END ===');
  const issues = [];
  const spear = doc.match(/Spearheaded[^\n]*/);
  if (spear) issues.push({ type: 'ai_ism', quote: spear[0].slice(0, 60), problem: 'Machine-written phrasing with no fact behind it', fix: 'Delete this bullet', severity: 'high' });
  const lines = doc.split('\n').map(l => l.replace(/^\s*\d+\.\s*/, '').trim());
  const dup = lines.find((l, i) => l.length > 20 && lines.some((m, j) => j > i && m.startsWith(l)));
  if (dup) issues.push({ type: 'duplication', quote: dup.slice(0, 50), problem: 'The same achievement appears twice', fix: 'Keep it once', severity: 'high' });
  const excited = doc.match(/I am excited to apply[^.]*/);
  if (excited) issues.push({ type: 'cliche', quote: excited[0], problem: 'Clichéd opening that says nothing about the company', fix: 'Open with the company’s situation and a fact with a number', severity: 'high' });
  // Цитата, которой в документе нет: воркер обязан её отбросить.
  issues.push({ type: 'other', quote: 'synergistic paradigm shift', problem: 'invented', fix: 'n/a', severity: 'low' });
  return { verdict: issues.length > 1 ? 'revise' : 'pass', issues, summary: issues.length > 1 ? 'Needs another pass' : 'Ready' };
}

function swap(instr) {
  const ss = sentencesOf(between(instr, 'REPLACED with fictional ones.', 'Answer two questions'));
  return { broken: ss.filter(s => /Vertigo Systems|Head of Widgets/.test(s)).slice(0, 3), generic: [] };
}

// ── Коуч и правки ───────────────────────────────────────────────────────────
function coach(instr) {
  const msg = between(instr, 'The candidate just wrote:', '\n\nWhat to do').trim();
  const topic = between(instr, 'Current topic:', '\n');
  const topicId = topic.split(' · ')[0];
  const agenda = between(instr, 'Agenda — what is missing, most valuable first (id · title · goal):', 'Current topic:')
    .split('\n').map(l => l.split(' · ')[0]).filter(Boolean);
  const answered = msg && !msg.startsWith('(');
  const nextId = answered ? (agenda.find(a => a !== topicId) ?? topicId) : topicId;
  const nextTitle = between(instr, nextId + ' · ', ' · ') || 'the next topic';
  const num = msg.match(/\d[\d.,]*/);
  const new_facts = answered && num && !topicId.startsWith('scale') ? [{
    company: '', role_title: '', action: msg.split(/[,.]/)[0].slice(0, 120), how: '', result: msg.slice(0, 160),
    metric_value: Number(num[0].replace(/,/g, '')), metric_unit: '', scale_tags: [], user_quote: msg.slice(0, 80),
  }] : [];
  const scaleNum = topicId === 'scale' && num ? Number(num[0]) : null;
  return {
    reply: (answered ? 'Thanks — that is a strong, specific result. ' : 'Let’s start. ') + `Next: ${nextTitle}. What exactly changed, and by how much?`,
    topic_id: nextId, topic_done: !!answered,
    new_facts, fact_updates: [],
    profile_updates: {
      team_max: scaleNum, managers_max: null, budget_max: null, geo_scope: '', languages: [], work_auth: [],
      relocation: null, gap_reason: '', perimeter: '',
    },
  };
}

function refine(instr) {
  const answer = between(instr, "Candidate's answer:", '\n');
  const fact = between(instr, 'Fact now:', '\n');
  const num = answer.match(/\d[\d.,]*\s*(%|people|managers|EUR|K|M)?/);
  return {
    action: fact.split(' · ')[0], how: '', result: answer.replace(/\.$/, ''),
    metric_value: num ? Number(num[0].replace(/[^\d.]/g, '')) : null, metric_unit: num?.[1] ?? '', scale_tags: [],
  };
}

function rescore(instr) {
  const answer = between(instr, "Candidate's answer:", '\n');
  const yes = !/^no\b/i.test(answer);
  const num = answer.match(/\d[\d.,]*/);
  return {
    relevant: yes, strength: num ? 'strong' : 'partial', evidence: answer,
    fact: { company: '', role_title: '', action: answer.split(/[,.]/)[0].slice(0, 120), how: '', result: answer,
      metric_value: num ? Number(num[0].replace(/,/g, '')) : null, metric_unit: '', scale_tags: [], user_quote: answer.slice(0, 60) },
  };
}

// ── Поиск ───────────────────────────────────────────────────────────────────
let jobSeq = 4100000000;
function discover(instr, domains) {
  const linkedin = domains?.length === 1 && domains[0] === 'linkedin.com';
  const vacancies = domains && domains.length > 1;
  const angle = between(instr, 'Role perimeter and industries:', '\n');
  const today = new Date().toISOString().slice(0, 10);
  if (linkedin) {
    const id = ++jobSeq;
    return { items: [
      { company: `Fjordline Logistics`, website: '', industry: 'logistics', city: 'Stockholm', country: 'Sweden', size: '800', kind: 'vacancy',
        role_title: angle, signal: `${angle} posting on LinkedIn`, signal_date: today,
        source_url: `https://se.linkedin.com/jobs/view/${angle.toLowerCase().replace(/\s+/g, '-')}-at-fjordline-${id}?trk=public_jobs`, why_fit: 'fits',
        contact: { name: '', title: '', email: 'made.up@example.com', linkedin: '' } },
      // Та же вакансия ещё раз под другим заголовком — дедуп по id.
      { company: `Fjordline Logistics AB`, website: '', industry: 'logistics', city: 'Stockholm', country: 'Sweden', size: '800', kind: 'vacancy',
        role_title: angle + ' Nordics', signal: 'dup', signal_date: today,
        source_url: `https://www.linkedin.com/jobs/view/${id}/`, why_fit: 'fits', contact: { name: '', title: '', email: '', linkedin: '' } },
      // Страница поиска вместо вакансии — должна быть отброшена.
      { company: 'Search Page Co', website: '', industry: '', city: '', country: 'Sweden', size: '', kind: 'vacancy',
        role_title: angle, signal: 'search', signal_date: '', source_url: 'https://www.linkedin.com/jobs/search/?keywords=coo', why_fit: '',
        contact: { name: '', title: '', email: '', linkedin: '' } },
    ] };
  }
  if (vacancies) {
    return { items: [{ company: 'Baltvia Retail', website: '', industry: 'retail', city: 'Göteborg', country: 'Sweden', size: '2000', kind: 'vacancy',
      role_title: angle, signal: 'Career site posting', signal_date: today, source_url: `https://baltvia.teamtailor.com/jobs/${++jobSeq}-${angle.toLowerCase().replace(/\s+/g, '-')}?utm_source=x`,
      why_fit: 'fits', contact: { name: '', title: '', email: '', linkedin: '' } }] };
  }
  return { items: [{ company: 'Kvarnholm Foods', website: '', industry: 'food', city: 'Umeå', country: 'Sweden', size: '400', kind: 'hypothesis',
    role_title: angle, signal: 'Opened a second plant', signal_date: today, source_url: 'https://example.com/news/kvarnholm', why_fit: 'growth',
    contact: { name: '', title: '', email: '', linkedin: '' } }] };
}

function respond(name, prefix, instr, body) {
  switch (name) {
    case 'profile_audit': return audit(instr);
    case 'job_posting': return ingest(instr);
    case 'analysis': return analyse(prefix, instr);
    case 'relevant_facts': return { fact_ids: factBank(prefix).map(f => f.id) };
    case 'resume': return resume(prefix, instr);
    case 'letter': return letter(prefix, instr);
    case 'document_review': return review(instr);
    case 'swap_test': return swap(instr);
    case 'coach_turn': return coach(instr);
    case 'refined_fact': return refine(instr);
    case 'rescore': return rescore(instr);
    case 'discovered_places': return discover(instr, body.tools?.[0]?.filters?.allowed_domains);
    default: return {};
  }
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(log));
    return;
  }
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const name = body.text?.format?.name ?? '';
    const prefix = body.input?.[0]?.content ?? '';
    const instr = body.input?.[1]?.content ?? '';
    const data = respond(name, prefix, instr, body);
    log.push({ at: Date.now(), name, model: body.model, revision: instr.includes('=== REVISION ==='), alsoPhrased: prefix.includes('also phrased as') });
    const delay = name === 'discovered_places' ? 600 : 150 + Math.random() * 250;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'completed',
        output: [
          ...(body.tools ? [{ type: 'web_search_call', action: { query: 'stub query', sources: [{ url: 'https://www.linkedin.com/jobs/view/1/' }] } }] : []),
          { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
        ],
        usage: { input_tokens: Math.round((prefix.length + instr.length) / 4), output_tokens: 400, input_tokens_details: { cached_tokens: 0 } },
      }));
    }, delay);
  });
}).listen(PORT, () => console.log(`openai stub on :${PORT}`));
