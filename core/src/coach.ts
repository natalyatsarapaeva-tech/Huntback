// Коуч резюме: повестка без модели.
//
// Чат с моделью без повестки превращается в «расскажите о себе» и ходит по
// кругу. Поэтому ЧТО спрашивать, решает ядро — по тем же метрикам, что аудит:
// роли без достижений, факты без числа, пустые поля, которые снимают сомнения.
// Модель решает только КАК спросить и как превратить ответ в факт.

import type { Fact, Profile, RoleDates } from './types.ts';

export type CoachTopicKind =
  | 'review_facts' | 'role_achievements' | 'fact_number' | 'scale' | 'languages'
  | 'work_auth' | 'gap_reason' | 'relocation' | 'perimeter' | 'master_resume';

export interface CoachTopic {
  id: string;
  kind: CoachTopicKind;
  /** Заголовок для пользователя: что сейчас улучшаем. */
  title: string;
  /** Для модели: о чём именно спросить и что получить. */
  goal: string;
  fact_id?: string;
  role?: string;
  /** Чем больше, тем раньше. */
  weight: number;
}

const yearOf = (d?: string | null) => {
  const y = Number(String(d ?? '').slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
};

function roleKey(r: { company?: string; role_title?: string }): string {
  return `${(r.company ?? '').toLowerCase().trim()}|${(r.role_title ?? '').toLowerCase().trim()}`;
}

function isRecent(r: RoleDates, years: number, now: Date): boolean {
  const end = r.to ? yearOf(r.to) : now.getFullYear();
  return end == null || now.getFullYear() - end <= years;
}

export interface AgendaOptions { now?: Date; recentYears?: number; perRole?: number; skipped?: string[] }

/** Повестка по убыванию пользы. Пропущенные темы (`skipped`) не возвращаются. */
export function coachAgenda(profile: Profile, facts: Fact[], opts: AgendaOptions = {}): CoachTopic[] {
  const now = opts.now ?? new Date();
  const recentYears = opts.recentYears ?? 10;
  const perRole = opts.perRole ?? 2;
  const skipped = new Set(opts.skipped ?? []);
  const out: CoachTopic[] = [];

  const unconfirmed = facts.filter(f => !f.confirmed).length;
  if (unconfirmed) {
    out.push({
      id: 'review_facts', kind: 'review_facts', weight: 100,
      title: `Review ${unconfirmed} unconfirmed fact${unconfirmed === 1 ? '' : 's'}`,
      goal: 'Unconfirmed facts are not used in any document. Ask the user to review them in the fact review screen.',
    });
  }

  if (!profile.perimeter.trim()) {
    out.push({
      id: 'perimeter', kind: 'perimeter', weight: 95, title: 'Which roles you are targeting',
      goal: 'Find out 2–4 target role titles and the geography. Without them the resume has no direction.',
    });
  }

  // Роли последних лет, где мало фактов с числом.
  const roles = (profile.roles ?? []).filter(r => isRecent(r, recentYears, now));
  for (const r of roles) {
    const mine = facts.filter(f => roleKey(f) === roleKey(r) || (!!r.role_title && f.role_title === r.role_title));
    const quantified = mine.filter(f => f.quantified).length;
    if (quantified < perRole) {
      const name = [r.role_title, r.company].filter(Boolean).join(' at ');
      out.push({
        id: `role:${roleKey(r)}`, kind: 'role_achievements', role: name, weight: 80 - out.length,
        title: `Results in your role: ${name}`,
        goal: `This recent role has ${quantified} measurable achievement(s); a screener expects ${perRole}+. `
          + 'Ask for the ONE biggest result in this role: what changed, by how much, compared with what, and how the user did it.',
      });
    }
  }

  // Факты последних ролей без числа — по одному за тему.
  const recentFacts = facts.filter(f => f.confirmed && !f.quantified)
    .filter(f => { const y = yearOf(f.period_to) ?? yearOf(f.period_from); return y == null || now.getFullYear() - y <= recentYears; })
    .slice(0, 6);
  for (const f of recentFacts) {
    out.push({
      id: `fact:${f.id}`, kind: 'fact_number', fact_id: f.id, weight: 60 - out.length,
      title: `Add a number: ${f.action}`,
      goal: `Fact “${f.action}” has no measurable result. Ask a concrete question that gets a number (people, money, %, time, volume) — `
        + 'and the baseline it is compared with.',
    });
  }

  const s = profile.scale ?? {};
  if (s.team_max == null || (s.budget_max == null && !s.pnl)) {
    out.push({
      id: 'scale', kind: 'scale', weight: 55, title: 'Your management scale',
      goal: 'Get the maximum team size (direct + indirect), how many of them were managers, and the largest budget or P&L the user owned, with currency.',
    });
  }
  if (!profile.languages.length) {
    out.push({
      id: 'languages', kind: 'languages', weight: 50, title: 'Languages and levels',
      goal: 'Get each working language with a CEFR level (A1–C2), not “fluent”.',
    });
  }
  if (!profile.work_auth.length) {
    out.push({
      id: 'work_auth', kind: 'work_auth', weight: 48, title: 'Right to work',
      goal: 'Find out where the user can work without sponsorship (citizenship or permit) and where they would need it.',
    });
  }
  for (const g of profile.gaps ?? []) {
    if (!g.reason?.trim()) {
      out.push({
        id: `gap:${g.from}`, kind: 'gap_reason', weight: 45, title: `The gap from ${g.from} to ${g.to}`,
        goal: 'Ask in one neutral sentence what the user did during this gap. A short, plain reason removes the doubt.',
      });
    }
  }
  if (!profile.relocation) {
    out.push({
      id: 'relocation', kind: 'relocation', weight: 30, title: 'Relocation',
      goal: 'Ask whether the user is open to relocation, and whether they would need a relocation package.',
    });
  }
  out.push({
    id: 'master_resume', kind: 'master_resume', weight: 1, title: 'Build your master resume',
    goal: 'All key questions are covered. Offer to build the master resume from the confirmed facts.',
  });

  return out.filter(t => !skipped.has(t.id)).sort((a, b) => b.weight - a.weight);
}

/** Насколько профиль готов: доля закрытых тем повестки (без самой сборки резюме). */
export function coachProgress(profile: Profile, facts: Fact[], opts: AgendaOptions = {}): { open: number; percent: number } {
  const open = coachAgenda(profile, facts, { ...opts, skipped: [] }).filter(t => t.kind !== 'master_resume').length;
  // 12 — типичный размер повестки у нового профиля; дальше прогресс не уходит в минус.
  const total = Math.max(open, 12);
  return { open, percent: Math.round(100 * (1 - open / total)) };
}

export interface CoachMessage { role: 'coach' | 'user'; text: string; at: string; topic_id?: string }

/**
 * Предложение коуча — изменение, которое пользователь применяет одной кнопкой.
 * Число в новом факте должно звучать в словах самого пользователя: иначе это
 * не его факт, а догадка модели.
 */
export interface CoachProposal {
  id: string;
  kind: 'new_fact' | 'update_fact' | 'profile';
  label: string;
  fact?: Partial<Fact>;
  fact_id?: string;
  profile?: Partial<Profile>;
  status: 'open' | 'applied' | 'dismissed';
}
