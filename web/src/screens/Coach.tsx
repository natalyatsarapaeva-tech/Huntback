// Коуч резюме: «провести за руку к идеальному резюме».
//
// Слева — чат с одним вопросом за раз; под репликой коуча — предложения,
// которые применяются одной кнопкой. Справа — повестка: что ещё мешает
// резюме на скрининге и прогресс. Что спрашивать, решает ядро; модель —
// только как спросить и как превратить ответ в факт.

import { useEffect, useRef, useState } from 'react';
import type { CoachView, CoachProposal, MasterResume } from '../api/types.ts';
import { Card, Chip } from '../components/ui.tsx';
import { ReviewReport, DocActions, resumeHtml, resumePlainText } from '../components/docs.tsx';
import { Checks } from '../components/ui.tsx';

export function CoachScreen({ view, busy, master, onStart, onSend, onSkip, onProposal, onReviewFacts, onBuildMaster, onRestart }: {
  view: CoachView | null;
  busy: boolean;
  master: MasterResume | null;
  onStart: () => void;
  onSend: (text: string, topicId?: string) => Promise<void>;
  onSkip: (topicId: string) => void;
  onProposal: (id: string, action: 'apply' | 'dismiss') => void;
  onReviewFacts: () => void;
  onBuildMaster: () => void;
  onRestart: () => void;
}) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const messages = view?.messages ?? [];
  const current = [...messages].reverse().find(m => m.role === 'coach')?.topic_id;
  const agenda = view?.agenda ?? [];
  const currentTopic = agenda.find(t => t.id === current);
  const onlyMaster = agenda.every(t => t.kind === 'master_resume');

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await onSend(t, current);
  };

  // Предложения показываются под репликой коуча, после которой появились.
  const proposals = view?.proposals ?? [];

  return (
    <div className="coach">
      <div className="coach-main stack gap-16">
        <div>
          <h1>Resume coach</h1>
          <p className="muted small mt-8">
            One question at a time. Answers become facts only when you apply them, and only with numbers you typed.
          </p>
        </div>

        <Card className="coach-chat">
          {!messages.length && (
            <div className="card-pad">
              <p style={{ fontSize: 15 }}>
                The coach goes through what weakens your resume at screening — results without numbers,
                roles without achievements, unanswered doubts — and asks about each one in turn.
                About 10 minutes for a typical profile.
              </p>
              <button className="btn btn-primary mt-16" disabled={busy} onClick={onStart}>Start</button>
            </div>
          )}
          {!!messages.length && (
            <div className="chat">
              {messages.map((m, i) => {
                const after = m.role === 'coach' ? proposalsAfter(proposals, messages, i) : [];
                return (
                  <div key={i}>
                    <div className={`msg msg--${m.role}`}>{m.text}</div>
                    {after.map(p => <Proposal key={p.id} p={p} busy={busy} onAct={onProposal} />)}
                  </div>
                );
              })}
              <div className="flex gap-8 wrap" style={{ flexDirection: 'row' }}>
                {currentTopic?.kind === 'review_facts' && (
                  <button className="btn btn-secondary btn-sm" onClick={onReviewFacts}>Open fact review</button>
                )}
                {/* Тема закрыта вне чата (факты разобраны, поле заполнено) — продолжить без ответа. */}
                {current && !currentTopic && !onlyMaster && (
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onSend('', undefined)}>Next question</button>
                )}
                {onlyMaster && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={onBuildMaster}>Build master resume</button>
                )}
              </div>
              <div ref={endRef} />
            </div>
          )}
          {!!messages.length && (
            <div className="chat-input">
              <textarea className="textarea" value={text} onChange={e => setText(e.target.value)}
                placeholder="Answer in your own words — numbers help most" aria-label="Your answer"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <div className="flex gap-8 wrap">
                <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={send}>Send</button>
                {current && current !== 'master_resume' && (
                  <button className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => onSkip(current)}>Skip this question</button>
                )}
                <span className="small muted" style={{ alignSelf: 'center' }}>Enter to send · Shift+Enter for a new line</span>
              </div>
            </div>
          )}
        </Card>

        {master && (
          <Card>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h3>Master resume</h3>
                <div className="sub">Built from confirmed facts for your target roles. Tailored versions per place start from the same facts.</div>
              </div>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onBuildMaster}>Rebuild</button>
            </div>
            <div className="card-pad stack gap-12">
              <ReviewReport review={master.review} />
              <textarea className="textarea" style={{ minHeight: 300, fontSize: 14, lineHeight: 1.6 }}
                defaultValue={resumePlainText(master.doc)} key={master.created_at} aria-label="Master resume" />
              <DocActions text={resumePlainText(master.doc)} html={resumeHtml(master.doc)} fileName="resume-master.txt" />
              <div className="section-label">Checks</div>
              <Checks items={master.checks} />
            </div>
          </Card>
        )}
      </div>

      <aside className="coach-side stack gap-12">
        <Card className="card-pad">
          <div className="section-label">Resume readiness</div>
          <div className="meter meter--good" role="img" aria-label={`Readiness ${view?.progress.percent ?? 0} percent`}>
            <i style={{ width: `${Math.max(2, view?.progress.percent ?? 0)}%` }} />
          </div>
          <p className="small muted mt-8">
            {view ? (view.progress.open ? `${view.progress.open} thing${view.progress.open === 1 ? '' : 's'} still weaken your resume` : 'Nothing left — build the master resume') : '—'}
          </p>
        </Card>
        <Card className="card-pad">
          <div className="section-label">What we’ll cover</div>
          <ol className="agenda">
            {agenda.slice(0, 10).map(t => (
              <li key={t.id} className={t.id === current ? 'agenda--current' : ''}>
                <span>{t.title}</span>
                {t.kind !== 'master_resume' && t.id !== current && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onSkip(t.id)} aria-label={`Skip: ${t.title}`}>skip</button>
                )}
              </li>
            ))}
          </ol>
          {agenda.length > 10 && <p className="small muted">…and {agenda.length - 10} more</p>}
          {!!messages.length && (
            <button className="btn btn-ghost btn-sm mt-8" disabled={busy}
              onClick={() => { if (confirm('Clear the conversation and start over? Applied facts stay.')) onRestart(); }}>Start over</button>
          )}
        </Card>
      </aside>
    </div>
  );
}

/** Предложения, созданные ходом коуча с индексом i (по порядку появления). */
function proposalsAfter(all: CoachProposal[], messages: CoachView['messages'], i: number): CoachProposal[] {
  // Каждый ход добавляет предложения в конец списка. Сопоставляем по номеру
  // хода коуча: у первого хода предложений нет (это приветствие).
  const coachTurns = messages.map((m, k) => (m.role === 'coach' ? k : -1)).filter(k => k >= 0);
  const turn = coachTurns.indexOf(i);
  if (turn <= 0) return [];
  // Без явной связи (история старше) — все открытые под последним ходом.
  return turn === coachTurns.length - 1 ? all.filter(p => p.status === 'open') : [];
}

function Proposal({ p, busy, onAct }: { p: CoachProposal; busy: boolean; onAct: (id: string, a: 'apply' | 'dismiss') => void }) {
  const kind = p.kind === 'new_fact' ? 'New fact' : p.kind === 'update_fact' ? 'Update a fact' : 'Profile';
  return (
    <div className="proposal">
      <Chip tone="accent">{kind}</Chip>
      <span className="proposal-text">{p.label}</span>
      <span className="flex gap-6">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAct(p.id, 'apply')}>Apply</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct(p.id, 'dismiss')}>Not quite</button>
      </span>
    </div>
  );
}
