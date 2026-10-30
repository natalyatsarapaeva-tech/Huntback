// Экран входа (§13.1.1): одна кнопка и честное объяснение, какие доступы
// запрашиваются и зачем. Ничего больше здесь быть не должно.

/**
 * `demoOnly` — сборка без бэкенда (GitHub Pages). Вход через Google там
 * физически не может сработать: воркера, который обменивает код на токены,
 * рядом нет. Показывать кнопку, ведущую в 404, хуже, чем сказать правду.
 */
export function Login({ onDemo, demoOnly = false }: { onDemo: () => void; demoOnly?: boolean }) {
  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 18, fontSize: 22 }}>
          <span className="brand-mark" style={{ width: 26, height: 26 }} />
          Huntback
        </div>
        <h1>Places to work, not just vacancies</h1>
        <p className="login-lede">
          Finds companies where a role is taking shape, matches their expectations against
          the facts of your experience and shows the gaps honestly.
        </p>

        {demoOnly ? (
          <>
            <div className="scopes">
              <div className="scope"><span aria-hidden>·</span><span>
                This is an <b>interface showcase</b>: there is no backend here, so Google
                sign-in does not work and there is no button for it.
              </span></div>
              <div className="scope"><span aria-hidden>·</span><span>
                The data is fictional. But the profile audit, the match score, hard
                blockers and document checks are computed by the <b>real core</b> — the same
                one the app runs.
              </span></div>
            </div>

            <button className="btn btn-primary btn-block" onClick={onDemo}>
              Open the demo
            </button>
            <p className="small muted mt-12">
              Source code and specification —{' '}
              <a href="https://github.com/natalyatsarapaeva-tech/huntback">GitHub</a>.
            </p>
          </>
        ) : (
          <>
            <div className="scopes">
              <div className="scope"><span aria-hidden>·</span><span><b>Your Google profile</b> — to recognise you next time you sign in.</span></div>
              <div className="scope"><span aria-hidden>·</span><span><b>One spreadsheet in your Drive</b> — the app creates it and can see only that file. It gets no access to your other files.</span></div>
              <div className="scope"><span aria-hidden>·</span><span><b>Email is not connected.</b> You send letters yourself from your own mailbox.</span></div>
            </div>

            <a className="btn btn-primary btn-block" href="/api/auth/start">Sign in with Google</a>

            <button className="btn btn-ghost btn-block mt-12" onClick={onDemo}>
              Try it with demo data
            </button>
            <p className="small muted mt-12">
              Your resume is personal data. It is stored in the EU, sent to the model without
              history retention and deleted together with your account.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
