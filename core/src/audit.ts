// Аудит профиля (§10.4a). Метрики считает воркер по правилам; модель пишет
// только текстовые рекомендации поверх них. Здесь — правила.
//
// Смысл разделения: «60% фактов с числом» — это арифметика, и спрашивать её у
// модели значит получать разные ответы на одних данных. А «добавьте число к
// достижению X» — это текст, и его пишет модель.

import type { Fact, Profile, RoleDates } from './types.ts';
import type { Thresholds } from './config.ts';
import { DEFAULT_THRESHOLDS } from './config.ts';
import { averageTenureMonths, workAuthFor } from './blockers.ts';

export type AuditStatus = 'ok' | 'warn' | 'missing';

export interface AuditMetric {
  id: string;
  label: string;
  status: AuditStatus;
  /** 0..1 — для компактного индикатора на экране профиля (§13.1). */
  value?: number | null;
  /** Что писать крупно. Для доли — проценты, для срока — месяцы, иначе «есть». */
  display?: string;
  detail: string;
  /** Поле, в которое ведёт кнопка «заполнить». */
  field?: keyof Profile;
}

export interface AuditTask {
  id: string;
  /** Порядок по убыванию эффекта (§10.4a). */
  weight: number;
  text: string;
  field?: keyof Profile;
  fact_id?: string;
}

export interface AuditReport {
  metrics: AuditMetric[];
  tasks: AuditTask[];
  /** Доля пройденных проверок — жёлтый индикатор заполненности на экране профиля. */
  completeness: number;
  generated_at: string;
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to);
  if (isNaN(+a) || isNaN(+b)) return 0;
  return Math.max(0, Math.round((+b - +a) / (1000 * 60 * 60 * 24 * 30.44)));
}

function isRecent(role: RoleDates, years: number, now: Date): boolean {
  const end = role.to ? new Date(role.to) : now;
  if (isNaN(+end)) return true;
  return (now.getFullYear() - end.getFullYear()) <= years;
}

const SENIOR = /(head|director|vp|chief|cto|coo|cfo|ceo|lead|руководител|директор|начальник)/i;

