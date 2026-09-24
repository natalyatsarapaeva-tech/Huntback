import type { ReactNode } from 'react';
import { scoreBand, humanDuration, type CheckResult, type RunProgress } from '@huntback/core';

// ── Совпадение (§11.3) ──────────────────────────────────────────────────────
export function Score({ value, size = 'md' }: { value: number | null | undefined; size?: 'md' | 'sm' }) {
  if (value == null) return <span className="chip">не разобрано</span>;
  const band = scoreBand(value);
  return (
    <span className={`score score--${band}`} title="Совпадение с ожиданиями места">
      <span className="score-num" style={size === 'sm' ? { fontSize: 18 } : undefined}>{value}</span>
      <span className="score-pct">%</span>
    </span>
  );
}

export function Meter({ value }: { value: number }) {
  const band = scoreBand(value);
  return (
    <div className={`meter meter--${band}`} role="img" aria-label={`Совпадение ${value} процентов`}>
      <i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

// ── Чипы ────────────────────────────────────────────────────────────────────
export function Chip({ tone = 'plain', children, title }:
{ tone?: 'plain' | 'accent' | 'good' | 'mid' | 'danger'; children: ReactNode; title?: string }) {
  const cls = tone === 'plain' ? 'chip' : `chip chip--${tone}`;
  return <span className={cls} title={title}>{children}</span>;
}

export function KindChip({ kind }: { kind: 'vacancy' | 'hypothesis' }) {
  return kind === 'vacancy'
    ? <Chip title="Вакансия опубликована, есть источник">вакансия</Chip>
    : <Chip tone="accent" title="Вакансии нет: компания, где роль вероятно назреет">гипотеза</Chip>;
}

// ── Статус-бар (§13.2) ──────────────────────────────────────────────────────
export type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string; progress?: RunProgress | null }
  | { kind: 'ok'; text: string; lines?: string[] }
  | { kind: 'error'; text: string; lines?: string[] }
  | { kind: 'info'; text: string };

export function StatusBar({ status, elapsed, onDismiss }:
{ status: Status; elapsed: number; onDismiss: () => void }) {
  if (status.kind === 'idle') return null;
  const progress = status.kind === 'busy' ? status.progress ?? null : null;
  return (
    <div className={`statusbar statusbar--${status.kind}`} role="status" aria-live="polite">
      {status.kind === 'busy' && !progress && <span className="spinner" aria-hidden />}
      <div className="statusbar-body">
        <span>
          {progress ? progress.label : status.text}
          {progress?.detail && <span className="muted"> · {progress.detail}</span>}
          {/* Долгие операции без счётчика читаются как зависшие (§13.2). */}
          {status.kind === 'busy' && !progress && elapsed > 0 && (
            <span className="muted"> · {elapsed} с</span>
          )}
        </span>
        {progress && <RunBar p={progress} />}
        {/* Разбивка по направлениям поиска: без неё «найдено 0» не объяснить. */}
        {'lines' in status && status.lines?.length ? (
          <ul className="small mt-8" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {status.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        ) : null}
      </div>
      {status.kind !== 'busy' && (
        <button onClick={onDismiss} aria-label="Закрыть сообщение">✕</button>
      )}
    </div>
  );
}

/**
 * Полоса прогона поиска. Проценты и остаток считает ядро — та же функция, что
 * на сервере, поэтому полоса не может разойтись с реальным ходом работы.
 */
function RunBar({ p }: { p: RunProgress }) {
  const done = p.stage === 'done';
  return (
    <div className="runbar">
      <div className="runbar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={p.percent} aria-label="Прогресс поиска">
        <i style={{ width: `${Math.max(2, p.percent)}%` }} />
      </div>
      <span className="runbar-meta">
        {p.percent}%
        {!done && p.remainingSec > 0 && <> · осталось {humanDuration(p.remainingSec)}</>}
      </span>
    </div>
  );
}

// ── Проверки документа (§10.10) ─────────────────────────────────────────────
export function Checks({ items }: { items: CheckResult[] }) {
  if (!items.length) {
    return <p className="small muted">Проверки пройдены: замечаний нет.</p>;
  }
  const order = { block: 0, warn: 1, info: 2 } as const;
  const sorted = [...items].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="checks">
      {sorted.map((c, i) => (
        <div key={i} className={`check check--${c.level}`}>
          <span className="check-dot" aria-hidden />
          <span>
            {c.message}
            <span className="muted small"> · {c.rule}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Поля ────────────────────────────────────────────────────────────────────
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
