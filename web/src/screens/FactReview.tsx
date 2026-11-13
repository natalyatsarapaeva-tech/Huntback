// Разбор фактов по одному (§10.4a в редакции 1.3).
//
// Раньше третий шаг онбординга был списком чекбоксов: человек видел двадцать
// фактов и не знал, что с ними делать, кроме «подтвердить». Теперь у каждого
// факта рядом цитата из резюме и одно конкретное предложение: вопрос, который
// добывает число, или более сильная формулировка. Одно действие — следующий
// факт. Разбор двадцати фактов занимает несколько минут, а не полчаса.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Fact } from '../api/types.ts';
import { Chip, Field } from '../components/ui.tsx';

export interface FactReviewProps {
  facts: Fact[];
  busy: boolean;
  onPatch: (id: string, patch: Partial<Fact>) => Promise<void> | void;
  onAnswer: (id: string, answer: string) => Promise<boolean>;
  onDelete?: (id: string) => void;
  /** Все факты разобраны — что дальше. */
  onFinished?: () => void;
}

/** Разобран: подтверждён без открытой подсказки — или осознанно отклонён. */
const done = (f: Fact) => f.review?.status === 'dismissed'
  || (f.confirmed && (!f.review || f.review.status !== 'pending' || f.review.kind === 'ok'));

