// Онбординг (§3.1). Четыре шага, из которых первые два занимают минуту, а
// третий — та самая разовая работа на 15–30 минут, ради которой всё остальное
// потом работает. Поэтому шаг с фактами не прячется за «продолжить»: он
// показывает, ЧТО именно даёт подтверждение, и разрешает уйти раньше.

import { useEffect, useState } from 'react';
import type { Profile, Fact, AuditReport } from '../api/types.ts';
import { Field, Card } from '../components/ui.tsx';
import { SearchPrefsFields, LanguageEditor, WorkAuthEditor, type SearchPrefs } from './Profile.tsx';
import { parseGeo } from '@huntback/core';
import { FactReview } from './FactReview.tsx';

const STEPS = ['Resume', 'Perimeter', 'Facts', 'Doubts'] as const;

export function Onboarding({ profile, facts, audit, busy, onSave, onAudit, onPatchFact, onAnswerFact, onDone }: {
  profile: Profile; facts: Fact[]; audit: AuditReport | null; busy: boolean;
  onSave: (patch: Partial<Profile>) => Promise<void>;
  onAudit: () => Promise<void>;
  onPatchFact: (id: string, patch: Partial<Fact>) => Promise<void> | void;
  onAnswerFact: (id: string, answer: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [resume, setResume] = useState(profile.resume_text);
  const [extras, setExtras] = useState(profile.extras_text);
  const [prefs, setPrefs] = useState<SearchPrefs>({
    perimeter: profile.perimeter, geo: profile.geo, industries: profile.industries,
    exclude: profile.exclude, breadth: profile.breadth,
  });

  // Шаг «сомнения» — короткая форма, а не список «заполните потом»: незаполненное
  // право на работу блокировало КАЖДОЕ место в стране, и пакетная подготовка
  // документов пропускала все. Регионы берутся из географии поиска.
  const [doubts, setDoubts] = useState(() => ({
    work_auth: profile.work_auth.length ? profile.work_auth : [],
    languages: profile.languages,
    team_max: profile.scale?.team_max ?? null,
    managers_max: profile.scale?.managers_max ?? null,
    relocation: profile.relocation?.ready ?? '',
  }));

  // Права на работу по странам поиска — сразу строками, остаётся выбрать статус.
  // В эффекте, а не в «Далее»: на шаг 4 приводит и конец разбора фактов.
  useEffect(() => {
    if (step !== 3) return;
    setDoubts(d => (d.work_auth.length ? d
      : { ...d, work_auth: parseGeo(prefs.geo).map(g => ({ region: g.name, status: 'permit' as const })) }));
  }, [step, prefs.geo]);

  async function next() {
    if (step === 0) { await onSave({ resume_text: resume, extras_text: extras }); setStep(1); return; }
    if (step === 1) {
      await onSave(prefs);
      setStep(2);
      if (!facts.length) await onAudit();
      return;
    }
    if (step === 2) { setStep(3); return; }
    await onSave({
      work_auth: doubts.work_auth.filter(w => w.region.trim()),
      languages: doubts.languages.filter(l => l.lang.trim()),
      scale: { ...(profile.scale ?? {}), team_max: doubts.team_max, managers_max: doubts.managers_max },
      relocation: doubts.relocation ? { ready: doubts.relocation as 'yes' | 'no' | 'conditional', package_needed: false } : null,
    });
    onDone();
  }

  return (
    <div className="main main--narrow">
      <div className="stepper" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < step ? 'step--done' : i === step ? 'step--current' : ''}`}>
            <span className="step-n">{i < step ? '✓' : i + 1}</span>{s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="card-pad">
          <h1>Let’s start with your resume</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            Paste the text as is — formatting doesn’t matter. From it the app will build
            a fact bank: the single source for every resume and letter
            you send from here.
          </p>
          <Field label="Resume">
            <textarea className="textarea" style={{ minHeight: 260 }} value={resume}
              onChange={e => setResume(e.target.value)}
              placeholder="Title, company, years, what you did, what came of it…" />
          </Field>
          <Field label="Additional notes — optional"
            hint="What the resume doesn’t say: what you learned, whom you grew, why there were gaps, where you’d relocate. This is often stronger than the resume itself.">
            <textarea className="textarea" value={extras} onChange={e => setExtras(e.target.value)} />
          </Field>
        </Card>
      )}

      {step === 1 && (
        <Card className="card-pad">
          <h1>Where to search</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            The perimeter is the facets of your experience, each relevant to its own
            roles. List them separated by semicolons: the more there are, the wider
            the search looks.
          </p>
          <SearchPrefsFields value={prefs} onChange={patch => setPrefs(x => ({ ...x, ...patch }))} />
          <p className="small muted">You can change all of this later in your profile.</p>
        </Card>
      )}

      {step === 2 && (
        <Card className="card-pad">
          <h1>Confirm the facts</h1>
          <p className="muted mt-8" style={{ marginBottom: 16 }}>
            One fact at a time: the line from your resume, the fact made from it, and one
            suggestion — a question that gets the missing number, or a stronger wording.
            Only confirmed facts go into resumes and letters; this keeps the model from
            crediting you with someone else’s achievement.
          </p>
          {busy && !facts.length && (
            <p className="small muted">Breaking the resume down into facts… this takes up to a minute.</p>
          )}
          {!!facts.length && (
            <>
              <FactReview facts={facts} busy={busy} onPatch={onPatchFact} onAnswer={onAnswerFact}
                onFinished={() => setStep(3)} />
            </>
          )}
        </Card>
      )}

      {step === 3 && (
        <Card className="card-pad">
          <h1>What removes doubts</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            A screener asks these about everyone and almost never out loud. One minute here:
            without the right to work, every place in that country is held back as “unknown”,
            and documents aren’t prepared for it.
          </p>
          <div className="section-label">Where you can work</div>
          <WorkAuthEditor value={doubts.work_auth} onChange={v => setDoubts(d => ({ ...d, work_auth: v }))} />
          <div className="section-label mt-24">Languages</div>
          <LanguageEditor value={doubts.languages} onChange={v => setDoubts(d => ({ ...d, languages: v }))} />
          <div className="section-label mt-24">Largest team you led</div>
          <div className="row">
            <Field label="People, direct and indirect">
              <input className="input" inputMode="numeric" value={doubts.team_max ?? ''}
                onChange={e => setDoubts(d => ({ ...d, team_max: e.target.value ? Number(e.target.value) || null : null }))} />
            </Field>
            <Field label="Of them, managers">
              <input className="input" inputMode="numeric" value={doubts.managers_max ?? ''}
                onChange={e => setDoubts(d => ({ ...d, managers_max: e.target.value ? Number(e.target.value) || null : null }))} />
            </Field>
            <Field label="Open to relocation">
              <select className="select" value={doubts.relocation}
                onChange={e => setDoubts(d => ({ ...d, relocation: e.target.value }))}>
                <option value="">Not specified</option>
                <option value="yes">Yes</option>
                <option value="conditional">Under conditions</option>
                <option value="no">No</option>
              </select>
            </Field>
          </div>
          {audit && audit.tasks.length > 0 && (
            <p className="small muted mt-16">
              More in your profile and the resume coach: {audit.tasks.slice(0, 2).map(t => t.text.toLowerCase()).join('; ')}.
            </p>
          )}
        </Card>
      )}

      <div className="onb-actions">
        {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <span className="spacer" />
        {step === 2 && <button className="btn btn-ghost" onClick={() => setStep(3)}>Confirm later</button>}
        <button className="btn btn-primary" onClick={next}
          disabled={busy || (step === 0 && !resume.trim())}>
          {step === 0 && 'Next'}
          {step === 1 && 'Analyse resume'}
          {step === 2 && 'Next'}
          {step === 3 && 'Go to search'}
        </button>
      </div>
      {step === 0 && !resume.trim() && (
        <p className="small muted mt-8">You can’t continue without resume text: everything starts from it.</p>
      )}
    </div>
  );
}
