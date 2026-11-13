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
  ImportResult, RunEvent, SearchMode, ResetScope, CoachView, MasterResume, DocEvent, OpenQuestion,
} from './api/types.ts';
import { runProgress, hasUnresolvedBlocker, workAuthFor } from '@huntback/core';
import { httpApi, ApiFailure } from './api/client.ts';
import { mockApi } from './api/mock.ts';
import { StatusBar, type Status } from './components/ui.tsx';
import { Login } from './screens/Login.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { ProfileScreen } from './screens/Profile.tsx';
import { Places } from './screens/Places.tsx';
import { Usage } from './screens/Usage.tsx';
import { CoachScreen } from './screens/Coach.tsx';
import type { FixAction } from './screens/Places.tsx';

type Tab = 'places' | 'profile' | 'coach' | 'usage';
/** Сколько мест готовится одновременно при пакетной подготовке документов. */
const PREPARE_CONCURRENCY = 2;
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
  const [coach, setCoach] = useState<CoachView | null>(null);
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [master, setMaster] = useState<MasterResume | null>(null);
  /** Открыть экран профиля сразу в режиме разбора фактов. */
  const [reviewFacts, setReviewFacts] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>(readSearchMode);
  // Меняется при сбросе: экран профиля пересоздаётся и не держит старый черновик.
  const [profileEpoch, setProfileEpoch] = useState(0);

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

  // Список мест и открытые вопросы меняются вместе: разбор, правка, подготовка.
  const refreshList = useCallback(async (a: Api) => {
    setList(await a.listOpportunities());
    a.questions().then(r => setQuestions(r.questions)).catch(() => {});
  }, []);

  const openDemo = useCallback(async () => {
    setApi(() => mockApi);
    const m = await mockApi.me();
    setMe(m);
    const p = await mockApi.getProfile();
    setProfile(p.profile); setFacts(p.facts); setAudit(p.audit); setMaster(p.master_resume ?? null);
    setList(await mockApi.listOpportunities());
    setQuestions((await mockApi.questions()).questions);
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
      setProfile(p.profile); setFacts(p.facts); setAudit(p.audit); setMaster(p.master_resume ?? null);
      setOnboarding(!m.profile_filled);
      await refreshList(httpApi);
    }).catch(() => { /* нет сессии — останется экран входа */ });
    return () => { alive = false; };
  }, [refreshList]);

  useEffect(() => {
    if (!api || !selected) { setDetail(null); return; }
    api.getOpportunity(selected).then(setDetail).catch(() => setDetail(null));
  }, [api, selected]);

  // Режим «разбор фактов» — одноразовый вход из коуча, не постоянное состояние.
  useEffect(() => { if (tab !== 'profile') setReviewFacts(false); }, [tab]);

  useEffect(() => {
    if (api && tab === 'usage') api.usage().then(setUsage).catch(() => {});
    if (api && tab === 'coach') api.coach().then(setCoach).catch(() => {});
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

  /** Ответ на наводящий вопрос факта. true — факт обновлён, можно к следующему. */
  const answerFact = async (id: string, answer: string): Promise<boolean> => {
    const r = await run('Rewriting the fact with your answer', () => api.answerFact(id, answer),
      () => 'Fact updated and confirmed');
    if (!r) return false;
    setFacts(fs => fs.map(f => (f.id === id ? r.fact : f)));
    const p = await api.getProfile();
    setAudit(p.audit);
    return true;
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
    setList([]); setDetail(null); setSelected(null); setUsage(null); setCoach(null); setMaster(null);
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

  const RESET_DONE: Record<ResetScope, string> = {
    all: 'Everything cleared — let’s set up your profile again',
    search: 'Search results and history cleared',
    profile: 'Profile and fact bank cleared — let’s set them up again',
    budget: 'Budget reset: this month’s spending starts from $0',
  };

  const resetData = async (scope: ResetScope) => {
    const r = await run('Clearing data', () => api.resetData(scope), () => RESET_DONE[scope]);
    if (r === null) return;
    const p = await api.getProfile();
    setProfile(p.profile); setFacts(p.facts); setAudit(p.audit); setMaster(p.master_resume ?? null);
    setCoach(null);
    setSelected(null); setDetail(null);
    await refreshList(api);
    setUsage(await api.usage());
    setProfileEpoch(e => e + 1);
    if (scope === 'all' || scope === 'profile') { setTab('places'); setOnboarding(true); }
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
          onSave={saveProfile} onAudit={runAudit} onPatchFact={patchFact} onAnswerFact={answerFact}
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

  /** Строка статуса для генерации документа: что делает писатель или проверяющий. */
  const docProgress = (what: string) => (e: DocEvent) => {
    if (e.message) setStatus({ kind: 'busy', text: `${what}: ${e.message}` });
  };

  const makeResume = async (id: string) => {
    const r = await run('Building a resume for this place', () => api.makeResume(id, docProgress('Resume')),
      x => x.checks.some(c => c.level === 'block')
        ? 'Resume built and reviewed, but there are blocking remarks — see the list'
        : `Resume built and reviewed twice${x.review?.rewrites ? ` (rewritten ${x.review.rewrites}×)` : ''}`);
    if (r) { setDetail(await api.getOpportunity(id)); await refreshList(api); }
  };

  const makeLetter = async (id: string) => {
    const r = await run('Writing the letter', () => api.makeLetter(id, undefined, docProgress('Letter')),
      x => x.checks.some(c => c.level === 'block')
        ? 'Letter written and reviewed, but the checks found blocking remarks'
        : `Letter written, reviewed twice${x.review?.rewrites ? ` (rewritten ${x.review.rewrites}×)` : ''} and passed the swap test`);
    if (r) { setDetail(await api.getOpportunity(id)); await refreshList(api); }
  };

  const fix = async (id: string, f: FixAction) => {
    const label = f.action === 'answer' ? 'Checking your answer against the expectation' : 'Updating the match';
    const r = await run(label, () => api.fixExpectation(id, f),
      x => x.note ? `${x.note} · match ${x.analysis.score}%` : `Match ${x.analysis.score}%`);
    if (r) {
      setDetail(d => (d && d.opportunity.id === id ? { ...d, analysis: r.analysis, coverage: r.coverage, potential: r.potential } : d));
      await refreshList(api);
      // Ответ и «переиспользовать» меняют банк фактов — показываем его свежим.
      if (f.action === 'answer' || f.action === 'reuse' || f.scope === 'reuse') { const p = await api.getProfile(); setFacts(p.facts); }
    }
  };

  /**
   * Пакетная подготовка документов — главный сценарий «на все вакансии сразу».
   * Для каждого места: текст вакансии (если есть ссылка) → разбор → принятие
   * формулировок → резюме → письмо. Место с неснятым жёстким блокером
   * пропускается: документы его не закроют, а бюджет потратят.
   */
  const prepare = async (ids: string[]) => {
    // Предполётная проверка: место в стране без заполненного права на работу
    // гарантированно уйдёт в «неизвестный» блокер. Дешевле спросить сейчас.
    const countries = [...new Set(list.filter(o => ids.includes(o.id) && o.country).map(o => o.country!))]
      .filter(c => workAuthFor(profile, c) === null);
    if (countries.length && confirm(`Your right to work in ${countries.join(', ')} isn’t filled in. Places there will be skipped as “unknown”.\n\nOK — fill it in now (one field); Cancel — continue anyway.`)) {
      setTab('profile');
      setStatus({ kind: 'info', text: `Add “${countries.join(', ')}” under Work authorization (scroll to “What removes doubts”), then press Prepare documents again.` });
      return;
    }
    const total = ids.length;
    let done = 0;
    let ready = 0;
    const waiting: Record<string, number> = {};
    const lines: string[] = [];
    const now: Record<string, string> = {};
    let stopped = false;
    const show = () => setStatus({
      kind: 'busy',
      text: `Preparing documents: ${done} of ${total} done${Object.values(now).length ? ' · ' + Object.values(now).join(' · ') : ''}`,
    });
    show();
    const queue = [...ids];
    const one = async (id: string) => {
      let d = await api.getOpportunity(id);
      const name = `${d.opportunity.company} · ${d.opportunity.role_title}`;
      const step = (t: string) => { now[id] = `${d.opportunity.company}: ${t}`; show(); };
      if (!d.opportunity.jd_text && d.opportunity.source_url) {
        step('fetching the posting');
        try { await api.fetchJobText(id); } catch { /* текст не скачался — разбор по реконструкции */ }
      }
      if (!d.analysis) { step('analysing the match'); await api.analyse(id); }
      d = await api.getOpportunity(id);
      const before = d.analysis?.score ?? 0;
      if (d.analysis && hasUnresolvedBlocker(d.analysis.blockers)) {
        const open = d.analysis.blockers.filter(b => !b.resolved);
        // «Не заполнено в профиле» и «действительно не подходит» — разные вещи,
        // и пользователю нужно разное: поле в профиле или решение отказаться.
        const fillable = open.filter(b => /\.unknown$/.test((b as { rule?: string }).rule ?? ''));
        for (const b of fillable) waiting[b.kind] = (waiting[b.kind] ?? 0) + 1;
        lines.push(fillable.length === open.length
          ? `${name}: waiting for your profile — ${fillable.map(b => b.detail).join('; ')}`
          : `${name}: skipped — hard blocker: ${open.filter(b => !fillable.includes(b)).map(b => b.detail).join('; ')} (open the place to decide)`);
        return;
      }
      let after = before;
      let questions = d.potential?.questions ?? 0;
      if (d.potential?.wordingFixes) {
        step('applying wording fixes');
        const r = await api.fixExpectation(id, { action: 'apply_all' });
        after = r.analysis.score; questions = r.potential.questions;
      }
      step('resume');
      const rs = await api.makeResume(id, e => e.message && step(`resume — ${e.message.toLowerCase()}`));
      step('letter');
      const lt = await api.makeLetter(id, undefined, e => e.message && step(`letter — ${e.message.toLowerCase()}`));
      ready++;
      // «✓» только за документ без блокирующих замечаний — иначе честное «проверьте».
      const mark = (c: { level: string }[]) => (c.some(x => x.level === 'block') ? '⚠ check remarks' : '✓');
      lines.push(`${name}: match ${before}%${after !== before ? ` → ${after}%` : ''}, resume ${mark(rs.checks)} letter ${mark(lt.checks)}`
        + (questions ? ` · ${questions} question${questions === 1 ? '' : 's'} could raise it further` : ''));
    };
    const worker = async () => {
      for (let id = queue.shift(); id && !stopped; id = queue.shift()) {
        try { await one(id); } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          lines.push(`${list.find(o => o.id === id)?.company ?? id}: failed — ${msg}`);
          if (e instanceof ApiFailure && e.code === 'budget_exceeded') stopped = true;
        }
        delete now[id];
        done++;
        show();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREPARE_CONCURRENCY, total) }, worker));
    await refreshList(api);
    if (selected) setDetail(await api.getOpportunity(selected));
    const failed = lines.filter(l => /failed —/.test(l)).length;
    const FIELD: Record<string, string> = { work_auth: 'work authorization', language: 'languages', scale: 'team size', no_people_mgmt: 'team size', license: 'licenses', salary: 'salary range' };
    const hint = Object.keys(waiting).length
      ? ` Fill in ${Object.keys(waiting).map(k => FIELD[k] ?? k).join(' and ')} in your profile and press Prepare again — it unblocks ${Object.values(waiting).reduce((a, b) => Math.max(a, b), 0)} more.`
      : '';
    setStatus({
      kind: failed || !ready ? 'error' : 'ok',
      text: `Documents ready for ${ready} of ${total} place${total === 1 ? '' : 's'}${stopped ? ' — stopped: budget' : ''}.${hint}`
        + (ready ? ' Open each to copy or print.' : ''),
      lines,
    });
  };

  const coachDo = async (label: string, fn: () => Promise<CoachView>, done?: string) => {
    const r = await run(label, fn, done ? () => done : undefined);
    if (!r) return;
    setCoach(r);
    if (r.profile) setProfile(r.profile);
    if (r.facts) setFacts(r.facts);
  };

  const buildMaster = async () => {
    const r = await run('Building your master resume', () => api.buildMasterResume(docProgress('Master resume')),
      x => `Master resume built and reviewed twice${x.review?.rewrites ? ` (rewritten ${x.review.rewrites}×)` : ''}`);
    if (r) setMaster(r);
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
            profile={profile}
            questions={questions}
            onResume={makeResume}
            onLetter={makeLetter}
            onFix={fix}
            onPrepare={prepare}
            onImportBatch={async text => {
              const r = await run('Recognising the postings', () => api.importBatch(text), x => {
                const ok = x.results.filter(y => y.ok).length;
                return `${ok} of ${x.results.length} posting${x.results.length === 1 ? '' : 's'} added`;
              });
              if (r) await refreshList(api);
              return r;
            }}
            onSaveLetter={async (docId, oppId, patch) => {
              const r = await run('Saving and re-checking the letter', () => api.saveDocument(docId, patch),
                x => (x.checks.some(c => c.level === 'block') ? 'Saved — the checks found blocking remarks' : 'Saved and re-checked'));
              if (r) setDetail(await api.getOpportunity(oppId));
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
          <ProfileScreen key={profileEpoch + (reviewFacts ? '-r' : '')}
            profile={profile} facts={facts} audit={audit} busy={busy}
            onSave={saveProfile} onAudit={runAudit} onPatchFact={patchFact} onDeleteFact={deleteFact}
            onAnswerFact={answerFact} startInReview={reviewFacts}
            onOpenCoach={() => setTab('coach')}
            onReset={resetData}
          />
        )}
        {tab === 'coach' && (
          <CoachScreen view={coach} busy={busy} master={master}
            onStart={() => coachDo('The coach is reading your profile', () => api.coachMessage(''))}
            onSend={(text, topic) => coachDo(text ? 'The coach is thinking' : 'Moving to the next question', () => api.coachMessage(text, topic))}
            onSkip={topic => coachDo('Skipping', () => api.coachSkip(topic))}
            onProposal={(id, action) => coachDo(action === 'apply' ? 'Applying' : 'Dismissing', () => api.coachProposal(id, action),
              action === 'apply' ? 'Applied to your profile' : undefined)}
            onReviewFacts={() => { setReviewFacts(true); setTab('profile'); }}
            onBuildMaster={buildMaster}
            onRestart={() => coachDo('Starting over', () => api.coachReset())}
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
            <button className="nav-item" aria-current={tab === 'coach' ? 'page' : undefined}
              onClick={() => onTab('coach')}>Coach</button>
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
