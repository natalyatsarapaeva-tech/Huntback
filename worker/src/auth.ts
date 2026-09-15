// Google OAuth 2.0 (Authorization Code + PKCE) и сессии (§5).
// Обмен кода на токены делает ВОРКЕР: client_secret в браузер не попадает.

import { type Env, ApiError, json, nowIso, uid } from './env.ts';

const SESSION_TTL = 60 * 60 * 24 * 30;      // 30 дней (§5.3)
const PKCE_TTL = 60 * 10;                    // 10 минут (§5.1)
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

export interface Session { user_id: string; created_at: string; last_seen: string }

// ── PKCE ────────────────────────────────────────────────────────────────────
const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

/**
 * Конфигурация Google из секретов воркера — с проверкой ДО редиректа.
 *
 * Без неё незаданный секрет превращался в строку «undefined», уезжал в Google
 * как client_id, и пользователь получал `401: invalid_client` — ошибку, из
 * которой невозможно понять, что именно не настроено. Приложение обязано
 * говорить это само, а не перекладывать на чужой экран.
 */
interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string }

class SetupError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'SetupError';
    this.hint = hint;
  }
}

function googleConfig(env: Env): GoogleConfig {
  // Пробел или перевод строки на конце — самая частая порча секрета при
  // копировании, и Google на неё отвечает тем же invalid_client.
  const clientId = String(env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET ?? '').trim();

  const missing = [
    !clientId && 'GOOGLE_CLIENT_ID',
    !clientSecret && 'GOOGLE_CLIENT_SECRET',
  ].filter(Boolean) as string[];
  if (missing.length) {
    throw new SetupError(
      `Не заданы секреты воркера: ${missing.join(', ')}.`,
      'Панель Cloudflare → Compute (Workers) → huntback → Settings → '
      + 'Variables and Secrets → Add, тип Secret. Инструкция — SETUP.md, шаг 8.',
    );
  }
  // Идентификатор клиента Google всегда оканчивается так. Проверка ловит
  // самую обидную ошибку: Client ID и Client secret перепутаны местами.
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new SetupError(
      'GOOGLE_CLIENT_ID не похож на идентификатор клиента Google.',
      'Он должен оканчиваться на .apps.googleusercontent.com. Проверьте, не '
      + 'перепутаны ли Client ID и Client secret, и что клиент создан с типом '
      + '«Web application», а не «Desktop app».',
    );
  }
  // TOKEN_ENC_KEY проверяем ЗДЕСЬ, хотя нужен он только в конце: им шифруется
  // токен Google при записи в базу. Без проверки вход падал бы уже ПОСЛЕ того,
  // как человек дал согласие в Google, — то есть в самом неудобном месте и без
  // объяснения. Лучше отказаться на входе и сказать причину.
  const encKeyRaw = String(env.TOKEN_ENC_KEY ?? '').trim();
  if (!encKeyRaw) {
    throw new SetupError(
      'Не задан секрет воркера TOKEN_ENC_KEY.',
      'Им шифруется токен доступа к вашему Google-диску перед записью в базу. '
      + 'Нужны 32 случайных байта в base64 — как получить, написано в SETUP.md, шаг 8.',
    );
  }
  let encKeyBytes = 0;
  try { encKeyBytes = atob(encKeyRaw).length; } catch { encKeyBytes = -1; }
  if (encKeyBytes !== 32) {
    throw new SetupError(
      'TOKEN_ENC_KEY задан, но это не 32 байта в base64.',
      encKeyBytes === -1
        ? 'Значение не похоже на base64. Сгенерируйте заново — SETUP.md, шаг 8.'
        : `Получилось ${encKeyBytes} байт вместо 32. Сгенерируйте заново — SETUP.md, шаг 8.`,
    );
  }

  return { clientId, clientSecret, redirectUri: `${env.APP_ORIGIN}/api/auth/callback` };
}

/**
 * Страница про незавершённую настройку. Единственное место, где воркер отвечает
 * HTML, а не JSON (§8): на /api/auth/start браузер приходит по ссылке, и
 * человеку тут нужен текст, а не тело ответа для кода.
 */
