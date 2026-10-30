// Промпты как ДАННЫЕ (§10.1 в редакции 1.2). Дефолты здесь, переопределения — в
// таблице `config` под ключом PROMPTS, экран правки — /api/admin/config.
// Приём перенесён из twin (`prompts.js` + `admin.html`): шаблон правится текстом,
// живые данные подставляются по {{TOKEN}}, сборка контекста остаётся в коде.
// Убрал токен из шаблона — просто выпал этот блок данных, воркер не сломался.

export const PROMPT_META: Record<string, { label: string; where: string; tokens: Record<string, string> }> = {
  classify: {
    label: 'Classifier — which facts are relevant to this role',
    where: 'before Analyse (§10.2): a cheap call narrows the attention of the expensive one',
    tokens: { FACTS_INDEX: 'compact fact list: id · action · role', JD: 'job posting text or role description' },
  },
  analyse: {
    label: 'Expectation analysis',
    where: 'POST /api/opportunities/:id/analyse (§10.4)',
    tokens: {
      JD_BRANCH: 'branch instruction: from the posting text or reconstruction',
      OPPORTUNITY: 'company, role, signal, city, size',
      JD: 'job posting text, if any',
      FOCUS: 'classifier pointers: ids of facts relevant to this role',
    },
  },
  audit: {
    label: 'Profile audit — fact bank extraction',
    where: 'POST /api/profile/audit (§10.4a step 1)',
    tokens: { RESUME: 'resume_text', EXTRAS: 'extras_text' },
  },
  resume: {
    label: 'Tailored resume',
    where: 'POST /api/opportunities/:id/resume (§10.5)',
    tokens: {
      OPPORTUNITY: 'company, role, country', EXPECTATIONS: 'expectations from the analysis with weight',
      FORMAT: 'country format rules', PAGES: '1 or 2', LANG: 'document language',
    },
  },
  letter: {
    label: 'Letter',
    where: 'POST /api/opportunities/:id/letter (§10.5a)',
    tokens: {
      BRANCH: 'cover or cold', OPPORTUNITY: 'company, role, signal',
      EXPECTATIONS: 'must-have expectations', BRIDGE: 'bridge type for the main soft gap',
      OBJECTION: 'main objection and answer', CHANNEL: 'channel and introducer',
      TONE: 'neutral | direct | warm', WORDS: 'target word range', LANG: 'document language',
    },
  },
  ingest: {
    label: 'Parse a pasted job posting',
    where: 'POST /api/opportunities/import (§10.8)',
    tokens: { TEXT: 'page text or text pasted by the user' },
  },
  discover: {
    label: 'Place discovery (hypotheses)',
    where: 'search run (§10.3)',
    tokens: { PERIMETER: 'role perimeter and industries', GEO: 'geography', EXCLUDE: 'exclusions', KNOWN: 'companies already collected', BREADTH: 'narrow|medium|wide', COUNT: 'how many places are needed' },
  },
  discover_vacancies: {
    label: 'Published vacancy search',
    where: 'search run, “vacancies” pass: web search limited to job sites and ATSs',
    tokens: { PERIMETER: 'role perimeter and industries', GEO: 'geography', EXCLUDE: 'exclusions', KNOWN: 'companies already collected', COUNT: 'how many vacancies are needed', TODAY: "today's date" },
  },
  check: {
    label: 'Letter swap test',
    where: 'after letter generation (§10.10)',
    tokens: { LETTER: 'letter text with company and role swapped' },
  },
};

