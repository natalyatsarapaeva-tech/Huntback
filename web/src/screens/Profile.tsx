// Экран профиля (§13.1.2): резюме, периметр, структурированный блок «что
// снимает сомнения», панель аудита и банк фактов.
//
// Автосохранение с задержкой 700 мс — как в ТЗ: поле на 20 000 знаков не должно
// требовать кнопки «сохранить».

import { useEffect, useRef, useState } from 'react';
import type { Profile as P, Fact, AuditReport, LanguageLevel, WorkAuth, ResetScope } from '../api/types.ts';
import { CEFR_ORDER } from '@huntback/core';
import { Card, Field, Chip } from '../components/ui.tsx';
import { FactReview } from './FactReview.tsx';

export function FactList({ facts, onPatch, onDelete }: {
  facts: Fact[];
  onPatch: (id: string, patch: Partial<Fact>) => void;
  /** Без обработчика удаление не показывается (онбординг). */
  onDelete?: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div>
      {facts.map(f => (
        editing === f.id
          ? <FactEditor key={f.id} fact={f}
              onSave={patch => { onPatch(f.id, patch); setEditing(null); }}
              onCancel={() => setEditing(null)} />
          : (
            <div key={f.id} className="fact">
              <input className="checkbox" type="checkbox" checked={f.confirmed}
                aria-label={`Confirm fact: ${f.action}`}
                onChange={e => onPatch(f.id, { confirmed: e.target.checked })} />
              <div className="fact-body">
                <div className="fact-action">{f.action}</div>
                {f.how && <div className="fact-result">{f.how}</div>}
                {f.result && <div className="fact-result">{f.result}</div>}
                <div className="fact-src">“ {f.source_hint} ”</div>
                <div className="flex gap-8 mt-8">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(f.id)}>Edit</button>
                  {onDelete && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { if (confirm(`Delete the fact “${f.action}”?`)) onDelete(f.id); }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="stack gap-6" style={{ alignItems: 'flex-end' }}>
                {f.quantified
                  ? <Chip tone="good">{f.metric_value} {f.metric_unit}</Chip>
                  : <Chip tone="mid" title="A measurable result is the strongest signal at screening">no number</Chip>}
                {!!f.scale_tags.length && <span className="small muted">{f.scale_tags.join(' · ')}</span>}
              </div>
            </div>
          )
      ))}
    </div>
  );
}

