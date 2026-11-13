// Пользовательский сценарий в браузере против локального воркера и заглушки:
// пустой аккаунт → документы на все вакансии. Считает клики и время по этапам.
import { chromium } from 'playwright';
import { RESUME, EXTRAS, POSTINGS } from './persona.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const OUT = process.argv[2] ?? '.';
const W = Number(process.env.WIDTH ?? 1280);
const H0 = { Cookie: 'sid=sid-test; csrf=csrf-test', 'X-Huntback-CSRF': 'csrf-test', 'Content-Type': 'application/json' };
await fetch(BASE + '/api/account/reset', { method: 'POST', headers: H0, body: JSON.stringify({ scope: 'all' }) });
await fetch(BASE + '/api/coach/reset', { method: 'POST', headers: H0 });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
await ctx.addCookies([
  { name: 'sid', value: 'sid-test', domain: '127.0.0.1', path: '/' },
  { name: 'csrf', value: 'csrf-test', domain: '127.0.0.1', path: '/' },
]);
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const p = await ctx.newPage();
const issues = [];
p.on('pageerror', e => issues.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
p.on('dialog', d => d.accept());

let clicks = 0, typed = 0, shot = 0;
const stages = [];
let stageStart = Date.now(), stageClicks = 0;
const stage = name => { stages.push({ name, sec: Math.round((Date.now() - stageStart) / 100) / 10, clicks: clicks - stageClicks }); stageStart = Date.now(); stageClicks = clicks; };
const click = async (loc) => { await loc.click(); clicks++; };
const fill = async (loc, text) => { await loc.fill(text); typed += text.length; clicks++; };
const snap = async name => p.screenshot({ path: `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true });
/** Ждать, пока статус-бар не перестанет быть «занят». */
const idle = async (ms = 120000) => {
  await p.waitForTimeout(300);
  await p.waitForFunction(() => !document.querySelector('.statusbar--busy'), null, { timeout: ms });
};
const status = async () => (await p.locator('.statusbar').innerText().catch(() => '')).replace(/\s+/g, ' ');

await p.goto(BASE + '/');
await p.waitForSelector('text=Let’s start with your resume');
stage('open');

// 1. Резюме
await fill(p.getByLabel('Resume', { exact: true }), RESUME);
await fill(p.getByLabel(/Additional notes/), EXTRAS);
await click(p.getByRole('button', { name: 'Next' }));
await idle();
// 2. Периметр
await fill(p.getByLabel('Roles you are interested in'), 'Head of Operations; VP Supply Chain');
await fill(p.getByLabel(/Geography/), 'Sweden, Germany');
await snap('onb-perimeter');
await click(p.getByRole('button', { name: 'Analyse resume' }));
await idle();
await p.waitForSelector('.review');
await snap('onb-fact-review');
stage('onboarding: resume + perimeter + audit');

// 3. Разбор фактов: по одному. На вопрос — ответ с числом, формулировку — принять, остальное — подтвердить.
const FACT_ANSWERS = ['Cut carrier costs by 18% in the first year', 'Sales complaints about delivery dates fell by 30%'];
let answered = 0;
for (let guard = 0; guard < 25; guard++) {
  if (!(await p.locator('.review').count())) break;
  const progress = await p.locator('.review-progress').innerText();
  if (/· 0 to go/.test(progress)) break;
  if (await p.getByRole('button', { name: 'Use this wording' }).count()) {
    await click(p.getByRole('button', { name: 'Use this wording' }));
  } else if (await p.getByLabel('Your answer').count()) {
    await fill(p.getByLabel('Your answer'), FACT_ANSWERS[answered++ % FACT_ANSWERS.length]);
    await click(p.getByRole('button', { name: 'Add to the fact' }));
  } else {
    await click(p.getByRole('button', { name: /Confirm as is|Keep as is/ }));
  }
  await idle();
}
await snap('onb-facts-done');
stage('fact review');
if (await p.getByRole('button', { name: 'Next' }).count()) await click(p.getByRole('button', { name: 'Next' }));
await p.waitForSelector('text=What removes doubts');
const prefilledRegions = await p.getByLabel('Region').evaluateAll(els => els.map(e => e.value));
for (const [lang, cefr] of [['English', 'C1'], ['Swedish', 'B2']]) {
  await click(p.getByRole('button', { name: 'Add language' }));
  await fill(p.getByLabel('Language', { exact: true }).last(), lang);
  await p.getByLabel('CEFR level').last().selectOption(cefr); clicks++;
}
await fill(p.getByLabel('People, direct and indirect'), '25');
await fill(p.getByLabel('Of them, managers'), '4');
await snap('onb-doubts');
await click(p.getByRole('button', { name: 'Go to search' }));
await p.waitForSelector('h1:has-text("Places")');
stage('onboarding: finish');

// 4. Коуч: три ответа
await click(p.getByRole('button', { name: 'Coach', exact: true }));
await click(p.getByRole('button', { name: 'Start' }));
await idle();
const answers = ['We cut picking errors by 35% in one year at Baltic Logistics', '25 people, 4 of them managers, budget EUR 4.2M', 'English C1, Swedish B2, Russian C2'];
for (const a of answers) {
  await fill(p.getByLabel('Your answer'), a);
  await click(p.getByRole('button', { name: 'Send' }));
  await idle();
  const apply = p.getByRole('button', { name: 'Apply' });
  for (let i = await apply.count(); i > 0; i--) { await click(apply.first()); await idle(); }
}
await snap('coach');
stage('coach: 3 answers');

// 5. LinkedIn-ссылки и пакетная вставка
await click(p.getByRole('button', { name: 'Places', exact: true }));
await click(p.getByRole('button', { name: 'LinkedIn searches' }));
const links = await p.locator('.li-links a').count();
await snap('linkedin-links');
await click(p.getByRole('button', { name: 'Paste postings' }));
await click(p.getByRole('button', { name: 'Paste several at once' }));
await fill(p.getByLabel('Several job postings'), POSTINGS.join('\n---\n'));
await click(p.getByRole('button', { name: /Recognise 3 postings/ }));
await idle();
await snap('batch-imported');
const imported = await status();
await click(p.getByRole('button', { name: 'Close', exact: true }));
stage('find + import 3 postings');

// 6. Подготовить документы на всё
await click(p.getByRole('button', { name: /Prepare documents/ }));
const progressSeen = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  const s = await status();
  if (s) progressSeen.add(s.slice(0, 90));
  if (!(await p.locator('.statusbar--busy').count())) break;
  await p.waitForTimeout(400);
}
await snap('prepared');
const prepared = await status();
stage('prepare documents for all');

// 7. Вопросы всех мест одним списком → ответить на два → пересобрать документы
const qTitle = await p.locator('h3', { hasText: 'could raise your match' }).innerText().catch(() => '(no questions panel)');
let rebuilt = '(not rebuilt)';
if (!qTitle.startsWith('(')) {
  await click(p.getByRole('button', { name: 'Answer them' }));
  const qAnswers = ['Yes — I presented the network plan to the executive board quarterly, budget EUR 4.2M approved', 'Yes, 3 countries, 6 sites'];
  for (const a of qAnswers) {
    const input = p.locator('input[aria-label^="Answer:"]').first();
    if (!(await input.count())) break;
    await fill(input, a);
    const before = await p.locator('input[aria-label^="Answer:"]').count();
    await click(p.locator('.fix').first().getByRole('button', { name: 'Answer', exact: true }));
    await idle();
    await p.waitForFunction(n => document.querySelectorAll('input[aria-label^="Answer:"]').length < n, before, { timeout: 10000 }).catch(() => {});
  }
  await snap('questions');
  const rb = p.getByRole('button', { name: 'Rebuild their documents' });
  if (await rb.count()) {
    await click(rb);
    await idle(600000);
    rebuilt = await status();
  }
}
stage('answer questions + rebuild');

// 8. Открыть место, проверить отчёт ревью, скопировать
await click(p.getByRole('button', { name: /Fjällbo/ }).first());
await p.waitForSelector('.review-report');
await click(p.locator('.review-report-head').first());
await snap('place-docs');
await click(p.getByRole('button', { name: 'Copy text' }).first());
const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
stage('open + copy one');

// 8. Поднять совпадение на месте с вопросом
const potential = await p.locator('.potential').innerText().catch(() => '(no potential banner — all fixes applied)');

console.log(JSON.stringify({
  width: W, clicks, typed, prefilledRegions, qTitle, rebuilt, links, imported, prepared, potential: potential.replace(/\s+/g, ' '),
  copiedChars: clip.length, stages, progressSamples: [...progressSeen].slice(0, 12), issues,
}, null, 2));
await b.close();
