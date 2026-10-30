// Онбординг (§3.1). Четыре шага, из которых первые два занимают минуту, а
// третий — та самая разовая работа на 15–30 минут, ради которой всё остальное
// потом работает. Поэтому шаг с фактами не прячется за «продолжить»: он
// показывает, ЧТО именно даёт подтверждение, и разрешает уйти раньше.

import { useState } from 'react';
import type { Profile, Fact, AuditReport } from '../api/types.ts';
import { Field, Card } from '../components/ui.tsx';
import { FactList } from './Profile.tsx';

const STEPS = ['Resume', 'Perimeter', 'Facts', 'Doubts'] as const;

export function Onboarding({ profile, facts, audit, busy, onSave, onAudit, onPatchFact, onDone }: {
  profile: Profile; facts: Fact[]; audit: AuditReport | null; busy: boolean;
  onSave: (patch: Partial<Profile>) => Promise<void>;
  onAudit: () => Promise<void>;
  onPatchFact: (id: string, patch: Partial<Fact>) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [resume, setResume] = useState(profile.resume_text);
  const [extras, setExtras] = useState(profile.extras_text);
  const [perimeter, setPerimeter] = useState(profile.perimeter);
  const [geo, setGeo] = useState(profile.geo);
  const [industries, setIndustries] = useState(profile.industries);
  const [exclude, setExclude] = useState(profile.exclude);
  const [breadth, setBreadth] = useState(profile.breadth);

  const confirmed = facts.filter(f => f.confirmed).length;

  async function next() {
    if (step === 0) { await onSave({ resume_text: resume, extras_text: extras }); setStep(1); return; }
    if (step === 1) {
      await onSave({ perimeter, geo, industries, exclude, breadth });
      setStep(2);
      if (!facts.length) await onAudit();
      return;
    }
    if (step === 2) { setStep(3); return; }
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
          <Field label="Roles you are interested in"
            hint="For example: VP Operations; Head of Supply Chain; Director of Logistics">
            <textarea className="textarea" style={{ minHeight: 88 }} value={perimeter}
              onChange={e => setPerimeter(e.target.value)} />
          </Field>
          <div className="row">
            <Field label="Geography" hint="Countries separated by commas — work authorization is checked against them">
              <input className="input" value={geo} onChange={e => setGeo(e.target.value)} placeholder="Sweden, Germany" />
            </Field>
            <Field label="Priority industries">
              <input className="input" value={industries} onChange={e => setIndustries(e.target.value)} />
            </Field>
          </div>
          <Field label="Exclude" hint="Companies, industries or formats that definitely don’t fit">
            <input className="input" value={exclude} onChange={e => setExclude(e.target.value)} />
          </Field>
          <Field label="Search breadth">
            <select className="select" value={breadth} onChange={e => setBreadth(e.target.value as Profile['breadth'])}>
              <option value="narrow">Narrow — mostly published vacancies</option>
              <option value="medium">Medium — vacancies and hypotheses equally</option>
              <option value="wide">Wide — more companies where the role isn’t open yet</option>
            </select>
          </Field>
        </Card>
      )}

      {step === 2 && (
        <Card className="card-pad">
          <h1>Confirm the facts</h1>
          <p className="muted mt-8" style={{ marginBottom: 16 }}>
            Here is what the app found in your resume. Checked facts — and only
            those — go into resumes and letters. Anything unchecked is not used
            anywhere: this keeps the model from crediting you with someone else’s achievement.
          </p>
          {busy && !facts.length && (
            <p className="small muted">Breaking the resume down into facts… this takes up to a minute.</p>
          )}
          {!!facts.length && (
            <>
              <p className="small muted" style={{ marginBottom: 12 }}>
                {confirmed} of {facts.length} confirmed. Facts without a number are highlighted —
                try to recall a figure for them: a measurable result beats any adjective.
              </p>
              <FactList facts={facts} onPatch={onPatchFact} />
            </>
          )}
        </Card>
      )}

      {step === 3 && (
        <Card className="card-pad">
          <h1>What removes doubts</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            These fields answer questions a screener asks about everyone and almost
            never asks out loud. Each filled field is one line
            in the resume and one blocker removed.
          </p>
          {audit && (
            <div className="tasks">
              {audit.tasks.slice(0, 6).map(t => (
                <div key={t.id} className="task"><span>{t.text}</span></div>
              ))}
              {!audit.tasks.length && <p className="small muted">Everything is filled in — ready to search.</p>}
            </div>
          )}
          <p className="small muted mt-16">
            You can fill them in now on the profile screen or later: search
            works without them, the documents will just be weaker.
          </p>
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
