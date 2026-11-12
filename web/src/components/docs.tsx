// Готовый документ: отчёт ревью, копирование, печать в PDF, скачивание.
// Общий для резюме под место, письма и мастер-резюме.

import { useState } from 'react';
import type { DocumentReview, ResumeDoc } from '../api/types.ts';

const ISSUE_LABEL: Record<string, string> = {
  factual: 'fact', duplication: 'repeat', far_fetched: 'stretch', cliche: 'cliché', ai_ism: 'AI-ism', other: 'other',
};

/** «Проверено дважды»: что нашёл проверяющий и сколько раз текст переписан. */
export function ReviewReport({ review }: { review: DocumentReview | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!review || !review.rounds.length) return null;
  const total = review.rounds.reduce((n, r) => n + r.issues.length + r.code_issues.length, 0);
  const last = review.rounds[review.rounds.length - 1];
  const lastOpen = last.issues.length + last.code_issues.length;
  return (
    <div className="review-report">
      <button className="review-report-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="review-badge" aria-hidden>✓✓</span>
        <span>
          Reviewed {review.rounds.length === 1 ? 'once' : `${review.rounds.length} times`}
          {' · '}{total} remark{total === 1 ? '' : 's'} found
          {' · '}rewritten {review.rewrites === 0 ? 'not needed' : review.rewrites === 1 ? 'once' : `${review.rewrites} times`}
          {lastOpen > 0 && review.rewrites < review.rounds.length && <> · {lastOpen} left — see below</>}
        </span>
        <span className="muted small">{open ? 'hide' : 'details'}</span>
      </button>
      {open && (
        <div className="review-rounds">
          {review.rounds.map(r => (
            <div key={r.round} className="review-round">
              <div className="small" style={{ fontWeight: 600 }}>
                Round {r.round}: {r.issues.length + r.code_issues.length ? `${r.issues.length + r.code_issues.length} remark(s), sent back for a rewrite` : 'no remarks'}
              </div>
              <ul>
                {r.issues.map((i, k) => (
                  <li key={k}>
                    <span className={`chip ${i.severity === 'high' ? 'chip--danger' : ''}`}>{ISSUE_LABEL[i.type] ?? i.type}</span>{' '}
                    <q>{i.quote}</q> — {i.problem}{i.fix && <span className="muted"> → {i.fix}</span>}
                  </li>
                ))}
                {r.code_issues.map((c, k) => <li key={'c' + k} className="muted">{c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
}

export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Печатная версия: одна колонка, стандартные заголовки, без таблиц и иконок —
 * то, что проходит ATS. «Сохранить как PDF» в диалоге печати даёт файл.
 */
export function resumeHtml(r: ResumeDoc, name = ''): string {
  const role = (e: ResumeDoc['experience'][number]) => `
    <div class="role"><div class="rh"><b>${esc(e.role_title)}</b> — ${esc(e.company)}<span>${esc(e.period_from)} – ${esc(e.period_to ?? 'present')}</span></div>
    ${e.context_line ? `<div class="ctx">${esc(e.context_line)}</div>` : ''}
    <ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name || r.headline)}</title>
<style>
 body{font:10.5pt/1.45 Georgia,'Times New Roman',serif;color:#111;max-width:720px;margin:28px auto;padding:0 24px}
 h1{font-size:18pt;margin:0 0 2px} .head{font-size:12pt;margin:0 0 10px}
 h2{font-size:10.5pt;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #999;margin:16px 0 6px;padding-bottom:2px}
 .facts{font-size:9.5pt;color:#333;margin:0 0 8px} .rh{display:flex;justify-content:space-between;gap:12px}
 .rh span{color:#444;white-space:nowrap} .ctx{font-style:italic;color:#333;font-size:9.5pt}
 ul{margin:4px 0 10px 18px;padding:0} li{margin:2px 0} p{margin:0 0 4px}
 @media print{body{margin:0 auto}}
</style></head><body>
${name ? `<h1>${esc(name)}</h1><div class="head">${esc(r.headline)}</div>` : `<h1>${esc(r.headline)}</h1>`}
${r.facts_line ? `<div class="facts">${esc(r.facts_line)}</div>` : ''}
${r.summary.map(s => `<p>${esc(s)}</p>`).join('')}
<h2>Key competencies</h2><p>${r.competencies.map(esc).join(' · ')}</p>
<h2>Experience</h2>${r.experience.map(role).join('')}
${r.education.length ? `<h2>Education</h2>${r.education.map(e => `<p>${esc(e)}</p>`).join('')}` : ''}
</body></html>`;
}

export function letterHtml(subject: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(subject || 'Letter')}</title>
<style>body{font:11pt/1.6 Georgia,serif;color:#111;max-width:640px;margin:40px auto;padding:0 24px} p{margin:0 0 12px}</style></head><body>
${body.split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
</body></html>`;
}

/** Открыть печатную версию. Без всплывающего окна — через скрытый iframe, это не блокируется. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed'; frame.style.right = '0'; frame.style.bottom = '0';
  frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1500);
  }, 150);
}

export function resumePlainText(r: ResumeDoc): string {
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
}

export function parseResume(body: string): ResumeDoc | null {
  try { return JSON.parse(body) as ResumeDoc; } catch { return null; }
}

/** Кнопки выдачи: копировать, печать/PDF, .txt. */
export function DocActions({ text, html, fileName }: { text: string; html: string; fileName: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-8 wrap">
      <button className="btn btn-secondary btn-sm" onClick={async () => {
        if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
      }}>{copied ? 'Copied ✓' : 'Copy text'}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => printHtml(html)} title="Opens the print dialog — choose “Save as PDF”">Print / PDF</button>
      <button className="btn btn-ghost btn-sm" onClick={() => downloadText(fileName, text)}>Download .txt</button>
    </div>
  );
}