/** Правка текста факта. Цитата-источник не правится: по ней факт сверяется с резюме. */
function FactEditor({ fact, onSave, onCancel }: {
  fact: Fact; onSave: (patch: Partial<Fact>) => void; onCancel: () => void;
}) {
  const [action, setAction] = useState(fact.action);
  const [how, setHow] = useState(fact.how ?? '');
  const [result, setResult] = useState(fact.result ?? '');
  return (
    <div className="fact">
      <div className="fact-body">
        <Field label="Action">
          <input className="input" value={action} onChange={e => setAction(e.target.value)} />
        </Field>
        <Field label="How">
          <input className="input" value={how} onChange={e => setHow(e.target.value)} />
        </Field>
        <Field label="Result" hint="Include the number — quantified facts carry the most weight">
          <input className="input" value={result} onChange={e => setResult(e.target.value)} />
        </Field>
        <div className="fact-src">“ {fact.source_hint} ”</div>
        <div className="flex gap-8 mt-8">
          <button className="btn btn-primary btn-sm" disabled={!action.trim()}
            onClick={() => onSave({ action: action.trim(), how: how.trim(), result: result.trim() })}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Что и где искать — те же поля, что на втором шаге онбординга. */
export type SearchPrefs = Pick<P, 'perimeter' | 'geo' | 'industries' | 'exclude' | 'breadth'>;

export function SearchPrefsFields({ value, onChange }: {
  value: SearchPrefs; onChange: (patch: Partial<SearchPrefs>) => void;
}) {
  return (
    <>
      <Field label="Roles you are interested in"
        hint="Separate with semicolons — each one becomes its own search direction. For example: VP Operations; Head of Supply Chain; Director of Logistics">
        <textarea className="textarea" style={{ minHeight: 88 }} value={value.perimeter}
          onChange={e => onChange({ perimeter: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Geography" hint="Countries separated by commas — work authorization is checked against them">
          <input className="input" value={value.geo} onChange={e => onChange({ geo: e.target.value })}
            placeholder="Sweden, Germany" />
        </Field>
        <Field label="Priority industries">
          <input className="input" value={value.industries} onChange={e => onChange({ industries: e.target.value })} />
        </Field>
      </div>
      <Field label="Exclude" hint="Companies, industries or formats that definitely don’t fit">
        <input className="input" value={value.exclude} onChange={e => onChange({ exclude: e.target.value })} />
      </Field>
      <Field label="Search breadth">
        <select className="select" value={value.breadth} onChange={e => onChange({ breadth: e.target.value as P['breadth'] })}>
          <option value="narrow">Narrow — mostly published vacancies</option>
          <option value="medium">Medium — vacancies and hypotheses equally</option>
          <option value="wide">Wide — more companies where the role isn’t open yet</option>
        </select>
      </Field>
    </>
  );
}

const RESETS: { scope: ResetScope; title: string; what: string; confirm: string; danger?: boolean }[] = [
  {
    scope: 'search', title: 'Clear search results',
    what: 'Deletes every place, its analysis, resume and letter drafts, and the search run history. Your profile stays.',
    confirm: 'Delete all places, analyses, drafts and search history? This cannot be undone.',
  },
  {
    scope: 'profile', title: 'Clear profile',
    what: 'Deletes your resume, notes, search preferences, the audit and the whole fact bank. Places stay; you’ll go through setup again.',
    confirm: 'Delete your resume, profile fields and fact bank? This cannot be undone.',
  },
  {
    scope: 'budget', title: 'Reset budget',
    what: 'Clears the spending log, so this month’s counter starts again from $0. It does not refund anything — real OpenAI charges stay as they are.',
    confirm: 'Reset the spending counter to $0? The history of calls and errors will be deleted.',
  },
  {
    scope: 'all', title: 'Clean up everything', danger: true,
    what: 'All of the above: places and history, profile and facts, and the spending log. Your account and sign-in stay.',
    confirm: 'Delete ALL your data — places, history, profile, facts and the spending log? This cannot be undone.',
  },
];

function ResetPanel({ busy, onReset }: { busy: boolean; onReset: (scope: ResetScope) => void }) {
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>Reset data</h3>
          <div className="sub">Start over in part or completely. Nothing here can be undone.</div>
        </div>
      </div>
      <div className="card-pad stack gap-12">
        {RESETS.map(r => (
          <div key={r.scope} className="flex items-center between wrap gap-12">
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{r.title}</div>
              <div className="small muted">{r.what}</div>
            </div>
            <button className={`btn btn-sm ${r.danger ? 'btn-danger' : 'btn-secondary'}`} disabled={busy}
              onClick={() => { if (confirm(r.confirm)) onReset(r.scope); }}>
              {r.title}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditPanel({ audit, busy, onRun }: { audit: AuditReport | null; busy: boolean; onRun: () => void }) {
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>Profile audit</h3>
          <div className="sub">What in your resume works at screening, and what is missing</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRun} disabled={busy}>
          {busy ? 'Calculating…' : 'Recalculate'}
        </button>
      </div>
      <div className="card-pad">
        {!audit && <p className="small muted">The audit hasn’t been run yet.</p>}
        {audit && (
          <>
            <div className="metrics">
              {audit.metrics.map(m => (
                <div key={m.id} className={`metric metric--${m.status}`}>
                  <div className="metric-label"><span className="metric-dot" aria-hidden />{m.label}</div>
                  <div className="metric-value">
                    {m.display ?? (m.status === 'ok' ? 'yes' : '—')}
                  </div>
                  <div className="metric-detail">{m.detail}</div>
                </div>
              ))}
            </div>
            {!!audit.tasks.length && (
              <>
                <div className="section-label mt-24">What to fix — highest impact first</div>
                <div className="tasks">
                  {audit.tasks.map(t => <div key={t.id} className="task"><span>{t.text}</span></div>)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function useAutosave<T>(value: T, save: (v: T) => void, ms = 700) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => save(value), ms);
    return () => clearTimeout(t);
  }, [value]);
}

export function ProfileScreen({
  profile, facts, audit, busy, onSave, onAudit, onPatchFact, onDeleteFact, onReset, onAnswerFact, startInReview, onOpenCoach,
}: {
  profile: P; facts: Fact[]; audit: AuditReport | null; busy: boolean;
  onSave: (patch: Partial<P>) => void;
  onAudit: () => void;
  onPatchFact: (id: string, patch: Partial<Fact>) => Promise<void> | void;
  onDeleteFact: (id: string) => void;
  onReset: (scope: ResetScope) => void;
  onAnswerFact: (id: string, answer: string) => Promise<boolean>;
  startInReview?: boolean;
  onOpenCoach: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [mode, setMode] = useState<'review' | 'list'>(startInReview ? 'review' : 'list');
  const pendingReview = facts.filter(f => !f.confirmed || f.review?.status === 'pending' && f.review.kind !== 'ok').length;
  const factsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (startInReview) factsRef.current?.scrollIntoView({ block: 'start' }); }, [startInReview]);
  useEffect(() => setDraft(profile), [profile.resume_text]);
  useAutosave(draft, d => onSave(d));

  const set = <K extends keyof P>(k: K, v: P[K]) => setDraft(d => ({ ...d, [k]: v }));
  const scale = draft.scale ?? {};

  return (
    <div className="stack gap-20">
      <div className="flex items-center between wrap gap-12">
        <div>
          <h1>Profile</h1>
          <p className="muted small mt-8">Changes save automatically</p>
        </div>
      </div>

      <Card className="card-pad">
        <Field label="Resume">
          <textarea className="textarea" style={{ minHeight: 220 }} value={draft.resume_text}
            onChange={e => set('resume_text', e.target.value)} />
        </Field>
        <Field label="Additional notes"
          hint="What you learned, whom you grew, why there were gaps. Often stronger than the resume itself.">
          <textarea className="textarea" value={draft.extras_text} onChange={e => set('extras_text', e.target.value)} />
        </Field>
      </Card>

      <Card>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h3>What you’re looking for</h3>
            <div className="sub">Roles, geography and breadth used by every search run</div>
          </div>
        </div>
        <div className="card-pad">
          <SearchPrefsFields value={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} />
        </div>
      </Card>

      <AuditPanel audit={audit} busy={busy} onRun={onAudit} />

      <div ref={factsRef} />
      <Card>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h3>Fact bank</h3>
            <div className="sub">
              {facts.filter(f => f.confirmed).length} of {facts.length} confirmed.
              Only confirmed facts go into documents.
              {pendingReview > 0 && <> {pendingReview} still have a question or a suggested wording.</>}
            </div>
          </div>
          {!!facts.length && (
            <div className="flex gap-6">
              <button className={`btn btn-sm ${mode === 'review' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setMode('review')}>One by one</button>
              <button className={`btn btn-sm ${mode === 'list' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setMode('list')}>All</button>
            </div>
          )}
        </div>
        <div className="card-pad">
          {!facts.length && <p className="small muted">Empty — run the audit and it will break the resume down into facts.</p>}
          {!!facts.length && mode === 'review' && (
            <FactReview facts={facts} busy={busy} onPatch={onPatchFact} onAnswer={onAnswerFact} onDelete={onDeleteFact}
              onFinished={() => setMode('list')} />
          )}
          {!!facts.length && mode === 'list' && <FactList facts={facts} onPatch={onPatchFact} onDelete={onDeleteFact} />}
          {!!facts.length && (
            <p className="small muted mt-16">
              Missing an achievement altogether? The <button className="link" onClick={onOpenCoach}>resume coach</button> asks
              about what your resume doesn’t say yet and turns your answers into facts.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h3>What removes doubts</h3>
            <div className="sub">These fields answer questions that are almost never asked out loud</div>
          </div>
        </div>
        <div className="card-pad">
          <div className="section-label">Management scale</div>
          <div className="row">
            <Field label="Max direct and indirect reports">
              <input className="input" inputMode="numeric" value={scale.team_max ?? ''}
                onChange={e => set('scale', { ...scale, team_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Of them, managers">
              <input className="input" inputMode="numeric" value={scale.managers_max ?? ''}
                onChange={e => set('scale', { ...scale, managers_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Budget, EUR">
              <input className="input" inputMode="numeric" value={scale.budget_max ?? ''}
                onChange={e => set('scale', { ...scale, budget_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Geographic scope">
              <input className="input" value={scale.geo_scope ?? ''}
                onChange={e => set('scale', { ...scale, geo_scope: e.target.value })} placeholder="3 countries" />
            </Field>
          </div>

          <div className="section-label mt-16">Languages</div>
          <LanguageEditor value={draft.languages} onChange={v => set('languages', v)} />

          <div className="section-label mt-24">Work authorization</div>
          <WorkAuthEditor value={draft.work_auth} onChange={v => set('work_auth', v)} />

          <div className="section-label mt-24">Other</div>
          <div className="row">
            <Field label="Open to relocation">
              <select className="select" value={draft.relocation?.ready ?? 'no'}
                onChange={e => set('relocation', { ready: e.target.value as 'yes' | 'no' | 'conditional', package_needed: draft.relocation?.package_needed ?? false })}>
                <option value="yes">Yes</option>
                <option value="conditional">Under conditions</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="LinkedIn">
              <input className="input" value={draft.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} />
            </Field>
            <Field label="Photo on the resume" hint="Expected in DACH, not in the UK or the Nordics">
              <select className="select" value={draft.photo_policy}
                onChange={e => set('photo_policy', e.target.value as P['photo_policy'])}>
                <option value="auto">By the place’s country</option>
                <option value="never">Never</option>
                <option value="always">Always</option>
              </select>
            </Field>
          </div>
        </div>
      </Card>

      <ResetPanel busy={busy} onReset={onReset} />
    </div>
  );
}

export function LanguageEditor({ value, onChange }: { value: LanguageLevel[]; onChange: (v: LanguageLevel[]) => void }) {
  return (
    <div className="stack gap-8">
      {value.map((l, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
          <input className="input" value={l.lang} aria-label="Language"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, lang: e.target.value } : x)))} />
          <select className="select" value={l.cefr} aria-label="CEFR level" style={{ flex: '0 1 120px' }}
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, cefr: e.target.value as LanguageLevel['cefr'] } : x)))}>
            {CEFR_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" style={{ flex: '0 0 auto' }}
            onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove language">Remove</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...value, { lang: '', cefr: 'B2' }])}>Add language</button>
      <p className="field-hint">A CEFR level, not “fluent”: job requirements are compared against it.</p>
    </div>
  );
}

export function WorkAuthEditor({ value, onChange }: { value: WorkAuth[]; onChange: (v: WorkAuth[]) => void }) {
  return (
    <div className="stack gap-8">
      {value.map((w, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
          <input className="input" value={w.region} aria-label="Region" placeholder="Sweden or EU"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, region: e.target.value } : x)))} />
          <select className="select" value={w.status} aria-label="Status"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, status: e.target.value as WorkAuth['status'] } : x)))}>
            <option value="citizen">Citizenship</option>
            <option value="permit">Have a permit</option>
            <option value="needs_sponsorship">Need sponsorship</option>
          </select>
          <button className="btn btn-ghost btn-sm" style={{ flex: '0 0 auto' }}
            onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove region">Remove</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...value, { region: '', status: 'permit' }])}>Add region</button>
      <p className="field-hint">The main doubt in an international application. One line in the resume removes it.</p>
    </div>
  );
}