/** Метрики чек-листа §10.4a. Модель сюда не заглядывает. */
export function auditProfile(
  profile: Profile,
  facts: Fact[],
  th: Thresholds = DEFAULT_THRESHOLDS,
  now = new Date(),
): AuditReport {
  const metrics: AuditMetric[] = [];
  const tasks: AuditTask[] = [];
  const confirmed = (facts || []).filter(f => f.confirmed);
  const roles = profile.roles || [];

  // 1. Квантификация ---------------------------------------------------------
  const quantified = confirmed.filter(f => f.quantified);
  const share = confirmed.length ? quantified.length / confirmed.length : 0;
  metrics.push({
    id: 'quantification', label: 'Quantified facts',
    status: !confirmed.length ? 'missing' : share >= th.quantifiedShare ? 'ok' : 'warn',
    value: share,
    display: confirmed.length ? `${Math.round(share * 100)}%` : '—',
    detail: confirmed.length
      ? `${quantified.length} of ${confirmed.length} confirmed facts contain a number`
      : 'The fact bank is empty — run the audit',
  });
  for (const f of confirmed.filter(f => !f.quantified).slice(0, 5)) {
    tasks.push({
      id: `quantify:${f.id}`, weight: 100,
      text: `Add a number to the achievement “${f.action}”${f.company ? ` (${f.company})` : ''}`,
      fact_id: f.id,
    });
  }

  // 2. Квантификация по ролям последних N лет --------------------------------
  const recent = roles.filter(r => isRecent(r, th.recentRoleYears, now));
  for (const r of recent) {
    const n = confirmed.filter(f => f.role_title === r.role_title && f.quantified).length;
    if (n < th.quantifiedPerRole) {
      tasks.push({
        id: `quantify-role:${r.role_title}`, weight: 90,
        text: `The “${r.role_title}” role has ${n} quantified achievements — it needs at least ${th.quantifiedPerRole}`,
      });
    }
  }

  // 3. Масштаб ---------------------------------------------------------------
  const s = profile.scale;
  const scaleFilled = !!s && s.team_max != null
    && (s.budget_max != null || s.pnl === true || !!s.geo_scope);
  metrics.push({
    id: 'scale', label: 'Management scale',
    status: scaleFilled ? 'ok' : s ? 'warn' : 'missing',
    detail: scaleFilled
      ? `Team up to ${s!.team_max}${s!.budget_max ? `, budget up to ${s!.budget_max}` : ''}`
      : 'Missing team size and at least one of: budget, P&L, geography',
    field: 'scale',
  });
  if (!scaleFilled) {
    tasks.push({ id: 'scale', weight: 95, text: 'Add team size and budget or P&L — at middle+ level their absence reads as an individual contributor', field: 'scale' });
  }
  for (const r of recent.filter(r => SENIOR.test(r.role_title || ''))) {
    const withScale = confirmed.some(f => f.role_title === r.role_title
      && (f.scale_tags || []).some(t => t === 'team' || t === 'managers'));
    if (!withScale) {
      tasks.push({
        id: `people:${r.role_title}`, weight: 92,
        text: `The “${r.role_title}” role has no facts about managing people — a red flag for a senior role`,
      });
    }
  }

  // 4. Прогрессия ------------------------------------------------------------
  // Порядок массива ролей — какой пришёл от экстрактора; резюме перечисляет их
  // в ОБРАТНОЙ хронологии, поэтому сравнивать соседей «как лежат» нельзя.
  // Сортируем по дате начала и ищем пару «раньше не senior → позже senior».
  const byDate = [...roles].sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const progression = byDate.length >= 2 && byDate.some((later, j) =>
    SENIOR.test(later.role_title || '')
    && byDate.slice(0, j).some(earlier => !SENIOR.test(earlier.role_title || '')));
  metrics.push({
    id: 'progression', label: 'Progression',
    status: roles.length < 2 ? 'missing' : progression ? 'ok' : 'warn',
    detail: roles.length < 2 ? 'Fewer than two roles in the profile' : progression ? 'Seniority growth is visible across roles' : 'No promotion or growth in scope is visible between roles',
  });
  if (roles.length >= 2 && !progression) {
    tasks.push({ id: 'progression', weight: 80, text: 'Show a promotion or growth in scope between roles — screeners read the dates for progression' });
  }

  // 5. Перерывы --------------------------------------------------------------
  const gaps = profile.gaps || [];
  const longGaps = gaps.filter(g => monthsBetween(g.from, g.to) > th.gapNeedsReasonMonths);
  const unexplained = longGaps.filter(g => !String(g.reason || '').trim());
  metrics.push({
    id: 'gaps', label: 'Career gaps',
    status: !longGaps.length ? 'ok' : unexplained.length ? 'warn' : 'ok',
    detail: !longGaps.length ? 'No gaps longer than six months' : `${longGaps.length - unexplained.length} of ${longGaps.length} gaps explained`,
    field: 'gaps',
  });
  for (const g of unexplained) {
    tasks.push({ id: `gap:${g.from}`, weight: 85, text: `Explain the gap ${g.from} — ${g.to}: stating the reason noticeably improves response rates`, field: 'gaps' });
  }

  // 6. Частота переходов -----------------------------------------------------
  const tenure = averageTenureMonths(profile, now);
  metrics.push({
    id: 'tenure', label: 'Average tenure',
    status: tenure == null ? 'missing' : tenure >= th.avgTenureMonths ? 'ok' : 'warn',
    value: tenure == null ? null : Math.min(1, tenure / (th.avgTenureMonths * 2)),
    display: tenure == null ? '—' : `${tenure} mo`,
    detail: tenure == null ? 'Not enough role dates' : `Expected: ${th.avgTenureMonths}+ months`,
  });
  if (tenure != null && tenure < th.avgTenureMonths) {
    tasks.push({ id: 'tenure', weight: 60, text: 'Group project roles under one heading and explain the logic of your moves' });
  }

  // 7. Языки -----------------------------------------------------------------
  const langs = profile.languages || [];
  metrics.push({
    id: 'languages', label: 'Languages (CEFR)',
    status: langs.length ? 'ok' : 'missing',
    detail: langs.length ? langs.map(l => `${l.lang} ${l.cefr}`).join(', ') : 'Not filled in',
    field: 'languages',
  });
  if (!langs.length) tasks.push({ id: 'languages', weight: 88, text: 'Add languages with a CEFR level — “fluent” cannot be compared with a job requirement', field: 'languages' });

  // 8. Право на работу -------------------------------------------------------
  const regions = String(profile.geo || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  // workAuthFor знает, что «EU» покрывает страну ЕС. Раньше здесь стояло строгое
  // сравнение названий, и аудит требовал заполнить Германию, тогда как правило
  // блокеров считало её закрытой — один вопрос с двумя ответами.
  const covered = regions.filter(r => workAuthFor(profile, r) !== null);
  const authOk = !regions.length ? (profile.work_auth || []).length > 0 : covered.length === regions.length;
  metrics.push({
    id: 'work_auth', label: 'Work authorization',
    status: authOk ? 'ok' : (profile.work_auth || []).length ? 'warn' : 'missing',
    detail: authOk ? 'Filled in for all search regions' : regions.length ? `Missing: ${regions.filter(r => !covered.includes(r)).join(', ')}` : 'Not filled in',
    field: 'work_auth',
  });
  if (!authOk) tasks.push({ id: 'work_auth', weight: 98, text: 'Fill in work authorization by region — it is the main doubt in an international application, and one line removes it', field: 'work_auth' });

  // 9. Возраст ролей ---------------------------------------------------------
  const old = roles.filter(r => !isRecent(r, th.condenseRoleYears, now));
  if (old.length > 1) {
    tasks.push({ id: 'old_roles', weight: 40, text: `Condense ${old.length} roles older than ${th.condenseRoleYears} years into one line — every line has to earn its place` });
  }

  // 10. LinkedIn -------------------------------------------------------------
  metrics.push({
    id: 'linkedin', label: 'LinkedIn',
    status: profile.linkedin_url ? (profile.linkedin_complete ? 'ok' : 'warn') : 'missing',
    detail: profile.linkedin_url ? (profile.linkedin_complete ? 'Profile marked as complete' : 'Link added, completeness checklist not passed') : 'No link',
    field: 'linkedin_url',
  });
  if (!profile.linkedin_url) {
    tasks.push({ id: 'linkedin', weight: 70, text: 'Add your LinkedIn link: most recruiters cross-check it against the application', field: 'linkedin_url' });
  } else if (!profile.linkedin_complete) {
    tasks.push({ id: 'linkedin_complete', weight: 50, text: 'Complete the LinkedIn checklist: summary > 1000 characters, all roles described, photo, ≥ 300 connections, 3–7 recommendations', field: 'linkedin_complete' });
  }

  const passed = metrics.filter(m => m.status === 'ok').length;
  return {
    metrics,
    tasks: tasks.sort((a, b) => b.weight - a.weight),
    completeness: metrics.length ? passed / metrics.length : 0,
    generated_at: now.toISOString(),
  };
}

/**
 * Факты без числа, к которым число вероятно существует — это ВОПРОСЫ
 * пользователю, а не догадки модели (§10.4a). Ядро только отбирает кандидатов.
 */
export function factsNeedingNumbers(facts: Fact[]): Fact[] {
  return (facts || []).filter(f => f.confirmed && !f.quantified);
}
