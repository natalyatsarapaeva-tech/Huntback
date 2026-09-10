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
        <h1>Места работы, а не только вакансии</h1>
        <p className="login-lede">
          Находит компании, где роль назревает, сопоставляет их ожидания с фактами
          вашего опыта и честно показывает разрывы.
        </p>

        {demoOnly ? (
          <>
            <div className="scopes">
              <div className="scope"><span aria-hidden>·</span><span>
                Это <b>витрина интерфейса</b>: серверной части рядом нет, поэтому вход
                через Google здесь не работает и кнопки для него нет.
              </span></div>
              <div className="scope"><span aria-hidden>·</span><span>
                Данные вымышленные. Но аудит профиля, совпадение с местом, жёсткие
                блокеры и проверки документов считает <b>настоящее ядро</b> — то же,
                что работает в приложении.
              </span></div>
            </div>

            <button className="btn btn-primary btn-block" onClick={onDemo}>
              Открыть демо
            </button>
            <p className="small muted mt-12">
              Исходный код и техническое задание —{' '}
              <a href="https://github.com/natalyatsarapaeva-tech/huntback">GitHub</a>.
            </p>
          </>
        ) : (
          <>
            <div className="scopes">
              <div className="scope"><span aria-hidden>·</span><span><b>Ваш профиль Google</b> — чтобы узнать вас при следующем входе.</span></div>
              <div className="scope"><span aria-hidden>·</span><span><b>Одна таблица на вашем диске</b> — приложение создаёт её само и видит только её. Доступа к остальным файлам оно не получает.</span></div>
              <div className="scope"><span aria-hidden>·</span><span><b>Почта не подключается.</b> Письма вы отправляете сами из своего ящика.</span></div>
            </div>

            <a className="btn btn-primary btn-block" href="/api/auth/start">Войти через Google</a>

            <button className="btn btn-ghost btn-block mt-12" onClick={onDemo}>
              Посмотреть на демо-данных
            </button>
            <p className="small muted mt-12">
              Резюме — персональные данные. Они хранятся в ЕС, передаются модели без
              сохранения истории и удаляются вместе с аккаунтом.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
