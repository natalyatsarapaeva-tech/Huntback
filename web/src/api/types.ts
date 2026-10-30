import type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker, RunEvent, OpportunityLabel,
} from '@huntback/core';

export type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker, RunEvent, OpportunityLabel,
};

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
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  analysis: Analysis | null;
  documents: DocumentRecord[];
  coverage: Coverage | null;
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

export interface Api {
  me(): Promise<Me>;
  logout(): Promise<void>;
  getProfile(): Promise<{ profile: Profile; audit: AuditReport | null; facts: Fact[] }>;
  saveProfile(patch: Partial<Profile>): Promise<{ profile: Profile; audit: AuditReport }>;
  runAudit(): Promise<{ audit: AuditReport; facts: Fact[] }>;
  patchFact(id: string, patch: Partial<Fact>): Promise<void>;
  deleteFact(id: string): Promise<void>;
  listOpportunities(): Promise<Opportunity[]>;
  getOpportunity(id: string): Promise<OpportunityDetail>;
  patchOpportunity(id: string, patch: Record<string, unknown>): Promise<{ analysis?: Analysis }>;
  archiveOpportunity(id: string): Promise<void>;
  /** Скачать текст вакансии по ссылке источника и сохранить как референс. */
  fetchJobText(id: string): Promise<{ jd_text: string }>;
  importJob(input: { url?: string; text?: string }): Promise<ImportResult>;
  confirmImport(r: ImportResult & { parsed: ParsedJob }): Promise<{ id: string; merged?: boolean }>;
  analyse(id: string): Promise<{ analysis: Analysis; coverage: Coverage }>;
  makeResume(id: string): Promise<{ doc: unknown; checks: CheckResult[] }>;
  makeLetter(id: string, tone?: string): Promise<{ doc: { subject: string; body: string }; checks: CheckResult[] }>;
  saveDocument(id: string, patch: { body?: string; subject?: string }): Promise<{ checks: CheckResult[] }>;
  /**
   * Поиск по кнопке. Очередей нет: прогон идёт в одном запросе и присылает
   * события по ходу, поэтому вместо «запустить и опрашивать» — один вызов,
   * который зовёт onEvent на каждом шаге и завершается вместе с прогоном.
   */
  runSearch(mode: SearchMode, onEvent: (e: RunEvent) => void): Promise<void>;
  usage(): Promise<UsageSummary>;
}
