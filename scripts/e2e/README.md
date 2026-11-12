# Сквозная проверка без ключей

Настоящий воркер (`wrangler dev`, локальные D1 и KV) против заглушки OpenAI.
Заглушка строит ответы из промпта, поэтому проверки воркера — цитаты из
резюме, числа против фактов, цикл ревью — работают по-настоящему. В неё
специально заложены ошибки, которые обязаны быть пойманы: выдуманная цитата,
выдуманное число в формулировке, ИИ-измы и повтор в первом черновике, штамп
в начале письма, страница поиска LinkedIn вместо вакансии.

```bash
npm run build
npm run migrate:local -w worker
npm run e2e:stub &
cd worker && npx wrangler dev --port 8787 --ip 127.0.0.1 \
  --var OPENAI_BASE_URL:http://127.0.0.1:8799/v1 --var OPENAI_API_KEY:dummy \
  --var APP_ORIGIN:http://localhost:8787 &
```

Тестовый пользователь и сессия (один раз):

```bash
cd worker
npx wrangler d1 execute huntback --local --command "INSERT OR REPLACE INTO users (id, google_sub, email, name, created_at, last_seen_at) VALUES ('u-test','sub-test','tester@example.com','Test Persona','2026-01-01','2026-01-01'); INSERT OR REPLACE INTO profiles (user_id, updated_at) VALUES ('u-test','2026-01-01');"
npx wrangler kv key put "session:sid-test" '{"user_id":"u-test","created_at":"2026-01-01","last_seen":"2026-01-01"}' --binding KV --local
npx wrangler kv key put "csrf:sid-test" "csrf-test" --binding KV --local
```

```bash
npm run e2e:smoke                    # API: 29 проверок
npm run e2e:journey -- ./shots       # браузер: пустой аккаунт → документы, клики и время
```

Оба сценария начинают со сброса данных тестового пользователя.
После пересборки `web/dist` перезапустите `wrangler dev`: он берёт статику при старте.
