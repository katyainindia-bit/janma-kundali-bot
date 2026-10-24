// ============================================================
// accounts.js — общий аккаунт: вход по почте (одноразовый код), сессии для
// сайта и приложения, привязка Telegram, слияние аккаунтов.
//
// Внутренний номер аккаунта = users.telegram_id. У Telegram-пользователей это
// их настоящий Telegram ID (положительный), у тех, кто пришёл с сайта по почте, —
// служебный отрицательный номер. Когда человек привязывает Telegram, данные
// переезжают на его настоящий Telegram ID (mergeUsers).
// ============================================================
const crypto = require('crypto');
const db = require('./database.js');
const raw = db.rawDb;
const { sendLoginCode } = require('./mailer.js');

raw.exec(`
  CREATE TABLE IF NOT EXISTS auth_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    UNIQUE(kind, value)
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent INTEGER NOT NULL,
    sent_hour_start INTEGER NOT NULL,
    sent_hour_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tg_logins (
    code TEXT PRIMARY KEY,
    user_id INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SESSION_DAYS = 90;
const CODE_TTL_MS = 10 * 60 * 1000;

function normalizeEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null;
}

// ---------- код на почту ----------
async function requestEmailCode(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { error: 'Проверьте адрес почты' };
  const now = Date.now();
  const row = raw.prepare('SELECT * FROM auth_codes WHERE email = ?').get(email);
  let hourStart = now, hourCount = 0;
  if (row) {
    if (now - row.last_sent < 60 * 1000) return { error: 'Код уже отправлен. Повторить можно через минуту.' };
    if (now - row.sent_hour_start < 3600 * 1000) { hourStart = row.sent_hour_start; hourCount = row.sent_hour_count; }
    if (hourCount >= 5) return { error: 'Слишком много запросов. Попробуйте позже.' };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  raw.prepare(`INSERT INTO auth_codes (email, code_hash, expires_at, attempts, last_sent, sent_hour_start, sent_hour_count)
    VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0,
      last_sent=excluded.last_sent, sent_hour_start=excluded.sent_hour_start, sent_hour_count=excluded.sent_hour_count`)
    .run(email, sha(code + email), now + CODE_TTL_MS, now, hourStart, hourCount + 1);
  try {
    await sendLoginCode(email, code);
  } catch (e) {
    console.error('Ошибка отправки письма:', e.message);
    return { error: 'Не удалось отправить письмо. Попробуйте позже.' };
  }
  return { ok: true, email };
}

function checkEmailCode(emailRaw, codeRaw) {
  const email = normalizeEmail(emailRaw);
  const code = String(codeRaw || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return { error: 'Введите код из 6 цифр' };
  const row = raw.prepare('SELECT * FROM auth_codes WHERE email = ?').get(email);
  if (!row || row.expires_at < Date.now()) return { error: 'Код устарел. Запросите новый.' };
  if (row.attempts >= 5) return { error: 'Слишком много попыток. Запросите новый код.' };
  if (!crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha(code + email)))) {
    raw.prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    return { error: 'Неверный код' };
  }
  raw.prepare('DELETE FROM auth_codes WHERE email = ?').run(email); // код одноразовый
  return { ok: true, email };
}

// ---------- пользователи и способы входа ----------
function identityUser(kind, value) {
  const r = raw.prepare('SELECT user_id FROM auth_identities WHERE kind = ? AND value = ?').get(kind, value);
  return r ? r.user_id : null;
}
function addIdentity(userId, kind, value) {
  raw.prepare('INSERT OR IGNORE INTO auth_identities (user_id, kind, value, verified_at) VALUES (?, ?, ?, ?)')
    .run(userId, kind, value, new Date().toISOString());
}
function listEmails(userId) {
  return raw.prepare("SELECT value FROM auth_identities WHERE user_id = ? AND kind = 'email' ORDER BY id").all(userId).map((r) => r.value);
}
function createWebUser(email) {
  const min = raw.prepare('SELECT MIN(telegram_id) AS m FROM users').get().m;
  const id = Math.min(-1, (min == null ? 0 : min) - 1);
  const now = new Date().toISOString();
  raw.prepare('INSERT INTO users (telegram_id, username, first_name, first_seen, last_seen, email) VALUES (?, NULL, ?, ?, ?, ?)')
    .run(id, email.split('@')[0], now, now, email);
  return id;
}

// ---------- сессии ----------
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  raw.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha(token), userId, now, now, now + SESSION_DAYS * 86400000);
  return token;
}
function userBySession(token) {
  if (!token) return null;
  const r = raw.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!r || r.expires_at < Date.now()) return null;
  raw.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(Date.now(), sha(token));
  const u = raw.prepare('SELECT telegram_id, first_name FROM users WHERE telegram_id = ?').get(r.user_id);
  return u ? { id: u.telegram_id, first_name: u.first_name || '', web: true } : null;
}
function endSession(token) {
  raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

// ---------- слияние ----------
const ISO_MAX = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
function mergeUsers(fromId, toId) {
  if (fromId === toId) return;
  const tx = raw.transaction(() => {
    const f = raw.prepare('SELECT * FROM users WHERE telegram_id = ?').get(fromId);
    const t = raw.prepare('SELECT * FROM users WHERE telegram_id = ?').get(toId);
    if (!f || !t) throw new Error('merge: пользователь не найден');
    raw.prepare('UPDATE charts SET telegram_id = ? WHERE telegram_id = ?').run(toId, fromId);
    raw.prepare('UPDATE search_goals SET telegram_id = ? WHERE telegram_id = ?').run(toId, fromId);
    raw.prepare('UPDATE OR IGNORE notify_sent SET telegram_id = ? WHERE telegram_id = ?').run(toId, fromId);
    raw.prepare('DELETE FROM notify_sent WHERE telegram_id = ?').run(fromId);
    raw.prepare('UPDATE referral_rewards SET referrer_id = ? WHERE referrer_id = ?').run(toId, fromId);
    raw.prepare('UPDATE referral_rewards SET referred_id = ? WHERE referred_id = ?').run(toId, fromId);
    raw.prepare('UPDATE users SET referred_by = ? WHERE referred_by = ?').run(toId, fromId);
    raw.prepare('UPDATE OR IGNORE auth_identities SET user_id = ? WHERE user_id = ?').run(toId, fromId);
    raw.prepare('DELETE FROM auth_identities WHERE user_id = ?').run(fromId);
    raw.prepare('UPDATE sessions SET user_id = ? WHERE user_id = ?').run(toId, fromId);
    raw.prepare('DELETE FROM link_codes WHERE user_id = ?').run(fromId);
    // подписка: берём лучшую из двух
    const fAct = f.tier === 'premium' && (!f.premium_until || f.premium_until > new Date().toISOString());
    const tAct = t.tier === 'premium' && (!t.premium_until || t.premium_until > new Date().toISOString());
    const upd = {};
    if (fAct && (!tAct || (t.premium_until && (!f.premium_until || f.premium_until > t.premium_until)))) {
      upd.tier = 'premium'; upd.premium_until = f.premium_until || null;
    }
    upd.premium_first_at = ISO_MAX(null, f.premium_first_at && t.premium_first_at ? (f.premium_first_at < t.premium_first_at ? f.premium_first_at : t.premium_first_at) : (f.premium_first_at || t.premium_first_at));
    // настройки: у целевого пользователя сохраняются; пустое дополняем
    for (const k of ['place_json', 'notify_prefs_json', 'email', 'phone', 'display_name', 'primary_chart_id']) {
      if (t[k] == null && f[k] != null) upd[k] = f[k];
    }
    if (f.marketing_consent && !t.marketing_consent) upd.marketing_consent = 1;
    const keys = Object.keys(upd).filter((k) => upd[k] !== undefined);
    if (keys.length) raw.prepare(`UPDATE users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE telegram_id = ?`).run(...keys.map((k) => upd[k]), toId);
    raw.prepare('DELETE FROM users WHERE telegram_id = ?').run(fromId);
  });
  tx();
}

// ---------- сценарии ----------
/** Вход с сайта по почте: возвращает { token, userId } */
function loginWithEmail(email) {
  let uid = identityUser('email', email);
  if (uid == null) {
    uid = createWebUser(email);
    addIdentity(uid, 'email', email);
  }
  return { token: createSession(uid), userId: uid };
}

/** Привязка подтверждённой почты к текущему аккаунту. Если почта уже у другого аккаунта — аккаунты сливаются. */
function attachEmail(userId, email) {
  const other = identityUser('email', email);
  if (other == null) {
    addIdentity(userId, 'email', email);
    raw.prepare('UPDATE users SET email = COALESCE(email, ?) WHERE telegram_id = ?').run(email, userId);
    return { userId, merged: false };
  }
  if (other === userId) return { userId, merged: false };
  // оба аккаунта: оставляем тот, что с настоящим Telegram (положительный id)
  if (other > 0 && userId > 0) return { error: 'Эта почта уже привязана к другому аккаунту Telegram. Напишите в поддержку.' };
  const target = userId > 0 ? userId : (other > 0 ? other : userId);
  const source = target === userId ? other : userId;
  mergeUsers(source, target);
  addIdentity(target, 'email', email);
  return { userId: target, merged: true };
}

// ---------- привязка Telegram с сайта ----------
function createLinkCode(userId) {
  raw.prepare('DELETE FROM link_codes WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
  const code = crypto.randomBytes(9).toString('base64url');
  raw.prepare('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, Date.now() + 15 * 60 * 1000);
  return code;
}
/** Вызывается ботом: Telegram-пользователь tgId подтверждает код → данные сайта-аккаунта переезжают на tgId. */
function consumeLinkCode(code, tgId) {
  const r = raw.prepare('SELECT * FROM link_codes WHERE code = ?').get(String(code || ''));
  if (!r || r.expires_at < Date.now()) return { error: 'Ссылка устарела. Создайте новую в приложении.' };
  raw.prepare('DELETE FROM link_codes WHERE code = ?').run(code);
  const webId = r.user_id;
  if (webId === tgId) return { ok: true };
  if (webId > 0) return { error: 'Этот аккаунт уже привязан к Telegram.' };
  const exists = raw.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(tgId);
  if (!exists) return { error: 'Сначала откройте бота командой /start.' };
  mergeUsers(webId, tgId);
  addIdentity(tgId, 'telegram', String(tgId));
  return { ok: true };
}

// ---------- вход на сайт через Telegram ----------
function createTgLogin() {
  raw.prepare('DELETE FROM tg_logins WHERE expires_at < ?').run(Date.now());
  const code = crypto.randomBytes(18).toString('base64url');
  raw.prepare('INSERT INTO tg_logins (code, user_id, expires_at) VALUES (?, NULL, ?)').run(code, Date.now() + 10 * 60 * 1000);
  return code;
}
/** Вызывается ботом: человек нажал Start по ссылке с сайта. */
function approveTgLogin(code, tgId) {
  const r = raw.prepare('SELECT * FROM tg_logins WHERE code = ?').get(String(code || ''));
  if (!r || r.expires_at < Date.now()) return { error: 'Ссылка устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.' };
  const exists = raw.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(tgId);
  if (!exists) return { error: 'Не удалось найти ваш профиль. Нажмите /start и повторите вход с сайта.' };
  raw.prepare('UPDATE tg_logins SET user_id = ? WHERE code = ?').run(tgId, code);
  addIdentity(tgId, 'telegram', String(tgId));
  return { ok: true };
}
/** Сайт спрашивает, нажали ли Start. Одноразово выдаёт сессию. */
function pollTgLogin(code) {
  const r = raw.prepare('SELECT * FROM tg_logins WHERE code = ?').get(String(code || ''));
  if (!r || r.expires_at < Date.now()) return { error: 'Время вышло. Попробуйте ещё раз.' };
  if (r.user_id == null) return { pending: true };
  raw.prepare('DELETE FROM tg_logins WHERE code = ?').run(code);
  return { token: createSession(r.user_id) };
}

function findUserByEmail(email) { const e = normalizeEmail(email); return e ? identityUser('email', e) : null; }

function accountInfo(userId) {
  return { userId, hasTelegram: userId > 0, emails: listEmails(userId) };
}

module.exports = { normalizeEmail, requestEmailCode, checkEmailCode, loginWithEmail, attachEmail, createSession, userBySession, endSession, createLinkCode, consumeLinkCode, createTgLogin, approveTgLogin, pollTgLogin, findUserByEmail, accountInfo, mergeUsers };
