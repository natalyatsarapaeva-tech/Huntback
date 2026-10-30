// Места: список слева, карточка справа (§13.1.3–4). На узких экранах — две
// страницы с переходом «назад к списку», а не две сжатые колонки.

import { useEffect, useState } from 'react';
import type { Opportunity, OpportunityDetail, CheckResult, ImportResult, SearchMode } from '../api/types.ts';
import { hasUnresolvedBlocker, type Expectation, type BlockerVerdict } from '@huntback/core';
import { Score, Meter, Chip, KindChip, Checks, Card, Field, Empty } from '../components/ui.tsx';

const BRIDGE_LABEL: Record<string, string> = {
  transferable_metrics: 'metrics transfer across industries',
  trajectory: 'show the trajectory, not the size',
  explained_gap: 'explain the gap',
  grouped_roles: 'group the roles',
  deliberate_choice: 'a deliberate role choice',
  analogous_tools: 'analogous tools',
  relocation_ready: 'ready to relocate',
  results_over_years: 'results over years',
};

const BLOCKER_LABEL: Record<string, string> = {
  work_auth: 'Work authorization',
  language: 'Language',
  scale: 'Scale',
  no_people_mgmt: 'People management',
  license: 'License',
  salary: 'Salary expectations',
};

type KindFilter = 'all' | 'hypothesis' | 'vacancy';

const FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hypothesis', label: 'Hypotheses' },
  { id: 'vacancy', label: 'Vacancies' },
];