function setupPage(e: SetupError): Response {
  const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Huntback — настройка не завершена</title>`
    + `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#27333c}`
    + `h1{font-size:1.3rem;margin:0 0 .75rem}code{background:#f0f2f4;padding:.1em .35em;border-radius:4px}`
    + `p{margin:0 0 1rem}.hint{color:#64798b;font-size:.94rem}</style>`
    + `<h1>Вход ещё не настроен</h1><p>${esc(e.message)}</p><p class="hint">${esc(e.hint)}</p>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function authStart(env: Env, url: URL): Promise<Response> {
  let cfg: GoogleConfig;
  try {
    cfg = googleConfig(env);
  } catch (e) {
    if (e instanceof SetupError) return setupPage(e);
    throw e;
  }

  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = b64url(await sha256(verifier));
  await env.KV.put(`pkce:${state}`, verifier, { expirationTtl: PKCE_TTL });

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', cfg.clientId);
  auth.searchParams.set('redirect_uri', cfg.redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', SCOPES.join(' '));
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent');
  return Response.redirect(auth.toString(), 302);
}

/** Отказы, с которыми Google возвращает пользователя на наш callback. */
const OAUTH_REFUSALS: Record<string, { message: string; hint: string }> = {
  access_denied: {
    message: 'Google не пустил в приложение.',
    hint: 'Либо вы отменили вход, либо этот аккаунт не в списке тестировщиков: '
      + 'console.cloud.google.com → Google Auth Platform → Audience → Test users. '
      + 'Адрес должен совпадать с тем, которым вы входите.',
  },
  admin_policy_enforced: {
    message: 'Политика вашей организации Google запрещает вход в это приложение.',
    hint: 'Войдите личным аккаунтом Google либо попросите администратора разрешить приложение.',
  },
  org_internal: {
    message: 'Приложение настроено только для пользователей одной организации.',
    hint: 'В Google Auth Platform → Audience поменяйте тип на External.',
  },
};

export async function authCallback(env: Env, url: URL): Promise<Response> {
  // Отказ приходит параметром error, а не отсутствием code. Без этой ветки
  // отмена входа выглядела как «Google вернул неполный ответ» — сообщение,
  // которое отправляет искать поломку там, где её нет.
  const refusal = url.searchParams.get('error');
  if (refusal) {
    const known = OAUTH_REFUSALS[refusal];
    return setupPage(new SetupError(
      known?.message ?? `Google отказал во входе: ${refusal}.`,
      known?.hint ?? 'Попробуйте войти заново. Если повторяется — пришлите код ошибки.',
    ));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new ApiError('auth_bad_request', 'Google вернул неполный ответ', 400);

  const verifier = await env.KV.get(`pkce:${state}`);
  if (!verifier) throw new ApiError('auth_state_expired', 'Вход занял слишком много времени. Начните заново.', 400);
  await env.KV.delete(`pkce:${state}`);

  const cfg = googleConfig(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new ApiError('auth_exchange_failed', 'Не удалось завершить вход через Google', 502);
  const tok = await res.json() as { access_token: string; refresh_token?: string; expires_in: number; id_token: string };

  const claims = decodeIdToken(tok.id_token);
  if (!claims?.sub || !claims.email) throw new ApiError('auth_no_identity', 'Google не вернул идентификатор', 502);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(claims.sub).first<{ id: string }>();
  const userId = existing?.id ?? uid();
  if (existing) {
    await env.DB.prepare('UPDATE users SET email=?, name=?, last_seen_at=?, google_reauth_required=0 WHERE id=?')
      .bind(claims.email, claims.name ?? null, nowIso(), userId).run();
  } else {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, google_sub, email, name, created_at, last_seen_at) VALUES (?,?,?,?,?,?)')
        .bind(userId, claims.sub, claims.email, claims.name ?? null, nowIso(), nowIso()),
      env.DB.prepare('INSERT INTO profiles (user_id, updated_at) VALUES (?,?)').bind(userId, nowIso()),
    ]);
  }

  if (tok.refresh_token) {
    const enc = await encryptToken(env, tok.refresh_token);
    await env.DB.prepare('UPDATE users SET refresh_token_enc=? WHERE id=?').bind(enc, userId).run();
  }
  // Access-токен не хранится в БД — только в KV с TTL минус минута (§5.4).
  await env.KV.put(`gtoken:${userId}`, tok.access_token, { expirationTtl: Math.max(60, tok.expires_in - 60) });

  const sid = randomToken(32);
  const session: Session = { user_id: userId, created_at: nowIso(), last_seen: nowIso() };
  await env.KV.put(`session:${sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  const csrf = randomToken(16);

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', cookie('sid', sid, { httpOnly: true, maxAge: SESSION_TTL }));
  headers.append('Set-Cookie', cookie('csrf', csrf, { httpOnly: false, maxAge: SESSION_TTL }));
  await env.KV.put(`csrf:${sid}`, csrf, { expirationTtl: SESSION_TTL });
  return new Response(null, { status: 302, headers });
}

function cookie(name: string, value: string, o: { httpOnly: boolean; maxAge: number }): string {
  return [
    `${name}=${value}`, 'Path=/', 'Secure', 'SameSite=Lax',
    `Max-Age=${o.maxAge}`, o.httpOnly ? 'HttpOnly' : '',
  ].filter(Boolean).join('; ');
}

function decodeIdToken(idToken: string): { sub: string; email: string; name?: string } | null {
  try {
    const payload = idToken.split('.')[1];
    const s = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(s)));
  } catch { return null; }
}

