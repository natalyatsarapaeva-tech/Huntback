import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  titleVariants, parseGeo, linkedinJobId, canonicalJobUrl, looksLikeJobPostingUrl, jobUrlKey,
  linkedinSearchLinks, cleanJobText, splitJobTexts, extractLinkedInJob, describeTitleVariants,
} from '../src/index.ts';

test('варианты названий: английские синонимы и местные по стране', () => {
  const v = titleVariants('VP Operations', 'Sweden, Germany');
  assert.equal(v.group, 'operations');
  assert.equal(v.en[0], 'VP Operations');
  assert.ok(v.en.includes('Head of Operations'));
  assert.ok(v.en.includes('COO'));
  assert.deepEqual(v.local.map(l => l.lang), ['sv', 'de']);
  assert.ok(v.local[0].titles.includes('driftchef'));
  assert.match(describeTitleVariants(v), /Sweden \(sv\): "driftchef"/);
});

test('варианты: «coordinator» не узнаётся как COO, незнакомое направление остаётся как есть', () => {
  assert.notEqual(titleVariants('Project Coordinator', 'Sweden').group, 'operations');
  const v = titleVariants('Head of Beekeeping', 'Sweden');
  assert.equal(v.group, null);
  assert.deepEqual(v.en, ['Head of Beekeeping']);
  assert.deepEqual(v.local, []);
});

test('география: страны на разных языках, без дублей, регион остаётся', () => {
  const g = parseGeo('Швеция, Sweden; Germany, EU');
  assert.deepEqual(g.map(x => x.name), ['Sweden', 'Germany', 'EU']);
  assert.equal(g[0].lang, 'sv');
});

test('LinkedIn: id вакансии из любой формы ссылки', () => {
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/view/4123456789/'), '4123456789');
  assert.equal(linkedinJobId('https://se.linkedin.com/jobs/view/head-of-operations-at-acme-4123456789?trk=x'), '4123456789');
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/search/?currentJobId=4123456789&keywords=coo'), '4123456789');
  assert.equal(linkedinJobId('https://www.linkedin.com/comm/jobs/view/4123456789'), '4123456789');
  assert.equal(linkedinJobId('https://www.linkedin.com/company/acme/'), null);
  assert.equal(linkedinJobId('https://example.com/jobs/view/4123456789'), null);
});

test('канонический адрес: LinkedIn без трекинга, utm срезаются', () => {
  assert.equal(canonicalJobUrl('https://de.linkedin.com/jobs/view/coo-4123456789?refId=abc&trackingId=x'),
    'https://www.linkedin.com/jobs/view/4123456789/');
  assert.equal(canonicalJobUrl('https://boards.greenhouse.io/acme/jobs/123?utm_source=li&gh_src=x#apply'),
    'https://boards.greenhouse.io/acme/jobs/123');
  assert.equal(jobUrlKey('https://se.linkedin.com/jobs/view/x-4123456789'), jobUrlKey('https://www.linkedin.com/jobs/view/4123456789/'));
});

test('страница одной вакансии: поиск, компания и главная — нет', () => {
  assert.ok(looksLikeJobPostingUrl('https://www.linkedin.com/jobs/view/4123456789/'));
  assert.ok(!looksLikeJobPostingUrl('https://www.linkedin.com/jobs/search/?keywords=coo'));
  assert.ok(!looksLikeJobPostingUrl('https://www.linkedin.com/company/acme'));
  assert.ok(!looksLikeJobPostingUrl('https://acme.com/'));
  assert.ok(looksLikeJobPostingUrl('https://jobs.lever.co/acme/7f1c2b'));
  assert.ok(!looksLikeJobPostingUrl('https://www.jobindex.dk/jobsoegning?q=driftschef'));
});

test('ссылки поиска LinkedIn: направление × страна, фильтр недели и уровня', () => {
  const links = linkedinSearchLinks('VP Operations; Head of Supply Chain', 'Sweden, Germany');
  assert.equal(links.length, 4);
  const u = new URL(links[0].url);
  assert.equal(u.hostname, 'www.linkedin.com');
  assert.equal(u.searchParams.get('location'), 'Sweden');
  assert.equal(u.searchParams.get('f_TPR'), 'r604800');
  assert.equal(u.searchParams.get('f_E'), '4,5,6');
  assert.match(u.searchParams.get('keywords')!, /"VP Operations" OR "COO"/);
  assert.match(u.searchParams.get('keywords')!, /driftchef/);
});

test('текст из LinkedIn: интерфейс вычищается, содержание остаётся', () => {
  const raw = 'Head of Operations\nAcme · Stockholm\n3 days ago · 48 applicants\nEasy Apply\nSave\nAbout the job\nYou will lead 40 people.\nShow more\nMeet the hiring team';
  assert.equal(cleanJobText(raw), 'Head of Operations\nAcme · Stockholm\nYou will lead 40 people.');
});

test('пакетная вставка: разделитель из дефисов, короткие куски отброшены', () => {
  const a = 'A'.repeat(250), b = 'B'.repeat(300);
  assert.deepEqual(splitJobTexts(`${a}\n---\n${b}\n-----\nthanks`), [a, b]);
});

test('гостевая страница LinkedIn: описание, роль и компания', () => {
  const html = '<html><head><meta property="og:title" content="Acme hiring Head of Operations in Stockholm, Sweden | LinkedIn"></head>'
    + '<h1 class="top-card">Head of Operations</h1>'
    + '<div class="show-more-less-html__markup relative">' + '<p>We are looking for a leader.</p><ul><li>Lead 40 people</li><li>Fluent Swedish</li></ul>'.repeat(4) + '</div><button>Show more</button>';
  const j = extractLinkedInJob(html)!;
  assert.equal(j.company, 'Acme');
  assert.equal(j.title, 'Head of Operations');
  assert.equal(j.location, 'Stockholm, Sweden');
  assert.match(j.description, /• Lead 40 people/);
  assert.equal(extractLinkedInJob('<html>sign in to view</html>'), null);
});