/** CSV для Excel и Google Sheets: BOM, чтобы не сломалась кодировка, и экранирование кавычек. */
function toCsv(list: Opportunity[]): string {
  const cell = (v: unknown) => {
    const t = v == null ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [
    ['Employer', 'Role', 'Type', 'Match %', 'Link'],
    ...list.map(o => [o.company, o.role_title, o.kind, o.score ?? '', o.source_url ?? '']),
  ];
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

function downloadCsv(list: Opportunity[]): void {
  const blob = new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `huntback-places-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Places({
  list, detail, selectedId, busy, searchMode, onSearchMode, onSelect, onAnalyse, onResume, onLetter,
  onArchive, onPatch, onFetchJobText, onImport, onConfirmImport, onGoToProfile, onRun,
}: {
  list: Opportunity[];
  detail: OpportunityDetail | null;
  selectedId: string | null;
  busy: boolean;
  searchMode: SearchMode;
  onSearchMode: (m: SearchMode) => void;
  onSelect: (id: string | null) => void;
  onAnalyse: (id: string) => void;
  onResume: (id: string) => void;
  onLetter: (id: string) => void;
  onArchive: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onFetchJobText: (id: string) => void;
  onImport: (input: { url?: string; text?: string }) => Promise<ImportResult | null>;
  onConfirmImport: (r: ImportResult) => void;
  onGoToProfile: () => void;
  onRun: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<KindFilter>('all');
  const shown = filter === 'all' ? list : list.filter(o => o.kind === filter);
  const count = (k: KindFilter) => (k === 'all' ? list.length : list.filter(o => o.kind === k).length);

  return (
    <div className="stack gap-16">
      <div className="flex items-center between wrap gap-12">
        <div>
          <h1>Places</h1>
          <p className="muted small mt-8">
            {list.length} in progress · {count('vacancy')} vacancies · {count('hypothesis')} hypotheses
          </p>
        </div>
        <div className="flex gap-8 wrap items-center">
          <button className="btn btn-ghost" onClick={() => downloadCsv(list)} disabled={!list.length}
            title="Employer, role, type, match % and link for every place">
            Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => setAdding(a => !a)}>Add vacancy</button>
          <select className="select" style={{ width: 'auto' }} value={searchMode} aria-label="What to search for"
            onChange={e => onSearchMode(e.target.value as SearchMode)}>
            <option value="all">Vacancies + hypotheses</option>
            <option value="vacancies">Vacancies only</option>
          </select>
          <button className="btn btn-primary" onClick={onRun} disabled={busy}>
            {searchMode === 'vacancies' ? 'Find vacancies' : 'Find places'}
          </button>
        </div>
      </div>

      {adding && <AddJob onImport={onImport} onConfirm={r => { onConfirmImport(r); setAdding(false); }} busy={busy} />}

      {!list.length && !adding && (
        <Card>
          <Empty title="Nothing here yet">
            <p>
              Add a vacancy you found yourself — it is the most precise starting point:
              the analysis is built on real text, not guesses about the role.
              Or run a search, and the app will suggest companies where a role is taking shape.
            </p>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add vacancy</button>
          </Empty>
        </Card>
      )}

      {!!list.length && (
        <div className="flex gap-8 wrap" role="tablist" aria-label="Filter by type">
          {FILTERS.map(f => (
            <button key={f.id} role="tab" aria-selected={filter === f.id}
              className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f.id)}>
              {f.label} · {count(f.id)}
            </button>
          ))}
        </div>
      )}

      {!!list.length && (
        <div className="places" data-view={selectedId ? 'detail' : 'list'}>
          <div className="place-list">
            {!shown.length && <p className="small muted" style={{ padding: 12 }}>Nothing of this type yet.</p>}
            {shown.map(o => (
              <button key={o.id} className="place" aria-selected={o.id === selectedId}
                onClick={() => onSelect(o.id)}>
                <div className="place-top">
                  <span className="place-company">{o.company}</span>
                  <span className="place-role">{o.role_title}</span>
                </div>
                <div className="place-meta">
                  <KindChip kind={o.kind} />
                  {o.city && <Chip>{o.city}</Chip>}
                  {o.score != null && <Score value={o.score} size="sm" />}
                </div>
              </button>
            ))}
          </div>

          <div className="place-detail">
            {detail
              ? <Detail key={detail.opportunity.id} d={detail} busy={busy} onAnalyse={onAnalyse} onResume={onResume}
                  onLetter={onLetter} onArchive={onArchive} onPatch={onPatch} onFetchJobText={onFetchJobText}
                  onBack={() => onSelect(null)} onGoToProfile={onGoToProfile} />
              : <Card><Empty title="Pick a place on the left" /></Card>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Добавление вакансии (§3.4) ──────────────────────────────────────────────
function AddJob({ onImport, onConfirm, busy }: {
  onImport: (i: { url?: string; text?: string }) => Promise<ImportResult | null>;
  onConfirm: (r: ImportResult) => void;
  busy: boolean;
}) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  if (result) {
    const p = result.parsed;
    const empty = (v: string) => !v.trim();
    return (
      <Card className="card-pad">
        <h3>Check what was recognised</h3>
        <p className="muted small mt-8" style={{ marginBottom: 16 }}>
          {result.duplicate_of
            ? 'This place already exists. Instead of creating a duplicate, you can add the job posting text to the existing one.'
            : p.confidence === 'high'
              ? 'Recognised with confidence. Check and confirm — the place is not created without confirmation.'
              : 'Recognised with low confidence: empty fields are highlighted, better fill them in by hand.'}
        </p>
        <div className="row">
          <Field label="Company">
            <input className="input" value={p.company}
              style={empty(p.company) ? { borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' } : undefined}
              onChange={e => setResult({ ...result, parsed: { ...p, company: e.target.value } })} />
          </Field>
          <Field label="Role">
            <input className="input" value={p.role_title}
              style={empty(p.role_title) ? { borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' } : undefined}
              onChange={e => setResult({ ...result, parsed: { ...p, role_title: e.target.value } })} />
          </Field>
        </div>
        <div className="row">
          <Field label="City">
            <input className="input" value={p.city}
              onChange={e => setResult({ ...result, parsed: { ...p, city: e.target.value } })} />
          </Field>
          <Field label="Country" hint="Used to pick the resume format and check work authorization">
            <input className="input" value={p.country}
              onChange={e => setResult({ ...result, parsed: { ...p, country: e.target.value } })} />
          </Field>
        </div>
        <div className="flex gap-8 mt-8">
          <button className="btn btn-primary" onClick={() => onConfirm(result)}
            disabled={!p.company.trim() || !p.role_title.trim()}>
            {result.duplicate_of ? 'Add to existing' : 'Create place'}
          </button>
          <button className="btn btn-ghost" onClick={() => setResult(null)}>Cancel</button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="card-pad">
      <h3>Add a vacancy</h3>
      <p className="muted small mt-8" style={{ marginBottom: 16 }}>
        Either field works. A link is easier, but LinkedIn, Indeed and some
        corporate ATSs only serve the page to a browser — then just paste the text.
      </p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field label="Vacancy link">
          <input className="input" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </Field>
        <Field label="Or the posting text">
          <textarea className="textarea" style={{ minHeight: 96 }} value={text}
            onChange={e => setText(e.target.value)} placeholder="Paste the whole description" />
        </Field>
      </div>
      <button className="btn btn-primary" disabled={busy || (!url.trim() && !text.trim())}
        onClick={async () => {
          const r = await onImport(text.trim() ? { text } : { url });
          if (r) setResult(r);
        }}>
        Recognise
      </button>
    </Card>
  );
}

// ── Карточка места (§13.1.4) ────────────────────────────────────────────────
function Detail({ d, busy, onAnalyse, onResume, onLetter, onArchive, onPatch, onFetchJobText, onBack, onGoToProfile }: {
  d: OpportunityDetail; busy: boolean;
  onAnalyse: (id: string) => void; onResume: (id: string) => void; onLetter: (id: string) => void;
  onArchive: (id: string) => void; onPatch: (id: string, p: Record<string, unknown>) => void;
  onFetchJobText: (id: string) => void;
  onBack: () => void; onGoToProfile: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'jd'>('overview');
  const o = d.opportunity;
  const a = d.analysis;
  const blockers = (a?.blockers ?? []) as BlockerVerdict[];
  const unresolved = hasUnresolvedBlocker(blockers);
  const resume = d.documents.find(x => x.kind === 'resume');
  const letter = d.documents.find(x => x.kind === 'letter');

  return (
    <div className="stack gap-16">
      <button className="btn btn-ghost btn-sm back-to-list" onClick={onBack}>← Back to list</button>

      <Card>
        <div className="card-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{o.company}</h2>
            <div className="sub">{o.role_title}</div>
            <div className="place-meta mt-8">
              <KindChip kind={o.kind} />
              {o.industry && <Chip>{o.industry}</Chip>}
              {(o.city || o.country) && <Chip>{[o.city, o.country].filter(Boolean).join(', ')}</Chip>}
              {o.size && <Chip>{o.size}</Chip>}
              {o.source_url && <a className="chip chip-btn" href={o.source_url} target="_blank" rel="noreferrer">source ↗</a>}
            </div>
          </div>
          {a && (
            <div style={{ textAlign: 'right', minWidth: 96 }}>
              <Score value={a.score} />
              {d.coverage && (
                <div className="small muted">{d.coverage.closed} of {d.coverage.total} covered</div>
              )}
            </div>
          )}
        </div>

        {o.signal && (
          <div className="card-pad" style={{ paddingTop: 16, paddingBottom: 16 }}>
            <div className="section-label">Signal</div>
            <p style={{ fontSize: 14 }}>{o.signal}</p>
            {o.source_date && <p className="small muted mt-8">Signal date: {o.source_date}</p>}
          </div>
        )}
      </Card>

      <div className="flex gap-8" role="tablist" aria-label="Place sections">
        <button role="tab" aria-selected={tab === 'overview'}
          className={`btn btn-sm ${tab === 'overview' ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setTab('overview')}>Overview</button>
        <button role="tab" aria-selected={tab === 'jd'}
          className={`btn btn-sm ${tab === 'jd' ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setTab('jd')}>
          Job description{o.jd_text ? '' : ' · empty'}
        </button>
      </div>

      {tab === 'jd' && (
        <JobText o={o} busy={busy} analysed={!!a}
          onSave={text => onPatch(o.id, { jd_text: text })}
          onFetch={() => onFetchJobText(o.id)}
          onAnalyse={() => onAnalyse(o.id)} />
      )}

      {tab === 'overview' && <>
      {/* Блокеры — первым блоком после сигнала, до всякой генерации (§3.3). */}
      {!!blockers.length && (
        <div className="stack gap-8">
          {blockers.map((b, i) => (
            <div key={i} className="blocker">
              <div className="blocker-title">
                <span aria-hidden>▲</span>
                Hard blocker · {BLOCKER_LABEL[b.kind] ?? b.kind}
              </div>
              <div className="blocker-detail">{b.detail}</div>
              <div className="blocker-actions">
                {b.resolvable_by_profile && (
                  <button className="btn btn-secondary btn-sm" onClick={onGoToProfile}>
                    Resolve by updating the profile
                  </button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => onArchive(o.id)}>Archive</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!a && (
        <Card className="card-pad">
          <h3>Expectations not analysed</h3>
          <p className="muted small mt-8" style={{ marginBottom: 14 }}>
            {o.jd_text
              ? 'There is a job posting text — the analysis will be built on it, not on guesses about the role.'
              : 'No job posting text: expectations will be reconstructed from the role, industry and signal, and marked as a reconstruction. You can add the text in the Job description tab.'}
          </p>
          <button className="btn btn-primary" onClick={() => onAnalyse(o.id)} disabled={busy}>
            Analyse expectations
          </button>
        </Card>
      )}

      {a && (
        <>
          <Card>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h3>Employer expectations</h3>
                <div className="sub">
                  {a.reconstructed
                    ? 'Reconstruction: no job posting text, expectations inferred from the role and signal'
                    : 'Extracted from the job posting text'}
                </div>
              </div>
            </div>
            <div className="card-pad">
              <Meter value={a.score} />
              <div className="mt-16">
                {a.expectations.map((e, i) => <ExpectationRow key={i} e={e} />)}
              </div>
            </div>
          </Card>

          <Card className="card-pad">
            <div className="section-label">Your value proposition</div>
            <p style={{ fontSize: 14.5 }}>{a.uvp}</p>
            {a.objection && (
              <>
                <div className="section-label mt-24">Main objection</div>
                <p style={{ fontSize: 14 }}>
                  <b>What the decision-maker fears:</b> {a.objection.risk}
                </p>
                {a.objection.answer && (
                  <p style={{ fontSize: 14 }} className="mt-8">
                    <b>How to address it:</b> {a.objection.answer}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card className="card-pad">
            <div className="section-label">Channel into the company</div>
            <p className="small muted" style={{ marginBottom: 12 }}>
              A referral converts to interviews an order of magnitude better than a cold application.
              The app doesn’t find contacts for you, but it asks before you
              spend your shot.
            </p>
            <div className="row">
              <Field label="How we approach">
                <select className="select" value={o.channel}
                  onChange={e => onPatch(o.id, { channel: e.target.value })}>
                  <option value="cold">Cold application</option>
                  <option value="warm">Warm contact</option>
                  <option value="referral">Referral — I’ll be introduced</option>
                </select>
              </Field>
              {o.channel !== 'cold' && (
                <Field label="Who can introduce you">
                  <input className="input" defaultValue={o.referral_name ?? ''}
                    onBlur={e => onPatch(o.id, { referral_name: e.target.value })} />
                </Field>
              )}
            </div>
          </Card>

          {unresolved && (
            <div className="notice-warn">
              This place has an unresolved hard blocker. A resume and a letter won’t close it, and the attempt
              will almost certainly fail — but the decision is yours.
            </div>
          )}

          <DocumentBlock
            title="Resume for this place"
            hint={`Format: ${resume?.format_variant ?? 'by the place’s country'}. Not new text, but confirmed facts rearranged around the expectations.`}
            doc={resume ? renderResume(resume.body) : null}
            checks={resume?.checks ?? []}
            action={resume ? 'Rebuild' : 'Build resume'}
            busy={busy}
            onRun={() => onResume(o.id)}
          />

          <DocumentBlock
            title={o.kind === 'vacancy' ? 'Cover letter' : 'Cold letter to an executive'}
            hint={o.kind === 'vacancy' ? '250–350 words, read together with the resume' : '120–180 words: one observation, one proof, one ask'}
            doc={letter ? (letter.subject ? `Subject: ${letter.subject}\n\n${letter.body}` : letter.body) : null}
            checks={letter?.checks ?? []}
            action={letter ? 'Rewrite' : 'Write letter'}
            busy={busy}
            onRun={() => onLetter(o.id)}
          />
        </>
      )}
      </>}
    </div>
  );
}

/**
 * Текст вакансии как референс: хранится в месте, правится руками или
 * скачивается по ссылке источника. Разбор ожиданий строится именно на нём.
 */
function JobText({ o, busy, analysed, onSave, onFetch, onAnalyse }: {
  o: Opportunity; busy: boolean; analysed: boolean;
  onSave: (text: string) => void; onFetch: () => void; onAnalyse: () => void;
}) {
  const [text, setText] = useState(o.jd_text ?? '');
  useEffect(() => setText(o.jd_text ?? ''), [o.jd_text]);
  const dirty = text !== (o.jd_text ?? '');
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>Job description</h3>
          <div className="sub">
            Saved as a reference for this place. The expectation analysis uses this text
            instead of reconstructing the role.
          </div>
        </div>
        {o.source_url && (
          <a className="btn btn-ghost btn-sm" href={o.source_url} target="_blank" rel="noreferrer">Open source ↗</a>
        )}
      </div>
      <div className="card-pad">
        {!o.jd_text && (
          <p className="small muted" style={{ marginBottom: 10 }}>
            No text saved yet. Paste the posting below{o.source_url ? ' or fetch it from the source link' : ''}.
          </p>
        )}
        <textarea className="textarea" style={{ minHeight: 320, fontSize: 14, lineHeight: 1.6 }}
          value={text} onChange={e => setText(e.target.value)} aria-label="Job description text"
          placeholder="Paste the full job posting here" />
        <div className="flex gap-8 wrap mt-12">
          <button className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => onSave(text)}>Save</button>
          {dirty && <button className="btn btn-ghost btn-sm" onClick={() => setText(o.jd_text ?? '')}>Discard changes</button>}
          {o.source_url && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onFetch}
              title="Download the page from the source link; LinkedIn and Indeed usually block this">
              Fetch from source link
            </button>
          )}
          {!!o.jd_text && !dirty && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onAnalyse}>
              {analysed ? 'Re-analyse with this text' : 'Analyse expectations'}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ExpectationRow({ e }: { e: Expectation }) {
  const tone = e.strength === 'strong' ? 'good' : e.strength === 'partial' ? 'mid' : 'danger';
  const label = e.strength === 'strong' ? 'covered' : e.strength === 'partial' ? 'partial' : 'gap';
  return (
    <div className="exp">
      <div className="exp-head">
        <span className="exp-text"><span className="exp-k">Expected</span>{e.expectation}</span>
        <Chip>{e.weight === 'must' ? 'must' : e.weight === 'important' ? 'important' : 'nice to have'}</Chip>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {/* Пара «ждут / есть у вас»: слева — ожидание в заголовке строки, справа —
          чем оно закрыто. Повторять текст ожидания во второй раз незачем. */}
      <div className={`exp-cell ${e.strength === 'gap' ? 'exp-cell--gap' : ''} mt-8`}>
        <span className="k">You have</span>
        {e.evidence || <span className="muted">no evidence</span>}
        {e.source_hint && <div className="exp-quote">“ {e.source_hint} ”</div>}
      </div>
      {e.gap_class === 'soft' && e.bridge && (
        <p className="small mt-8">
          <b>Bridge:</b> {BRIDGE_LABEL[e.bridge] ?? e.bridge}
          {e.gap_answer && <> — {e.gap_answer}</>}
        </p>
      )}
    </div>
  );
}

function DocumentBlock({ title, hint, doc, checks, action, busy, onRun }: {
  title: string; hint: string; doc: string | null; checks: CheckResult[];
  action: string; busy: boolean; onRun: () => void;
}) {
  const blocked = checks.some(c => c.level === 'block');
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>{title}</h3>
          <div className="sub">{hint}</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRun} disabled={busy}>{action}</button>
      </div>
      <div className="card-pad">
        {!doc && <p className="small muted">Not created yet.</p>}
        {doc && (
          <>
            {blocked && (
              <p className="small" style={{ color: 'var(--danger)', marginBottom: 10 }}>
                There are blocking remarks — don’t send this text as is.
              </p>
            )}
            <textarea className="textarea" style={{ minHeight: 260, fontSize: 14, lineHeight: 1.65 }}
              defaultValue={doc} aria-label={title} />
            <div className="section-label mt-16">Checks</div>
            <Checks items={checks} />
          </>
        )}
      </div>
    </Card>
  );
}

function renderResume(body: string): string {
  try {
    const r = JSON.parse(body) as {
      headline: string; summary: string[]; facts_line: string; competencies: string[];
      experience: { company: string; role_title: string; period_from: string; period_to: string | null;
        context_line: string; bullets: string[] }[];
      education: string[];
    };
    return [
      r.headline, '',
      ...r.summary, '',
      r.facts_line, '',
      'KEY COMPETENCIES', r.competencies.join(' · '), '',
      'EXPERIENCE',
      ...r.experience.flatMap(e => [
        `${e.role_title} — ${e.company}, ${e.period_from} — ${e.period_to ?? 'present'}`,
        e.context_line,
        ...e.bullets.map(b => `• ${b}`), '',
      ]),
      'EDUCATION', ...r.education,
    ].join('\n');
  } catch {
    return body;
  }
}