// ── Шифрование refresh-токена (§5.4) ────────────────────────────────────────
async function encKey(env: Env): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.TOKEN_ENC_KEY), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(env: Env, plain: string): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encKey(env);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
  return out.buffer;
}

export async function decryptToken(env: Env, blob: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(blob);
  const key = await encKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
  return new TextDecoder().decode(pt);
}

// ── Сессия каждого запроса ──────────────────────────────────────────────────
export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

/**
 * Возвращает user_id или бросает 401. Единственный источник user_id во всём
 * воркере: параметр из клиента не принимается никогда (§15.1).
 */
export async function requireSession(env: Env, request: Request): Promise<string> {
  const sid = readCookie(request, 'sid');
  if (!sid) throw new ApiError('unauthorized', 'Нужно войти', 401);
  const raw = await env.KV.get(`session:${sid}`);
  if (!raw) throw new ApiError('unauthorized', 'Сессия истекла — войдите заново', 401);
  const s = JSON.parse(raw) as Session;

  // CSRF double-submit на мутирующих запросах (§5.3).
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const header = request.headers.get('X-Huntback-CSRF');
    const expected = await env.KV.get(`csrf:${sid}`);
    if (!header || !expected || header !== expected) {
      throw new ApiError('csrf', 'Не удалось подтвердить запрос. Обновите страницу.', 403);
    }
  }

  // Продление при активности — не чаще раза в час, чтобы не писать в KV на каждый запрос.
  if (Date.now() - Date.parse(s.last_seen) > 3600_000) {
    s.last_seen = nowIso();
    await env.KV.put(`session:${sid}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
  }
  return s.user_id;
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const sid = readCookie(request, 'sid');
  if (sid) await Promise.all([env.KV.delete(`session:${sid}`), env.KV.delete(`csrf:${sid}`)]);
  const headers = new Headers();
  headers.append('Set-Cookie', 'sid=; Path=/; Max-Age=0; Secure; SameSite=Lax; HttpOnly');
  headers.append('Set-Cookie', 'csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax');
  return json({ ok: true }, 200, Object.fromEntries(headers));
}

/** Действующий access-токен Google; при `invalid_grant` помечает пользователя (§5.4). */
export async function googleAccessToken(env: Env, userId: string): Promise<string> {
  const cached = await env.KV.get(`gtoken:${userId}`);
  if (cached) return cached;

  const row = await env.DB.prepare('SELECT refresh_token_enc FROM users WHERE id=?')
    .bind(userId).first<{ refresh_token_enc: ArrayBuffer | null }>();
  if (!row?.refresh_token_enc) throw new ApiError('google_reauth_required', 'Нужно заново разрешить доступ к Google', 401);

  const refresh = await decryptToken(env, row.refresh_token_enc);
  const cfgRefresh = googleConfig(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfgRefresh.clientId, client_secret: cfgRefresh.clientSecret,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  });
  const tok = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    if (tok.error === 'invalid_grant') {
      await env.DB.prepare('UPDATE users SET google_reauth_required=1 WHERE id=?').bind(userId).run();
    }
    throw new ApiError('google_reauth_required', 'Доступ к Google отозван — войдите заново', 401);
  }
  await env.KV.put(`gtoken:${userId}`, tok.access_token, { expirationTtl: Math.max(60, (tok.expires_in ?? 3600) - 60) });
  return tok.access_token;
}