export function FactReview({ facts, busy, onPatch, onAnswer, onDelete, onFinished }: FactReviewProps) {
  // Очередь фиксируется при открытии: факт не должен прыгать в конец списка,
  // пока человек на него смотрит.
  const [order] = useState(() => [...facts].sort((a, b) => Number(done(a)) - Number(done(b))).map(f => f.id));
  const byId = useMemo(() => new Map(facts.map(f => [f.id, f])), [facts]);
  const queue = order.map(id => byId.get(id)).filter((f): f is Fact => !!f);
  const [index, setIndex] = useState(() => Math.max(0, queue.findIndex(f => !done(f))));
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const f = queue[Math.min(index, queue.length - 1)];
  const confirmed = facts.filter(x => x.confirmed).length;
  const left = queue.filter(x => !done(x)).length;

  useEffect(() => { setAnswer(''); setEditing(false); }, [f?.id]);

  if (!queue.length) return <p className="small muted">No facts yet — run the audit and it will break the resume down into facts.</p>;
  if (!f) return null;

  const next = () => {
    const after = queue.findIndex((x, i) => i > index && !done(x));
    if (after !== -1) { setIndex(after); return; }
    const before = queue.findIndex(x => !done(x) && x.id !== f.id);
    if (before !== -1) { setIndex(before); return; }
    onFinished?.();
    setIndex(i => Math.min(i + 1, queue.length - 1));
  };

  const r = f.review;
  const accept = async () => {
    await onPatch(f.id, { confirmed: true, review: r ? { ...r, status: 'accepted' } : null });
    next();
  };
  const useRewrite = async () => {
    if (!r?.rewrite) return;
    await onPatch(f.id, {
      action: r.rewrite.action, how: r.rewrite.how, result: r.rewrite.result,
      confirmed: true, review: { ...r, status: 'accepted' },
    });
    next();
  };
  const sendAnswer = async () => {
    if (!answer.trim()) return;
    if (await onAnswer(f.id, answer.trim())) next();
  };
  const notMine = async () => {
    await onPatch(f.id, { confirmed: false, review: r ? { ...r, status: 'dismissed' } : null });
    next();
  };

  return (
    <div className="review">
      <div className="review-progress">
        <span>Fact {index + 1} of {queue.length}</span>
        <span className="muted">· {confirmed} confirmed · {left} to go</span>
        <div className="review-bar" aria-hidden><i style={{ width: `${Math.round(100 * (queue.length - left) / queue.length)}%` }} /></div>
      </div>

      <div className="review-card">
        <div className="review-quote">
          <div className="section-label">From your resume</div>
          <blockquote>“{f.source_hint}”</blockquote>
          {(f.role_title || f.company) && <div className="small muted">{[f.role_title, f.company].filter(Boolean).join(' · ')}</div>}
          {f.user_input && <div className="small mt-8"><b>You added:</b> {f.user_input}</div>}
        </div>

        <div className="review-fact">
          <div className="section-label">As a fact</div>
          {editing
            ? <InlineEditor fact={f} onCancel={() => setEditing(false)}
                onSave={async p => { await onPatch(f.id, { ...p, confirmed: true, review: r ? { ...r, status: 'accepted' } : null }); setEditing(false); next(); }} />
            : (
              <>
                <div className="fact-action">{f.action}</div>
                {f.how && <div className="fact-result">{f.how}</div>}
                {f.result && <div className="fact-result">{f.result}</div>}
                <div className="mt-8">
                  {f.quantified
                    ? <Chip tone="good">{f.metric_value ?? ''} {f.metric_unit ?? 'with a number'}</Chip>
                    : <Chip tone="mid">no number yet</Chip>}
                  {f.confirmed && <Chip tone="accent">confirmed</Chip>}
                </div>
              </>
            )}
        </div>
      </div>

      {!editing && r && r.kind !== 'ok' && r.status === 'pending' && (
        <div className="review-suggest">
          {r.rewrite && (
            <div className="suggest">
              <div className="section-label">Stronger wording</div>
              <div className="fact-action">{r.rewrite.action}</div>
              {r.rewrite.how && <div className="fact-result">{r.rewrite.how}</div>}
              {r.rewrite.result && <div className="fact-result">{r.rewrite.result}</div>}
              {r.why && <p className="small muted mt-8">{r.why}</p>}
              <button className="btn btn-primary btn-sm mt-8" disabled={busy} onClick={useRewrite}>Use this wording</button>
            </div>
          )}
          {r.question && (
            <div className="suggest">
              <div className="section-label">A question that makes it stronger</div>
              <p style={{ fontSize: 15 }}>{r.question}</p>
              {!r.rewrite && r.why && <p className="small muted">{r.why}</p>}
              <textarea ref={answerRef} className="textarea mt-8" style={{ minHeight: 64 }} value={answer}
                aria-label="Your answer" placeholder="A short answer with the number is enough: “from 8 to 25 people, 4 of them managers”"
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAnswer(); }} />
              <button className="btn btn-primary btn-sm mt-8" disabled={busy || !answer.trim()} onClick={sendAnswer}>
                Add to the fact
              </button>
              <span className="small muted" style={{ marginLeft: 10 }}>Only numbers you type are used.</span>
            </div>
          )}
        </div>
      )}

      {!editing && (
        <div className="flex gap-8 wrap mt-16">
          <button className={`btn btn-sm ${r && r.kind !== 'ok' && r.status === 'pending' ? 'btn-secondary' : 'btn-primary'}`}
            disabled={busy} onClick={accept}>
            {f.confirmed ? 'Keep as is' : 'Confirm as is'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={notMine}
            title="Not used in any document">Not accurate — don’t use</button>
          {onDelete && (
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => { if (confirm(`Delete the fact “${f.action}”?`)) { onDelete(f.id); next(); } }}>Delete</button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))}>← Previous</button>
          <button className="btn btn-ghost btn-sm" disabled={index >= queue.length - 1} onClick={() => setIndex(i => Math.min(queue.length - 1, i + 1))}>Skip →</button>
        </div>
      )}
    </div>
  );
}

function InlineEditor({ fact, onSave, onCancel }: {
  fact: Fact; onSave: (p: Partial<Fact>) => void; onCancel: () => void;
}) {
  const [action, setAction] = useState(fact.action);
  const [how, setHow] = useState(fact.how ?? '');
  const [result, setResult] = useState(fact.result ?? '');
  return (
    <div>
      <Field label="Action"><input className="input" value={action} onChange={e => setAction(e.target.value)} /></Field>
      <Field label="How"><input className="input" value={how} onChange={e => setHow(e.target.value)} /></Field>
      <Field label="Result" hint="Include the number — quantified facts carry the most weight">
        <input className="input" value={result} onChange={e => setResult(e.target.value)} />
      </Field>
      <div className="flex gap-8">
        <button className="btn btn-primary btn-sm" disabled={!action.trim()}
          onClick={() => onSave({ action: action.trim(), how: how.trim(), result: result.trim() })}>Save and confirm</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
