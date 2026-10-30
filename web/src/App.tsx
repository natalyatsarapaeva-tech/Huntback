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
  ImportResult, RunEvent, SearchMode,
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
/** Сколько разборов идёт одновременно при массовой проверке совпадения. */
const BULK_CONCURRENCY = 3;

/** Сборка без серверной части: витрина интерфейса на статическом хостинге. */
const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === '1';

/** Выбор «что искать» — удобство одного браузера, поэтому localStorage. */
const SEARCH_MODE_KEY = 'huntback.searchMode';
function readSearchMode(): SearchMode {
  try { return localStorage.getItem(SEARCH_MODE_KEY) === 'vacancies' ? 'vacancies' : 'all'; } catch { return 'all'; }
}

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
  const [searchMode, setSearchMode] = useState<SearchMode>(readSearchMode);

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
        ? { kind: 'error', text: 'The operation didn’t respond within three minutes. The buttons are unlocked — try again.' }
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
      const msg = e instanceof ApiFailure || e instanceof Error ? e.message : 'That didn’t work';
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
    setStatus({ kind: 'info', text: 'Demo mode: the data is fictional, but the audit, match score, blockers and checks are computed by the real core.' });
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

  const deleteFact = async (id: string) => {
    const r = await run('Deleting the fact', () => api.deleteFact(id), () => 'Fact deleted');
    if (r === null) return;
    const p = await api.getProfile();
    setFacts(p.facts); setAudit(p.audit);
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* сессия и так могла истечь — выходим в любом случае */ }
    setApi(null); setMe(null); setProfile(null); setFacts([]); setAudit(null);
    setList([]); setDetail(null); setSelected(null); setUsage(null);
    setTab('places'); setOnboarding(false); setStatus({ kind: 'idle' });
  };

  /**
   * Массовая проверка совпадения: разбор каждого места пулом по несколько
   * штук. Неудача одного места не останавливает остальные; исчерпанный бюджет
   * останавливает всё — дальше каждый вызов упадёт так же.
   */
  const bulkAnalyse = async (ids: string[]) => {
    const total = ids.length;
    let done = 0, failed = 0, stopped = false, lastError = '';
    const show = () => setStatus({ kind: 'busy', text: `Checking match: ${done} of ${total}${failed ? ` · ${failed} failed` : ''}` });
    show();
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id && !stopped; id = queue.shift()) {
        try {
          await api.analyse(id);
        } catch (e) {
          failed++;
          lastError = e instanceof Error ? e.message : String(e);
          if (e instanceof ApiFailure && e.code === 'budget_exceeded') stopped = true;
        }
        done++;
        show();
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, worker));
    await refreshList(api);
    if (selected && ids.includes(selected)) setDetail(await api.getOpportunity(selected));
    const ok = done - failed;
    setStatus(failed
      ? { kind: 'error', text: `Match checked for ${ok} of ${total}. ${failed} failed${stopped ? ', stopped' : ''}: ${lastError}` }
      : { kind: 'ok', text: `Match checked for ${ok} place${ok === 1 ? '' : 's'} — sorted by match` });
  };

  const changeSearchMode = (m: SearchMode) => {
    setSearchMode(m);
    try { localStorage.setItem(SEARCH_MODE_KEY, m); } catch { /* приватный режим — просто не запомним */ }
  };

  const runAudit = async () => {
    const r = await run('Breaking the resume down into facts', () => api.runAudit(),
      x => `Audit ready: ${x.facts.length} facts, ${x.audit.tasks.length} profile fixes`);
    if (r) { setFacts(r.facts); setAudit(r.audit); }
  };

  if (onboarding) {
    return (
      <div className="shell">
        <Header me={me} tab={tab} onTab={setTab} onLogout={logout} minimal />
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
      kind: 'busy', text: 'Building search queries',
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
      await api.runSearch(searchMode, e => {
        last = e;
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        if (e.stage === 'done') {
          clearInterval(tick);
          if (e.error) { setStatus({ kind: 'error', text: e.error }); return; }
          if (!e.found) {
            setStatus({ kind: 'error', text: 'No places found. By search direction:', lines: e.notes });
            return;
          }
          setStatus({
            kind: 'ok',
            text: e.added
              ? `Found ${e.found}, ${e.added} new added`
              : `Found ${e.found}, none of them new`,
            // Разбивка по проходам с запросами и источниками — пока поиск
            // настраивается, она нужна после каждого прогона.
            lines: e.notes,
          });
          void refreshList(api);
          return;
        }
        setStatus({ kind: 'busy', text: '', progress: runProgress({ ...e, elapsedSec }) });
      });
      await refreshList(api);
    } catch (e) {
      const msg = e instanceof ApiFailure || e instanceof Error ? e.message : 'The search failed';
      setStatus({ kind: 'error', text: msg });
    } finally {
      clearInterval(tick);
    }
  };

  return (
    <div className="shell">
      <Header me={me} tab={tab} onTab={setTab} onLogout={logout} spent={usage?.spent} limit={usage?.limit} />
      <StatusBar status={status} elapsed={elapsed} onDismiss={() => setStatus({ kind: 'idle' })} />
      <main className={`main ${tab === 'profile' ? 'main--narrow' : ''}`}>
        {tab === 'places' && (
          <Places
            list={list} detail={detail} selectedId={selected} busy={busy}
            searchMode={searchMode} onSearchMode={changeSearchMode}
            onSelect={setSelected}
            onRun={startRun}
            onBulkAnalyse={bulkAnalyse}
            onAnalyse={async id => {
              const r = await run('Analysing the place’s expectations', () => api.analyse(id),
                x => `Analysed: ${x.coverage.closed} of ${x.coverage.total} expectations covered, match ${x.analysis.score}%`);
              if (r) { setDetail(await api.getOpportunity(id)); await refreshList(api); }
            }}
            onResume={async id => {
              const r = await run('Building a resume for this place', () => api.makeResume(id),
                x => x.checks.some(c => c.level === 'block')
                  ? 'Resume built, but there are blocking remarks — see the list'
                  : 'Resume built');
              if (r) setDetail(await api.getOpportunity(id));
            }}
            onLetter={async id => {
              const r = await run('Writing the letter and checking it for templates', () => api.makeLetter(id),
                x => x.checks.some(c => c.level === 'block')
                  ? 'Letter written, but the checks found blocking remarks'
                  : 'Letter written and passed the swap test');
              if (r) setDetail(await api.getOpportunity(id));
            }}
            onArchive={async id => {
              await run('Archiving', () => api.archiveOpportunity(id), () => 'Place archived');
              setSelected(null);
              await refreshList(api);
            }}
            onPatch={async (id, patch) => {
              const r = await api.patchOpportunity(id, patch);
              if (r.analysis) setDetail(d => (d ? { ...d, analysis: r.analysis!, opportunity: { ...d.opportunity, ...patch } } : d));
              else setDetail(await api.getOpportunity(id));
              await refreshList(api);
            }}
            onFetchJobText={async id => {
              const r = await run('Downloading the job posting text', () => api.fetchJobText(id),
                x => `Job posting text saved (${x.jd_text.length.toLocaleString('en')} characters)`);
              if (r) { setDetail(await api.getOpportunity(id)); }
            }}
            onImport={async input => run('Parsing the vacancy', () => api.importJob(input))}
            onConfirmImport={async r => {
              const created = await run('Creating the place', () => api.confirmImport(r),
                x => (x.merged ? 'Job posting text added to the existing place' : 'Place created'));
              if (created) { await refreshList(api); setSelected(created.id); }
            }}
            onGoToProfile={() => setTab('profile')}
          />
        )}
        {tab === 'profile' && (
          <ProfileScreen
            profile={profile} facts={facts} audit={audit} busy={busy}
            onSave={saveProfile} onAudit={runAudit} onPatchFact={patchFact} onDeleteFact={deleteFact}
          />
        )}
        {tab === 'usage' && <Usage data={usage} />}
      </main>
    </div>
  );
}

function Header({ me, tab, onTab, onLogout, spent, limit, minimal }: {
  me: Me; tab: Tab; onTab: (t: Tab) => void; onLogout: () => void;
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
          <nav className="nav" aria-label="Sections">
            <button className="nav-item" aria-current={tab === 'places' ? 'page' : undefined}
              onClick={() => onTab('places')}>Places</button>
            <button className="nav-item" aria-current={tab === 'profile' ? 'page' : undefined}
              onClick={() => onTab('profile')}>Profile</button>
            <button className="nav-item" aria-current={tab === 'usage' ? 'page' : undefined}
              onClick={() => onTab('usage')}>Spending</button>
          </nav>
        )}
        <div className="header-right">
          {spent != null && limit != null && (
            <span className="chip" title="Spent this month">${spent.toFixed(2)} / ${limit}</span>
          )}
          <span className="chip chip-user">{me.user.name || me.user.email}</span>
        </div>
        <button className="btn btn-ghost btn-sm header-logout" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}
