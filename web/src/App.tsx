// Каркас приложения: шапка, навигация и ЕДИНЫЙ статус-бар.
//
// §13.2: у каждого асинхронного действия обязательны четыре состояния — покой,
// ожидание со счётчиком, успех с указанием что получилось, ошибка с указанием
// что делать. Сообщения живут в одном месте; дублировать их внутри панелей
// нельзя. Любое busy снимается по таймауту — интерфейс не остаётся
// заблокированным навсегда (§16).

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Api, Me, Profile, Fact, AuditReport, Opportunity, OpportunityDetail, UsageSummary,
  ImportResult, RunEvent,
} from './api/types.ts';
import { runProgress } from '@huntback/core';
import { httpApi, ApiFailure } from './api/client.ts';
import { mockApi } from './api/mock.ts';
import { StatusBar, type Status } from './components/ui.tsx';
import { Login } from './screens/Login.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { ProfileScreen } from './screens/Profile.tsx';
import { Places } from './screens/Places.tsx';
import { Usage } from './screens/Usage.tsx';

type Tab = 'places' | 'profile' | 'usage';
const BUSY_TIMEOUT_MS = 180_000;

/** Сборка без серверной части: витрина интерфейса на статическом хостинге. */
const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === '1';

export function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('places');
  const [onboarding, setOnboarding] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [list, setList] = useState<Opportunity[]>([]);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const busy = status.kind === 'busy';

  // Счётчик секунд у ожидания и страховочный таймаут (§16).
  useEffect(() => {
    if (status.kind !== 'busy') { setElapsed(0); return; }
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    // Страховка §16: любое busy снимается по таймауту, чтобы кнопки не
    // остались заблокированными навсегда. Прогон поиска идёт дольше и ведёт
    // свою полосу, поэтому его этот таймер не трогает.
    const bail = setTimeout(() => setStatus(cur => (
      cur.kind === 'busy' && !cur.progress
        ? { kind: 'error', text: 'Операция не ответила за три минуты. Кнопки разблокированы — попробуйте ещё раз.' }
        : cur
    )), BUSY_TIMEOUT_MS);
    return () => { clearInterval(tick); clearTimeout(bail); };
  }, [status]);

  /** Каждое асинхронное действие проходит здесь — так все четыре состояния гарантированы. */
  const run = useCallback(async <T,>(text: string, fn: () => Promise<T>, done?: (r: T) => string): Promise<T | null> => {
    setStatus({ kind: 'busy', text });
    try {
      const r = await fn();
      setStatus(done ? { kind: 'ok', text: done(r) } : { kind: 'idle' });
      return r;
    } catch (e) {
      const msg = e instanceof ApiFailure || e instanceof Error ? e.message : 'Не получилось';
      setStatus({ kind: 'error', text: msg });
      return null;
    }
  }, []);

  const refreshList = useCallback(async (a: Api) => setList(await a.listOpportunities()), []);

  const openDemo = useCallback(async () => {
    setApi(() => mockApi);
    const m = await mockApi.me();
    setMe(m);
    const p = await mockApi.getProfile();
    setProfile(p.profile); setFacts(p.facts); setAudit(p.audit);
    setList(await mockApi.listOpportunities());
    setUsage(await mockApi.usage());
    setStatus({ kind: 'info', text: 'Демо-режим: данные вымышленные, но аудит, совпадение, блокеры и проверки считает настоящее ядро.' });
  }, []);

  // Реальный вход: если сессии нет, показываем экран входа.
  // В демо-сборке (GitHub Pages) бэкенда нет вовсе — не спрашиваем.
  useEffect(() => {
    if (DEMO_ONLY) return;
    let alive = true;
    httpApi.me().then(async m => {
      if (!alive) return;
      setApi(() => httpApi);
      setMe(m);
      const p = await httpApi.getProfile();
      setProfile(p.profile); setFacts(p.facts); setAudit(p.audit);
      setOnboarding(!m.profile_filled);
      await refreshList(httpApi);
    }).catch(() => { /* нет сессии — останется экран входа */ });
    return () => { alive = false; };
  }, [refreshList]);

  useEffect(() => {
    if (!api || !selected) { setDetail(null); return; }
    api.getOpportunity(selected).then(setDetail).catch(() => setDetail(null));
  }, [api, selected]);

  useEffect(() => {
    if (api && tab === 'usage') api.usage().then(setUsage).catch(() => {});
  }, [api, tab]);

  if (!api || !me || !profile) return <Login onDemo={openDemo} demoOnly={DEMO_ONLY} />;

  const saveProfile = async (patch: Partial<Profile>) => {
    const r = await api.saveProfile(patch);
    setProfile(r.profile); setAudit(r.audit);
  };

  const patchFact = async (id: string, patch: Partial<Fact>) => {
    setFacts(fs => fs.map(f => (f.id === id ? { ...f, ...patch } : f)));   // оптимистично
    await api.patchFact(id, patch);
    const p = await api.getProfile();
    setFacts(p.facts); setAudit(p.audit);
  };

  const runAudit = async () => {
    const r = await run('Разбираю резюме на факты', () => api.runAudit(),
      x => `Аудит готов: ${x.facts.length} фактов, ${x.audit.tasks.length} правок к профилю`);
    if (r) { setFacts(r.facts); setAudit(r.audit); }
  };

  if (onboarding) {
    return (
      <div className="shell">
        <Header me={me} tab={tab} onTab={setTab} minimal />
        <StatusBar status={status} elapsed={elapsed} onDismiss={() => setStatus({ kind: 'idle' })} />
        <Onboarding
          profile={profile} facts={facts} audit={audit} busy={busy}
          onSave={saveProfile} onAudit={runAudit} onPatchFact={patchFact}
          onDone={async () => { setOnboarding(false); await refreshList(api); }}
        />
      </div>
    );
  }

  /**
   * Поиск по кнопке. Очередей нет: один запрос идёт минуты и присылает события,
   * из которых ядро считает проценты и остаток. Полоса двигается от реальных
   * событий (завершённых направлений), а таймер лишь не даёт ей замереть между
   * ними — поэтому она не обманывает.
   */
  const startRun = async () => {
    const started = Date.now();
    let last: RunEvent = { stage: 'plan' };
    setStatus({
      kind: 'busy', text: 'Формирую поисковые запросы',
      progress: runProgress({ stage: 'plan', elapsedSec: 0 }),
    });

    // Тик нужен только чтобы остаток и ползунок обновлялись между событиями:
    // между двумя направлениями может пройти минута.
    const tick = setInterval(() => {
      if (last.stage === 'done') return;
      setStatus({
        kind: 'busy', text: '',
        progress: runProgress({ ...last, elapsedSec: Math.round((Date.now() - started) / 1000) }),
      });
    }, 1000);

    try {
      await api.runSearch(e => {
        last = e;
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        if (e.stage === 'done') {
          clearInterval(tick);
          if (e.error) { setStatus({ kind: 'error', text: e.error }); return; }
          if (!e.found) {
            setStatus({ kind: 'error', text: 'Не найдено ни одного места. По направлениям:', lines: e.notes });
            return;
          }
          setStatus({
            kind: 'ok',
            text: e.added
              ? `Найдено ${e.found}, добавлено новых ${e.added}`
              : `Найдено ${e.found}, новых среди них нет`,
            // Разбивку показываем, только если что-то потерялось по дороге.
            lines: e.notes?.some(n => !/: найдено \d+$/.test(n)) ? e.notes : undefined,
          });
          void refreshList(api);
          return;
        }
        setStatus({ kind: 'busy', text: '', progress: runProgress({ ...e, elapsedSec }) });
      });
      await refreshList(api);
    } catch (e) {
      const msg = e instanceof ApiFailure || e instanceof Error ? e.message : 'Поиск не удался';
      setStatus({ kind: 'error', text: msg });
    } finally {
      clearInterval(tick);
    }
  };

  return (
    <div className="shell">
      <Header me={me} tab={tab} onTab={setTab} spent={usage?.spent} limit={usage?.limit} />
      <StatusBar status={status} elapsed={elapsed} onDismiss={() => setStatus({ kind: 'idle' })} />
      <main className={`main ${tab === 'profile' ? 'main--narrow' : ''}`}>
        {tab === 'places' && (
          <Places
            list={list} detail={detail} selectedId={selected} busy={busy}
            onSelect={setSelected}
            onRun={startRun}
            onAnalyse={async id => {
              const r = await run('Разбираю ожидания места', () => api.analyse(id),
                x => `Разобрано: ${x.coverage.closed} из ${x.coverage.total} ожиданий закрыто, совпадение ${x.analysis.score}%`);
              if (r) { setDetail(await api.getOpportunity(id)); await refreshList(api); }
            }}
            onResume={async id => {
              const r = await run('Собираю резюме под это место', () => api.makeResume(id),
                x => x.checks.some(c => c.level === 'block')
                  ? 'Резюме собрано, но есть блокирующие замечания — посмотрите список'
                  : 'Резюме собрано');
              if (r) setDetail(await api.getOpportunity(id));
            }}
            onLetter={async id => {
              const r = await run('Пишу письмо и проверяю его на шаблонность', () => api.makeLetter(id),
                x => x.checks.some(c => c.level === 'block')
                  ? 'Письмо написано, но проверки нашли блокирующие замечания'
                  : 'Письмо написано и прошло swap-тест');
              if (r) setDetail(await api.getOpportunity(id));
            }}
            onArchive={async id => {
              await run('Отправляю в архив', () => api.archiveOpportunity(id), () => 'Место в архиве');
              setSelected(null);
              await refreshList(api);
            }}
            onPatch={async (id, patch) => {
              const r = await api.patchOpportunity(id, patch);
              if (r.analysis) setDetail(d => (d ? { ...d, analysis: r.analysis! } : d));
              else setDetail(await api.getOpportunity(id));
              await refreshList(api);
            }}
            onImport={async input => run('Разбираю вакансию', () => api.importJob(input))}
            onConfirmImport={async r => {
              const created = await run('Создаю место', () => api.confirmImport(r),
                x => (x.merged ? 'Существующее место дополнено текстом вакансии' : 'Место создано'));
              if (created) { await refreshList(api); setSelected(created.id); }
            }}
            onGoToProfile={() => setTab('profile')}
          />
        )}
        {tab === 'profile' && (
          <ProfileScreen
            profile={profile} facts={facts} audit={audit} busy={busy}
            onSave={saveProfile} onAudit={runAudit} onPatchFact={patchFact}
          />
        )}
        {tab === 'usage' && <Usage data={usage} />}
      </main>
    </div>
  );
}

function Header({ me, tab, onTab, spent, limit, minimal }: {
  me: Me; tab: Tab; onTab: (t: Tab) => void;
  spent?: number; limit?: number; minimal?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <header className="header" ref={ref}>
      <div className="header-in">
        <span className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-word">Huntback</span>
        </span>
        {!minimal && (
          <nav className="nav" aria-label="Разделы">
            <button className="nav-item" aria-current={tab === 'places' ? 'page' : undefined}
              onClick={() => onTab('places')}>Места</button>
            <button className="nav-item" aria-current={tab === 'profile' ? 'page' : undefined}
              onClick={() => onTab('profile')}>Профиль</button>
            <button className="nav-item" aria-current={tab === 'usage' ? 'page' : undefined}
              onClick={() => onTab('usage')}>Расходы</button>
          </nav>
        )}
        <div className="header-right">
          {spent != null && limit != null && (
            <span className="chip" title="Потрачено за месяц">${spent.toFixed(2)} / ${limit}</span>
          )}
          <span className="chip chip-user">{me.user.name || me.user.email}</span>
        </div>
      </div>
    </header>
  );
}