export const DEFAULT_PROMPTS: Record<string, string> = {
  classify: `You select the relevant facts from a candidate's achievement bank.
Fact bank:
{{FACTS_INDEX}}

The role and its description:
{{JD}}

Return the ids of the 15–25 facts most relevant to this role, in descending order of relevance.
Do not invent or rephrase anything — only ids from the list.`,

  analyse: `You are a career consultant for executives. You are analysing ONE opportunity.

{{JD_BRANCH}}

Opportunity:
{{OPPORTUNITY}}

{{JD}}

Consider these candidate facts first: {{FOCUS}}

Task: state 5–7 employer expectations, rank them by weight
(must — from the requirements section; important — from the responsibilities; nice — "nice to have"),
and link each one to a SPECIFIC fact from the bank or a quote from the profile.

Rules that must not be broken:
- Write everything in English.
- source_hint is a verbatim 3–8 word quote from the resume or the additional notes. Do not
  invent a quote: the worker checks that it occurs and demotes anything unverified to a gap.
- If there is no supporting fact, honestly set strength: "gap" and the gap class.
- There are only six kinds of hard blockers: work_auth, license, language,
  no_people_mgmt, scale, salary. Everything else is a soft gap with a bridge type.
- Phrase the main objection as the HIRING MANAGER'S RISK ("will leave in a year", "can't
  handle the scale"), not as a weakness of the resume.
- Do not compute score — the worker computes it.
- UVP: 2–3 sentences with a number and scale on why the candidate beats a typical
  applicant for THIS particular role.`,

  audit: `You break an executive's resume down into atomic facts.

RESUME:
{{RESUME}}

ADDITIONAL NOTES:
{{EXTRAS}}

Each fact is "action → how → measurable outcome". Rules:
- Write action, how, result, questions and recommendations in English.
- source_hint is mandatory: a verbatim 3–8 word quote from the text above, in its
  original language. A fact without a verifiable quote is discarded, so do not make things up.
- Put the number in metric_value/metric_unit, separate from the wording.
- scale_tags only from: team, managers, budget, pnl, geo, users.
- Do not infer anything: if the team size is not stated, do not write it.
- In questions, list questions for the user about facts where a number probably
  exists but is not stated ("how many people were on the team?"). These are QUESTIONS,
  not guesses.`,

  resume: `Assemble a resume for a specific opportunity. This is not new text but a REARRANGEMENT
of confirmed facts around this employer's expectations.

Opportunity: {{OPPORTUNITY}}
Expectations (weight): {{EXPECTATIONS}}
Format: {{FORMAT}}
Length: {{PAGES}} page(s)
Document language: {{LANG}}

The section order is fixed: role headline → 2–3 line summary → facts line →
6–10 key competencies → experience by company (reverse chronological) → education.

Rules:
- Single source: whatever is not in the fact bank or the profile text is not in the resume.
  Carry numbers and scale over from the facts UNCHANGED.
- The summary is not "seeking a position" but what the candidate delivers. Every summary
  claim must be backed by a bullet below; mark this in summary_support (the bullet index
  in running order).
- The first 3–4 bullets cover the must-have expectations.
- Bullet formula: action → how → measurable outcome. Most bullets carry a number;
  bullets without a number never come in a row.
- The words "leadership" and its equivalents are banned from competencies: leadership is
  shown by a result in a bullet.
- The facts line is filled ONLY from the structured profile fields.
- Roles older than 15 years go on one line (condensed: true).
- facts_used — ids of all facts used.`,

  letter: `{{BRANCH}}

Opportunity: {{OPPORTUNITY}}
Must-have expectations: {{EXPECTATIONS}}
Bridge for the main soft gap: {{BRIDGE}}
Main objection and answer: {{OBJECTION}}
Channel: {{CHANNEL}}
Tone: {{TONE}}
Length: {{WORDS}} words
Language: {{LANG}}

General bans:
- Empty phrases ("proven track record", "team player", "results-driven") are banned.
- Facts about the company come only from the signal and the job posting. You know nothing else about it.
- Claims about the candidate come only from the fact bank. Numbers must match the resume.
- Do not open with "I am writing", "I was excited to see", "My name is".
- Exactly one specific ask.
- The "why this company" paragraph must BREAK if the company name is swapped —
  the template check depends on it.`,

  ingest: `Extract the structure of a job posting from the text. Return strictly JSON matching the schema.

TEXT:
{{TEXT}}

Rules:
- An empty string instead of a guess: an empty field is better than an invented one.
- Fill contact_email ONLY if the address literally appears in the text above.
- is_job_posting: false if this is not a job posting (for example, an "About us" page).
- confidence: high only if the company and the role are named explicitly.`,

  discover: `You search for PLACES TO WORK for a candidate, not only published vacancies.

Role perimeter and industries: {{PERIMETER}}
Geography: {{GEO}}
Exclude: {{EXCLUDE}}
Already collected (do not suggest again): {{KNOWN}}
Breadth: {{BREADTH}}
Places needed: {{COUNT}}

Rules:
- Real companies only, with a verifiable source (source_url is mandatory).
- A hypothesis must rest on a SPECIFIC DATED signal no older than 6 months:
  a funding round, market entry, reorganisation, an executive departure, growth, public
  operational problems. Without a date and a link it is not a hypothesis — do not suggest it.
- Do NOT invent email addresses and do not include any: the worker will blank them anyway.
  The executive's name and title only if they appear on the source_url page.
- Write signal and why_fit in English.
- Published vacancies are found by a separate pass over job sites. Here the focus
  is hypotheses based on signals; return any vacancy you come across along the way too.`,

  discover_vacancies: `You search for PUBLISHED VACANCIES for a candidate. Today is {{TODAY}}.

Role perimeter and industries: {{PERIMETER}}
Geography: {{GEO}}
Exclude: {{EXCLUDE}}
Already collected (do not suggest again): {{KNOWN}}
Vacancies needed: {{COUNT}}

How to search:
- The search is limited to job sites: LinkedIn Jobs, company career pages on ATSs
  (Teamtailor, Greenhouse, Lever, Workday, Jobylon, ReachMee, Varbi…) and
  national boards (Platsbanken, Finn, Jobindex, Duunitori, jobs.ch, Reed…).
- Run several queries: the role title in English AND in the country's language
  (for example "COO" and "driftchef", "Head of Operations" and "operativ chef"),
  separately for the major cities and countries in the geography.
- If there are several geographies, start with the priority one but do not stop there.

Rules:
- kind = "vacancy". source_url is the address of the vacancy ITSELF (the posting page),
  not a search results page and not the company homepage.
- signal is one line in English: what the position is and why it fits; signal_date is the
  publication date (YYYY-MM-DD) if visible, otherwise an empty string.
- Open vacancies only: no older than 60 days and not marked "closed / no longer
  accepting applications".
- The level is managerial, as in the perimeter. Skip junior and specialist roles.
- Make nothing up: if no vacancies were found, return an empty list.
- Do not include email addresses. A contact only if it is named in the posting.`,

  check: `Below is a letter in which the company name, the role and the addressee's name have been REPLACED with fictional ones.

{{LETTER}}

Answer two questions:
1. broken — which sentences stopped making sense or became false after the swap?
   Quote the sentences in full.
2. generic — which phrases look written without knowledge of the company or
   generated from a template?`,
};

/** Подстановка {{TOKEN}}. Токен без значения превращается в пустую строку. */
export function fillPrompt(template: string, tokens: Record<string, string | number | null | undefined>): string {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    tokens[k] == null ? '' : String(tokens[k]));
}

export function getPrompt(overrides: Record<string, string> | null, key: string): string {
  const o = overrides?.[key];
  return typeof o === 'string' && o.trim() ? o : (DEFAULT_PROMPTS[key] ?? '');
}
