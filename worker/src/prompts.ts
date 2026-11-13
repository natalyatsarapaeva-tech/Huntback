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
    tokens: { PERIMETER: 'role perimeter and industries', TITLES: 'title variants in English and local languages', GEO: 'geography', EXCLUDE: 'exclusions', KNOWN: 'companies already collected', BREADTH: 'narrow|medium|wide', COUNT: 'how many places are needed' },
  },
  discover_vacancies: {
    label: 'Published vacancy search',
    where: 'search run, “vacancies” pass: web search limited to job sites and ATSs',
    tokens: { PERIMETER: 'role perimeter and industries', TITLES: 'title variants in English and local languages', GEO: 'geography', EXCLUDE: 'exclusions', KNOWN: 'companies already collected', COUNT: 'how many vacancies are needed', TODAY: "today's date" },
  },
  discover_linkedin: {
    label: 'LinkedIn vacancy search',
    where: 'search run, “linkedin” pass: web search limited to linkedin.com',
    tokens: { PERIMETER: 'role perimeter and industries', TITLES: 'title variants in English and local languages', GEO: 'geography', EXCLUDE: 'exclusions', KNOWN: 'companies already collected', COUNT: 'how many vacancies are needed', TODAY: "today's date" },
  },
  review: {
    label: 'Document reviewer',
    where: 'after every resume and letter draft: two review rounds before the user sees it',
    tokens: { KIND: 'resume or cover letter', TARGET: 'company and role', EXPECTATIONS: 'employer expectations', EXTRA: 'posting excerpt / signal', DOCUMENT: 'the draft', CODE_ISSUES: 'findings of the automated checks' },
  },
  coach: {
    label: 'Resume coach',
    where: 'POST /api/coach/message — one turn of the coaching chat',
    tokens: { PERIMETER: 'target roles', AGENDA: 'open agenda topics', TOPIC: 'current topic', HISTORY: 'recent messages', MESSAGE: 'the latest user message' },
  },
  refine: {
    label: 'Refine a fact from an answer',
    where: 'POST /api/profile/facts/:id/answer — fact review',
    tokens: { FACT: 'current fact', QUOTE: 'resume quote', QUESTION: 'question asked', ANSWER: 'user answer' },
  },
  rescore: {
    label: 'Re-score one expectation from an answer',
    where: 'POST /api/opportunities/:id/fix — answer to a match question',
    tokens: { EXPECTATION: 'expectation', WEIGHT: 'weight', QUESTION: 'question', ANSWER: 'answer', OPPORTUNITY: 'company and role' },
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
- For EVERY expectation that is not "strong", fill fix — this is how the candidate raises the match:
  · reason "wording": the experience IS in the fact bank or resume, but in other words. Give
    fact_id and rewrite: that fact reworded in the employer's vocabulary from the posting.
    Same facts, same numbers — never add a number or scope that is not in the fact. strength_after
    is what the match becomes with that wording.
  · reason "missing_fact": the candidate probably has this (their roles suggest it) but nothing
    written says so. question: ONE concrete question that would surface it, with a number
    ("How many people were in the largest team you hired for?"). strength_after if the answer is yes.
  · reason "real_gap": nothing in the profile suggests this experience. Leave rewrite and question empty.
  For "strong" expectations set reason null and empty strings.
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
  not guesses.
- For EACH fact fill review — what the candidate should do with it:
  · kind "question" when a number, scale or baseline probably exists but is not stated.
    question is ONE short, concrete question that gets it ("How many people did the team grow
    from and to?", "What was the annual saving in EUR?"). Never "tell me more".
  · kind "rewrite" when the fact is there but reads weakly (duty instead of result, vague verb,
    result buried). rewrite is the same fact as action / how / result. Use ONLY words and numbers
    from the resume: never add a number.
  · kind "ok" when the fact is already action → how → measurable result.
  why: one line on what the change gives at screening.`,

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
The same role under other titles: {{TITLES}}
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
Search with these titles (employers name the same role differently):
{{TITLES}}
Geography: {{GEO}}
Exclude: {{EXCLUDE}}
Already collected (do not suggest again): {{KNOWN}}
Vacancies needed: {{COUNT}}

How to search:
- The search is limited to company career pages on ATSs (Teamtailor, Greenhouse,
  Lever, Workday, Jobylon, ReachMee, Varbi…) and national boards (Platsbanken,
  Finn, Jobindex, Duunitori, jobs.ch, Reed…). LinkedIn is searched by a separate pass.
- Run several queries: the titles above in English AND in the country's language,
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

  discover_linkedin: `You search LinkedIn Jobs for PUBLISHED VACANCIES for a candidate. Today is {{TODAY}}.

Role perimeter and industries: {{PERIMETER}}
Search with these titles (employers name the same role differently):
{{TITLES}}
Geography: {{GEO}}
Exclude: {{EXCLUDE}}
Already collected (do not suggest again): {{KNOWN}}
Vacancies needed: {{COUNT}}

How to search:
- The search is limited to linkedin.com. Job postings live at addresses like
  linkedin.com/jobs/view/<id> (also on country subdomains such as se.linkedin.com).
- One query per title and country, for example: Head of Operations Stockholm jobs,
  "driftchef" Sverige. Use the local-language titles for local-language postings.
- Prefer postings from the last 30 days; skip anything marked "No longer accepting applications".

Rules:
- kind = "vacancy". source_url is the /jobs/view/<id> address of the posting itself —
  never a search page, a company page, a post or a profile. A result without a job id is useless.
- company is the hiring company as shown on the posting, not the recruiting agency when
  the agency names its client; if the client is hidden, use the agency name.
- signal is one line in English: what the position is and why it fits; signal_date is the
  publication date (YYYY-MM-DD) if visible, otherwise an empty string.
- The level is managerial, as in the perimeter. Skip junior and specialist roles.
- Make nothing up: if no vacancies were found, return an empty list.
- Do not include email addresses. A contact only if it is named in the posting.`,

  review: `You are a demanding editor reviewing a {{KIND}} written for an executive candidate,
before it goes to the candidate. You did not write it; your job is to find what is wrong.

Target: {{TARGET}}
Employer expectations: {{EXPECTATIONS}}
{{EXTRA}}

=== DOCUMENT ===
{{DOCUMENT}}
=== END ===

Automated checks already found (confirm and give the fix for each):
{{CODE_ISSUES}}

Check, in this order:
1. factual — every number, scope, title, company and date must match the fact bank and profile
   above. A rounded-up number, "led" where the fact says "took part", a team or budget bigger
   than stated, an outcome attributed to the candidate that the fact does not support.
2. duplication — the same achievement or number told twice (in two bullets, or summary + bullet
   in identical words, or twice in the letter).
3. far_fetched — claims that stretch: a link between the candidate's fact and the employer's need
   that is not there, enthusiasm about the company with no basis in the signal or posting,
   transferable-skills claims without a concrete fact.
4. cliche — empty phrases ("proven track record", "results-driven", "passionate", "team player").
5. ai_ism — words and patterns that read as machine-written: delve, spearheaded, leverage,
   seamless, robust, pivotal, testament, "not only… but also", a triad of adjectives, a dash in
   every sentence, an inspirational closing line.

Rules:
- quote is a VERBATIM fragment of the document (it is checked; invented quotes are discarded).
- fix is the concrete replacement text or a precise instruction, not "make it better".
- severity high: factual errors, duplication, far-fetched claims; low: style.
- verdict "pass" only when there are no high-severity issues. Do not invent problems to look useful.
- Write in English.`,

  coach: `You are a resume coach for an executive candidate. You lead the conversation:
ONE question at a time, short, concrete, friendly but not chatty. The goal is facts with numbers,
in the candidate's own words, that make the resume stronger for these roles: {{PERIMETER}}.

Agenda — what is missing, most valuable first (id · title · goal):
{{AGENDA}}

Current topic: {{TOPIC}}

Conversation so far (latest last):
{{HISTORY}}

The candidate just wrote: {{MESSAGE}}

What to do:
- If the candidate answered the current topic, turn the answer into proposals:
  new_facts (action → how → result, metric_value/metric_unit when a number was given) or
  fact_updates (for an existing fact id from the bank), and profile_updates for structured fields.
  user_quote is the candidate's EXACT words the fact rests on (it is checked).
  NEVER put a number the candidate did not say. If they gave a range or "about", keep it honest.
- If the answer is vague, ask ONE follow-up that gets the number or the baseline. Do not lecture.
- topic_done = true when the topic is resolved or the candidate does not know / does not want to answer.
- reply: one short acknowledgement of what you took from the answer (if anything), then the next
  question — on the same topic if not done, otherwise on the next agenda topic. topic_id is the id
  of the topic your question is about.
- If the agenda only has master_resume left, say the profile is ready and suggest building the
  master resume. Ask nothing else.
- profile_updates: null / empty for anything the candidate did not state in this message.
- Write in English, even if the candidate writes in another language (keep user_quote verbatim).`,

  refine: `A candidate answered a question about one fact from their resume. Rewrite the fact
using the answer.

Fact now: {{FACT}}
Quote from the resume: {{QUOTE}}
Question asked: {{QUESTION}}
Candidate's answer: {{ANSWER}}

Rules:
- action → how → measurable result, in English, resume style (no "I", past tense for past roles).
- Numbers ONLY from the fact or the answer, exactly as given. Never round up or add a number.
- metric_value / metric_unit: the main number of the result, if any.
- If the answer adds nothing, return the fact unchanged.`,

  rescore: `A hiring manager expects: {{EXPECTATION}} (weight: {{WEIGHT}}).
The candidate was asked: {{QUESTION}}
Candidate's answer: {{ANSWER}}
Role: {{OPPORTUNITY}}

Decide honestly whether the answer meets the expectation.
- relevant: false if the answer does not describe matching experience.
- strength: strong (clearly meets it, ideally with a number), partial (related or smaller scale), gap.
- evidence: one line, how the experience meets the expectation, using the employer's words.
- fact: the answer as a resume fact (action → how → result). Numbers only from the answer.
  user_quote: the candidate's exact words it rests on.`,

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
