import type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker, RunEvent, OpportunityLabel,
  MatchPotential, DocumentReview, ResumeDoc, CoachMessage, CoachProposal, CoachTopic,
} from '@huntback/core';

export type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker, RunEvent, OpportunityLabel,
  MatchPotential, DocumentReview, ResumeDoc, CoachMessage, CoachProposal, CoachTopic,
};

/** Прогресс генерации документа: черновик → ревью → переписывание. */
export interface DocEvent {
  stage: 'draft' | 'review' | 'revise' | 'final' | 'done';
  round?: number;
  issues?: number;
  message?: string;
  error?: string;
  result?: unknown;
}

export interface MasterResume { doc: ResumeDoc; checks: CheckResult[]; review: DocumentReview | null; created_at: string }

export interface CoachView {
  messages: CoachMessage[];
  proposals: CoachProposal[];
  agenda: CoachTopic[];
  progress: { open: number; percent: number };
  /** После применения предложения — свежие профиль и факты. */
  profile?: Profile;
  facts?: Fact[];
  new_proposals?: string[];
}

export interface FixResult { analysis: Analysis; coverage: Coverage; potential: MatchPotential; note?: string }

export interface BatchImportResult {
  results: ({ index: number; ok: true; id: string; merged: boolean; company: string; role_title: string }
    | { index: number; ok: false; error: string })[];
}

export interface OpenQuestion {
  opportunity_id: string; company: string; role_title: string; index: number;
  expectation: string; weight: 'must' | 'important' | 'nice'; question: string; drafted: boolean;
}

export interface GeneratedDoc { id: string; doc: unknown; checks: CheckResult[]; review?: DocumentReview | null }

export interface Me {
  user: { email: string; name: string };
  profile_filled: boolean;
  spreadsheet_url: string | null;
  reauth_required: boolean;
}

export interface DocumentRecord {
  id: string;
  kind: 'resume' | 'letter';
  version: number;
  subject: string | null;
  body: string;
  edited_by_user: boolean;
  format_variant: string | null;
  facts_used: string[];
  checks: CheckResult[];
  created_at: string;
  review?: DocumentReview | null;
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  analysis: Analysis | null;
  documents: DocumentRecord[];
  coverage: Coverage | null;
  potential?: MatchPotential | null;
}

export interface UsageSummary extends BudgetStatus {
  byOperation: Record<string, { count: number; cost: number; failed: number }>;
  failed: number;
  recentErrors?: { operation: string; model: string; error: string; cost_usd: number; created_at: string }[];
}

export interface ParsedJob {
  company: string; role_title: string; city: string; country: string;
  industry: string; size: string; language: string; seniority: string;
  requirements: string[]; responsibilities: string[];
  contact_email: string; salary: string; posted_date: string;
  confidence: 'high' | 'medium' | 'low';
  is_job_posting: boolean;
}

export interface ImportResult {
  parsed: ParsedJob;
  jd_text: string;
  duplicate_of: string | null;
  source_url: string | null;
}

export interface RunState {
  id: string; state: 'running' | 'done' | 'failed';
  stage: string | null; found: number; added: number; error: string | null;
}

/** Режим поиска: вакансии и гипотезы либо только вакансии. */
export type SearchMode = 'all' | 'vacancies';

/** Что стирает сброс: всё, только места, только профиль или только журнал расходов. */
export type ResetScope = 'all' | 'search' | 'profile' | 'budget';

export interface Api {
  me(): Promise<Me>;
  logout(): Promise<void>;
  resetData(scope: ResetScope): Promise<void>;
  getProfile(): Promise<{ profile: Profile; audit: AuditReport | null; facts: Fact[]; master_resume?: MasterResume | null }>;
  saveProfile(patch: Partial<Profile>): Promise<{ profile: Profile; audit: AuditReport }>;
  runAudit(): Promise<{ audit: AuditReport; facts: Fact[] }>;
  patchFact(id: string, patch: Partial<Fact>): Promise<void>;
  deleteFact(id: string): Promise<void>;
  /** Ответ на наводящий вопрос: модель переписывает факт с этим числом. */
  answerFact(id: string, answer: string): Promise<{ fact: Fact }>;
  coach(): Promise<CoachView>;
  coachMessage(text: string, topicId?: string): Promise<CoachView>;
  coachSkip(topicId: string): Promise<CoachView>;
  coachProposal(id: string, action: 'apply' | 'dismiss'): Promise<CoachView>;
  coachReset(): Promise<CoachView>;
  buildMasterResume(onEvent?: (e: DocEvent) => void): Promise<MasterResume>;
  importBatch(text: string): Promise<BatchImportResult>;
  /** Открытые вопросы всех разборов — ответить подряд, не открывая места. */
  questions(): Promise<{ questions: OpenQuestion[] }>;
  fixExpectation(id: string, body: { index?: number; action: 'apply' | 'answer' | 'dismiss' | 'apply_all'; answer?: string }): Promise<FixResult>;
  listOpportunities(): Promise<Opportunity[]>;
  getOpportunity(id: string): Promise<OpportunityDetail>;
  patchOpportunity(id: string, patch: Record<string, unknown>): Promise<{ analysis?: Analysis }>;
  archiveOpportunity(id: string): Promise<void>;
  /** Скачать текст вакансии по ссылке источника и сохранить как референс. */
  fetchJobText(id: string): Promise<{ jd_text: string }>;
  importJob(input: { url?: string; text?: string }): Promise<ImportResult>;
  confirmImport(r: ImportResult & { parsed: ParsedJob }): Promise<{ id: string; merged?: boolean }>;
  analyse(id: string): Promise<{ analysis: Analysis; coverage: Coverage; potential?: MatchPotential }>;
  makeResume(id: string, onEvent?: (e: DocEvent) => void): Promise<GeneratedDoc>;
  makeLetter(id: string, tone?: string, onEvent?: (e: DocEvent) => void): Promise<GeneratedDoc>;
  saveDocument(id: string, patch: { body?: string; subject?: string }): Promise<{ checks: CheckResult[] }>;
  /**
   * Поиск по кнопке. Очередей нет: прогон идёт в одном запросе и присылает
   * события по ходу, поэтому вместо «запустить и опрашивать» — один вызов,
   * который зовёт onEvent на каждом шаге и завершается вместе с прогоном.
   */
  runSearch(mode: SearchMode, onEvent: (e: RunEvent) => void): Promise<void>;
  usage(): Promise<UsageSummary>;
}
