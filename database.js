// ============================================================
// database.js — постоянное хранилище (SQLite) для пользователей
// и архива сохранённых карт. Файл базы лежит на Railway Volume
// (путь задаётся переменной окружения DB_PATH), чтобы не стираться
// при пересборке бота.
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

// В проде (Railway) сюда должен указывать путь на смонтированный Volume,
// например /data/janma-kundali.db — задаётся переменной окружения DB_PATH.
// Локально (без переменной) база просто лежит рядом с кодом — для тестов.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'janma-kundali.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    premium_until TEXT,
    notify_enabled INTEGER NOT NULL DEFAULT 0,
    primary_chart_id INTEGER,
    notify_state TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'true',
    zodiac_type TEXT NOT NULL DEFAULT 'sidereal',
    ayanamsha_variant TEXT NOT NULL DEFAULT 'lahiri',
    custom_ayanamsha_base REAL,
    observation_mode TEXT NOT NULL DEFAULT 'geocentric',
    notify_rituals_enabled INTEGER NOT NULL DEFAULT 0,
    referred_by INTEGER,
    referral_reward_granted INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    chart_style TEXT NOT NULL DEFAULT 'north'
  );

  CREATE TABLE IF NOT EXISTS charts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    utc_offset REAL NOT NULL,
    place_label TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    folder TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS chart_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    period_start TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chart_id) REFERENCES charts(id)
  );

  CREATE TABLE IF NOT EXISTS search_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    direction TEXT,
    range_days INTEGER,
    place_json TEXT,
    chart_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referral_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    reward_type TEXT NOT NULL,
    premium_days INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// На случай, если база уже существовала до добавления избранного (миграция «на лету»)
try {
  db.exec('ALTER TABLE charts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // столбец уже есть — игнорируем
}

// То же самое для папок (миграция «на лету» для уже существующих баз)
try {
  db.exec('ALTER TABLE charts ADD COLUMN folder TEXT');
} catch (e) {
  // столбец уже есть — игнорируем
}

// Тариф пользователя (миграция «на лету» для уже существующих баз)
try {
  db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'");
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN premium_until TEXT');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN notify_enabled INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN primary_chart_id INTEGER');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN notify_state TEXT');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec("ALTER TABLE users ADD COLUMN node_type TEXT NOT NULL DEFAULT 'true'");
} catch (e) {
  // столбец уже есть — игнорируем
}
// Разовая правка: поле node_type только что появилось, и дефолтом был 'mean' —
// то есть никто ещё не выбирал 'mean' осознанно, это было просто значение по
// умолчанию. Меняем реальный дефолт методики на Истинный узел и для тех, у
// кого уже сохранилось 'mean' от старого дефолта, — задним числом.
try {
  db.exec("UPDATE users SET node_type = 'true' WHERE node_type = 'mean'");
} catch (e) {
  // таблица могла быть только что создана без этого столбца в этот самый момент — игнорируем
}
try {
  db.exec("ALTER TABLE users ADD COLUMN zodiac_type TEXT NOT NULL DEFAULT 'sidereal'");
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec("ALTER TABLE users ADD COLUMN ayanamsha_variant TEXT NOT NULL DEFAULT 'lahiri'");
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN custom_ayanamsha_base REAL');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec("ALTER TABLE users ADD COLUMN observation_mode TEXT NOT NULL DEFAULT 'geocentric'");
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN notify_rituals_enabled INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN referred_by INTEGER');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN referral_reward_granted INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec("ALTER TABLE users ADD COLUMN chart_style TEXT NOT NULL DEFAULT 'north'");
} catch (e) {
  // столбец уже есть — игнорируем
}
try {
  db.exec('ALTER TABLE chart_notes ADD COLUMN period_start TEXT');
} catch (e) {
  // столбец уже есть — игнорируем
}

// --- Пользователи ---
function upsertUser(ctx) {
  const from = ctx.from;
  if (!from) return;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_seen = excluded.last_seen
  `).run(from.id, from.username || null, from.first_name || null, now, now);
}

// --- Статистика использования: сколько раз в день человек пользовался каждой функцией ---
db.exec(`CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, endpoint)
)`);
function logUsage(userId, endpoint) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO usage_daily (day, user_id, endpoint, hits) VALUES (?, ?, ?, 1)
      ON CONFLICT(day, user_id, endpoint) DO UPDATE SET hits = hits + 1`).run(day, userId || 0, endpoint);
  } catch (e) { /* статистика не должна ломать работу */ }
}
function usageStats(days) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const byFeature = db.prepare(`SELECT endpoint, SUM(hits) AS hits, COUNT(DISTINCT user_id) AS users FROM usage_daily
    WHERE day >= ? GROUP BY endpoint ORDER BY hits DESC`).all(since);
  const activeUsers = db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM usage_daily WHERE day >= ? AND user_id != 0').get(since).c;
  const newUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE substr(first_seen,1,10) >= ?').get(since).c;
  return { byFeature, activeUsers, newUsers };
}
function exportUsersCsv() {
  const rows = db.prepare(`
    SELECT u.telegram_id, u.username, u.first_name, u.email, u.phone, u.tier, u.premium_until, u.premium_first_at,
      u.marketing_consent, u.first_seen, u.last_seen, u.place_json,
      (SELECT COUNT(*) FROM charts c WHERE c.telegram_id = u.telegram_id) AS charts
    FROM users u ORDER BY u.first_seen`).all();
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['id', 'ник', 'имя', 'почта', 'телефон', 'тариф', 'Premium до', 'был Premium с', 'согласие на рассылку', 'пришёл', 'последний визит', 'город', 'карт'];
  const lines = [head.join(';')];
  for (const r of rows) {
    let city = ''; try { city = r.place_json ? (JSON.parse(r.place_json).name || '') : ''; } catch (e) {}
    lines.push([r.telegram_id, r.username ? '@' + r.username : '', r.first_name, r.email, r.phone, r.tier, r.premium_until, r.premium_first_at,
      r.marketing_consent ? 'да' : 'нет', r.first_seen, r.last_seen, city, r.charts].map(esc).join(';'));
  }
  return '\ufeff' + lines.join('\n');
}

// --- Метки и сегменты для рассылок ---
try { db.exec('ALTER TABLE users ADD COLUMN premium_first_at TEXT'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* уже есть */ }
// те, кто уже был Premium до появления метки, получают её по дате первого появления
db.exec("UPDATE users SET premium_first_at = first_seen WHERE tier = 'premium' AND premium_first_at IS NULL");

function markPremiumFirst(telegramId) {
  db.prepare('UPDATE users SET premium_first_at = ? WHERE telegram_id = ? AND premium_first_at IS NULL')
    .run(new Date().toISOString(), telegramId);
}

/**
 * Сегменты: all — все; premium — Premium сейчас; free — Premium не было никогда;
 * expired — был Premium, сейчас нет; city:<часть названия> — по сохранённому месту.
 */
function segmentUserIds(seg) {
  const rows = db.prepare('SELECT telegram_id, tier, premium_until, premium_first_at, place_json FROM users WHERE telegram_id > 0').all(); // только настоящие Telegram-аккаунты
  const active = (r) => r.tier === 'premium' && (!r.premium_until || new Date(r.premium_until).getTime() > Date.now());
  let f;
  if (seg === 'all') f = () => true;
  else if (seg === 'premium') f = active;
  else if (seg === 'free') f = (r) => !active(r) && !r.premium_first_at;
  else if (seg === 'expired') f = (r) => !active(r) && !!r.premium_first_at;
  else if (seg.startsWith('city:')) {
    const q = seg.slice(5).trim().toLowerCase();
    f = (r) => { try { return !!r.place_json && String(JSON.parse(r.place_json).name || '').toLowerCase().includes(q); } catch (e) { return false; } };
  } else return null;
  return rows.filter(f).map((r) => r.telegram_id);
}

// Список людей для администратора: кто, когда пришёл, сколько карт, откуда (реферал)
function listUsersForAdmin(limit = 40) {
  return db.prepare(`
    SELECT u.telegram_id, u.username, u.first_name, u.tier, u.first_seen, u.last_seen, u.referred_by,
      (SELECT COUNT(*) FROM charts c WHERE c.telegram_id = u.telegram_id) AS charts
    FROM users u ORDER BY u.first_seen DESC LIMIT ?`).all(limit);
}

// Полное удаление пользователя и всех его данных
function deleteUserData(userId) {
  const tx = db.transaction(() => {
    const charts = db.prepare('SELECT id FROM charts WHERE telegram_id = ?').all(userId);
    for (const c of charts) db.prepare('DELETE FROM chart_notes WHERE chart_id = ?').run(c.id);
    db.prepare('DELETE FROM charts WHERE telegram_id = ?').run(userId);
    db.prepare('DELETE FROM search_goals WHERE telegram_id = ?').run(userId);
    db.prepare('DELETE FROM notify_sent WHERE telegram_id = ?').run(userId);
    db.prepare('DELETE FROM referral_rewards WHERE referrer_id = ? OR referred_id = ?').run(userId, userId);
    db.prepare('UPDATE users SET referred_by = NULL WHERE referred_by = ?').run(userId);
    for (const t of ['auth_identities', 'sessions', 'link_codes']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId); } catch (e) { /* таблицы может не быть */ }
    }
    db.prepare('DELETE FROM usage_daily WHERE user_id = ?').run(userId);
    return db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId).changes > 0;
  });
  return tx();
}

// Кандидаты на очистку: без карт, без Premium, без привязанной почты
function emptyUserCandidates() {
  return db.prepare(`
    SELECT u.telegram_id, u.username, u.first_name, u.first_seen FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM charts c WHERE c.telegram_id = u.telegram_id)
      AND u.premium_first_at IS NULL AND (u.email IS NULL OR u.email = '')
    ORDER BY u.first_seen`).all();
}

function dbInfo() {
  let size = 0; try { size = require('fs').statSync(DB_PATH).size; } catch (e) { /* нет */ }
  return { path: DB_PATH, sizeKB: Math.round(size / 1024), customPath: !!process.env.DB_PATH };
}

function getAllUserIds() {
  return db.prepare('SELECT telegram_id FROM users WHERE telegram_id > 0').all().map(r => r.telegram_id);
}

function getUserCount() {
  return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
}

// --- Тариф ---
function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

// Возвращает true, если у пользователя сейчас активен Premium
// (учитывает срок действия — просроченная подписка снова считается free).
function isPremium(telegramId) {
  const row = getUser(telegramId);
  if (!row) return false;
  if (row.tier !== 'premium') return false;
  if (!row.premium_until) return true; // бессрочный Premium (например, выдан вручную без срока)
  return new Date(row.premium_until).getTime() > Date.now();
}

// untilISO = null => бессрочно; иначе ISO-дата окончания
function setTier(telegramId, tier, untilISO) {
  const info = db.prepare('UPDATE users SET tier = ?, premium_until = ? WHERE telegram_id = ?')
    .run(tier, untilISO || null, telegramId);
  if (info.changes > 0 && tier === 'premium') { enablePersonalOnPremium(telegramId); markPremiumFirst(telegramId); }
  return info.changes > 0; // false = пользователь с таким telegram_id ещё не встречался боту
}

// --- Реферальная система ---
// Записывается один раз, при первом /start с параметром — если у человека
// уже стоит referred_by (или он сам уже был известен боту раньше), второй
// раз не перезаписывается (защита от "прикрепления" задним числом).
function setReferredBy(telegramId, referrerId) {
  const info = db.prepare('UPDATE users SET referred_by = ? WHERE telegram_id = ? AND referred_by IS NULL')
    .run(referrerId, telegramId);
  return info.changes > 0;
}
function markReferralRewardGranted(telegramId) {
  db.prepare('UPDATE users SET referral_reward_granted = 1 WHERE telegram_id = ?').run(telegramId);
}
// Продлевает Premium на N дней от текущей даты ИЛИ от текущего окончания
// подписки, если оно ещё не наступило (не даёт "сгореть" уже оплаченным
// дням при начислении бонуса поверх активной подписки).
function grantPremiumDays(telegramId, days) {
  const row = db.prepare('SELECT premium_until FROM users WHERE telegram_id = ?').get(telegramId);
  if (!row) return false;
  const now = new Date();
  const base = row.premium_until && new Date(row.premium_until) > now ? new Date(row.premium_until) : now;
  base.setDate(base.getDate() + days);
  db.prepare('UPDATE users SET tier = ?, premium_until = ? WHERE telegram_id = ?').run('premium', base.toISOString(), telegramId);
  enablePersonalOnPremium(telegramId);
  markPremiumFirst(telegramId);
  return true;
}
function logReferralReward(referrerId, referredId, rewardType, premiumDays) {
  db.prepare('INSERT INTO referral_rewards (referrer_id, referred_id, reward_type, premium_days, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(referrerId, referredId, rewardType, premiumDays, new Date().toISOString());
}
function getReferralStats(telegramId) {
  const referredCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE referred_by = ?').get(telegramId).c;
  const rewards = db.prepare('SELECT reward_type, COUNT(*) AS c, SUM(premium_days) AS days FROM referral_rewards WHERE referrer_id = ? GROUP BY reward_type').all(telegramId);
  const conversions = rewards.find(r => r.reward_type === 'conversion');
  return {
    referredCount,
    conversionCount: conversions ? conversions.c : 0,
    totalPremiumDaysEarned: rewards.reduce((sum, r) => sum + (r.days || 0), 0),
  };
}
function getAllReferralStatsForAdmin(limit = 20) {
  return db.prepare(`
    SELECT u.telegram_id, u.username, u.first_name,
      (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.telegram_id) AS referred_count,
      (SELECT COUNT(*) FROM referral_rewards rr WHERE rr.referrer_id = u.telegram_id AND rr.reward_type = 'conversion') AS conversions
    FROM users u
    WHERE (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.telegram_id) > 0
    ORDER BY referred_count DESC
    LIMIT ?
  `).all(limit);
}

// --- Уведомления ---
function setNotifyEnabled(telegramId, enabled) {
  return db.prepare('UPDATE users SET notify_enabled = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, telegramId);
}

// Ритуальные напоминания (Экадаши/Пурнима/Амавасья/праздники) — отдельная,
// независимая от личных уведомлений подписка. Одинаковы для всех, поэтому
// не требуют ни Premium, ни сохранённой карты рождения — в отличие от
// listNotifiableUsers() выше.
function setRitualNotifyEnabled(telegramId, enabled) {
  return db.prepare('UPDATE users SET notify_rituals_enabled = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, telegramId);
}
function setDisplayName(telegramId, name) {
  return db.prepare('UPDATE users SET display_name = ? WHERE telegram_id = ?').run(name, telegramId);
}
function listRitualNotifiableUsers() {
  return db.prepare('SELECT telegram_id FROM users WHERE notify_rituals_enabled = 1 AND telegram_id > 0').all();
}

// --- Астрологические настройки (узел/зодиак/стиль карты) ---
function setAstroSettings(telegramId, { nodeType, zodiacType, chartStyle, ayanamshaVariant, customAyanamshaBase, observationMode }) {
  const row = getUser(telegramId);
  if (!row) return false;
  const info = db.prepare('UPDATE users SET node_type = ?, zodiac_type = ?, chart_style = ?, ayanamsha_variant = ?, custom_ayanamsha_base = ?, observation_mode = ? WHERE telegram_id = ?')
    .run(
      nodeType || row.node_type,
      zodiacType || row.zodiac_type,
      chartStyle || row.chart_style,
      ayanamshaVariant || row.ayanamsha_variant,
      customAyanamshaBase != null ? customAyanamshaBase : row.custom_ayanamsha_base,
      observationMode || row.observation_mode,
      telegramId
    );
  return info.changes > 0;
}

function setPrimaryChart(telegramId, chartId) {
  return db.prepare('UPDATE users SET primary_chart_id = ? WHERE telegram_id = ?').run(chartId, telegramId);
}

// Возвращает список пользователей, которым в принципе можно слать уведомления:
// активный Premium + включён тумблер + есть выбранная (или единственная) карта.
function listNotifiableUsers() {
  const rows = db.prepare(`
    SELECT u.telegram_id, u.primary_chart_id, u.notify_state
    FROM users u
    WHERE u.notify_enabled = 1 AND u.telegram_id > 0
  `).all();
  const result = [];
  for (const row of rows) {
    if (!isPremium(row.telegram_id)) continue;
    let chartId = row.primary_chart_id;
    if (!chartId) {
      // если явно не выбрана — берём карту, если она у пользователя ровно одна
      const charts = listCharts(row.telegram_id);
      if (charts.length === 1) chartId = charts[0].id;
    }
    if (!chartId) continue;
    const chart = getChart(row.telegram_id, chartId);
    if (!chart) continue;
    result.push({
      telegramId: row.telegram_id,
      chart,
      notifyState: row.notify_state ? JSON.parse(row.notify_state) : {},
    });
  }
  return result;
}

function saveNotifyState(telegramId, state) {
  return db.prepare('UPDATE users SET notify_state = ? WHERE telegram_id = ?').run(JSON.stringify(state), telegramId);
}

// --- Архив карт ---
function saveChart(telegramId, label, params, placeLabel, folder) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO charts (telegram_id, label, day, month, year, hour, minute, lat, lon, utc_offset, place_label, folder, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegramId, label, params.day, params.month, params.year, params.hour, params.minute,
    params.lat, params.lon, params.utcOffset, placeLabel || null, folder || null, now
  );
  return info.lastInsertRowid;
}

function listCharts(telegramId) {
  return db.prepare(
    'SELECT * FROM charts WHERE telegram_id = ? ORDER BY is_favorite DESC, created_at DESC'
  ).all(telegramId);
}

function countCharts(telegramId) {
  return db.prepare('SELECT COUNT(*) as c FROM charts WHERE telegram_id = ?').get(telegramId).c;
}

function getChart(telegramId, chartId) {
  return db.prepare('SELECT * FROM charts WHERE telegram_id = ? AND id = ?').get(telegramId, chartId);
}

function deleteChart(telegramId, chartId) {
  return db.prepare('DELETE FROM charts WHERE telegram_id = ? AND id = ?').run(telegramId, chartId);
}

function updateChart(telegramId, chartId, params, placeLabel) {
  return db.prepare(`
    UPDATE charts SET day = ?, month = ?, year = ?, hour = ?, minute = ?, lat = ?, lon = ?, utc_offset = ?, place_label = ?
    WHERE telegram_id = ? AND id = ?
  `).run(
    params.day, params.month, params.year, params.hour, params.minute,
    params.lat, params.lon, params.utcOffset, placeLabel || null,
    telegramId, chartId
  );
}

function renameChart(telegramId, chartId, label) {
  return db.prepare('UPDATE charts SET label = ? WHERE telegram_id = ? AND id = ?').run(label, telegramId, chartId);
}

function setFolder(telegramId, chartId, folder) {
  return db.prepare('UPDATE charts SET folder = ? WHERE telegram_id = ? AND id = ?').run(folder || null, telegramId, chartId);
}

function toggleFavorite(telegramId, chartId) {
  const row = getChart(telegramId, chartId);
  if (!row) return null;
  const newValue = row.is_favorite ? 0 : 1;
  db.prepare('UPDATE charts SET is_favorite = ? WHERE telegram_id = ? AND id = ?').run(newValue, telegramId, chartId);
  return newValue === 1;
}

// --- Заметки к карте ---
function addNote(chartId, noteText, periodStart) {
  const now = new Date().toISOString();
  const info = db.prepare('INSERT INTO chart_notes (chart_id, note, period_start, created_at) VALUES (?, ?, ?, ?)').run(chartId, noteText, periodStart || null, now);
  return info.lastInsertRowid;
}

function listNotes(chartId) {
  return db.prepare('SELECT * FROM chart_notes WHERE chart_id = ? ORDER BY created_at ASC').all(chartId);
}

function updateNote(chartId, noteId, noteText) {
  return db.prepare('UPDATE chart_notes SET note = ? WHERE id = ? AND chart_id = ?').run(noteText, noteId, chartId);
}

function deleteNote(chartId, noteId) {
  return db.prepare('DELETE FROM chart_notes WHERE id = ? AND chart_id = ?').run(noteId, chartId);
}

try { db.exec('ALTER TABLE search_goals ADD COLUMN factors_json TEXT'); } catch (e) { /* колонка уже есть */ }
// --- Настройки личных уведомлений и «Где я сейчас» (нужно серверу для рассылки по местному времени) ---
try { db.exec('ALTER TABLE users ADD COLUMN place_json TEXT'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN notify_prefs_json TEXT'); } catch (e) { /* уже есть */ }
db.exec(`CREATE TABLE IF NOT EXISTS notify_sent (
  telegram_id INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (telegram_id, kind, key)
)`);
try { db.exec('ALTER TABLE users ADD COLUMN notify_auto_rituals INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN notify_auto_personal INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* уже есть */ }

/**
 * После первой построенной карты: лунный календарь включается всем, личные уведомления — тем, у кого Premium.
 * Каждое включение происходит один раз (если человек потом выключит, повторно не включаем).
 */
function autoEnableNotifications(telegramId) {
  const row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!row) return { rituals: false, personal: false };
  const res = { rituals: false, personal: false };
  if (!row.notify_auto_rituals) {
    db.prepare('UPDATE users SET notify_rituals_enabled = 1, notify_auto_rituals = 1 WHERE telegram_id = ?').run(telegramId);
    res.rituals = true;
  }
  if (!row.notify_auto_personal && isPremium(telegramId)) {
    db.prepare('UPDATE users SET notify_enabled = 1, notify_auto_personal = 1 WHERE telegram_id = ?').run(telegramId);
    res.personal = true;
  }
  return res;
}

// При получении Premium личные уведомления включаются сразу (один раз; если человек выключит — повторно не включаем)
function enablePersonalOnPremium(telegramId) {
  try {
    const row = db.prepare('SELECT notify_auto_personal FROM users WHERE telegram_id = ?').get(telegramId);
    if (row && !row.notify_auto_personal) {
      db.prepare('UPDATE users SET notify_enabled = 1, notify_auto_personal = 1 WHERE telegram_id = ?').run(telegramId);
    }
  } catch (e) { /* не критично */ }
}

// Пользователь для рассылки (карта выбирается так же, как в listNotifiableUsers), независимо от переключателя
function getNotifyUser(telegramId) {
  const row = db.prepare('SELECT telegram_id, primary_chart_id, notify_state FROM users WHERE telegram_id = ?').get(telegramId);
  if (!row) return null;
  let chartId = row.primary_chart_id;
  if (!chartId) {
    const charts = listCharts(telegramId);
    if (charts.length >= 1) chartId = charts[0].id;
  }
  if (!chartId) return null;
  const chart = getChart(telegramId, chartId);
  return chart ? { telegramId, chart, notifyState: row.notify_state ? JSON.parse(row.notify_state) : {} } : null;
}

// Пользователи с включённым ритуальным календарём и сохранённым местом (для рассылки по местному времени)
function listRitualUsersWithPlace() {
  return db.prepare('SELECT telegram_id, place_json FROM users WHERE notify_rituals_enabled = 1 AND telegram_id > 0').all()
    .map((r) => ({ telegramId: r.telegram_id, place: r.place_json ? JSON.parse(r.place_json) : null }));
}
function setUserPlace(telegramId, place) {
  return db.prepare('UPDATE users SET place_json = ? WHERE telegram_id = ?').run(place ? JSON.stringify(place) : null, telegramId);
}
function getUserPlace(telegramId) {
  const r = db.prepare('SELECT place_json FROM users WHERE telegram_id = ?').get(telegramId);
  return r && r.place_json ? JSON.parse(r.place_json) : null;
}
function getNotifyPrefsRaw(telegramId) {
  const r = db.prepare('SELECT notify_prefs_json FROM users WHERE telegram_id = ?').get(telegramId);
  return r && r.notify_prefs_json ? JSON.parse(r.notify_prefs_json) : null;
}
function saveNotifyPrefs(telegramId, prefs) {
  return db.prepare('UPDATE users SET notify_prefs_json = ? WHERE telegram_id = ?').run(JSON.stringify(prefs), telegramId);
}
function wasNotifySent(telegramId, kind, key) {
  return !!db.prepare('SELECT 1 FROM notify_sent WHERE telegram_id = ? AND kind = ? AND key = ?').get(telegramId, kind, key);
}
function countNotifySent(telegramId, kind, prefix) {
  return db.prepare("SELECT COUNT(*) AS c FROM notify_sent WHERE telegram_id = ? AND kind = ? AND key LIKE ?").get(telegramId, kind, prefix + '%').c;
}
function markNotifySent(telegramId, kind, key) {
  db.prepare('INSERT OR IGNORE INTO notify_sent (telegram_id, kind, key, sent_at) VALUES (?, ?, ?, ?)').run(telegramId, kind, key, new Date().toISOString());
  db.prepare("DELETE FROM notify_sent WHERE sent_at < datetime('now', '-60 days')").run();
}

const MAX_SEARCH_GOALS = 12;
function listSearchGoals(telegramId) {
  return db.prepare('SELECT * FROM search_goals WHERE telegram_id = ? ORDER BY id DESC').all(telegramId);
}
function saveSearchGoal(telegramId, g) {
  const existing = db.prepare('SELECT id FROM search_goals WHERE telegram_id = ? AND action = ? AND IFNULL(direction, \'\') = ? AND IFNULL(range_days, 0) = ? AND IFNULL(place_json, \'\') = ? AND IFNULL(factors_json, \'\') = ?')
    .get(telegramId, g.action, g.direction || '', g.rangeDays || 0, g.placeJson || '', g.factorsJson || '');
  if (existing) return existing.id;
  const count = db.prepare('SELECT COUNT(*) AS c FROM search_goals WHERE telegram_id = ?').get(telegramId).c;
  if (count >= MAX_SEARCH_GOALS) return null;
  const info = db.prepare('INSERT INTO search_goals (telegram_id, action, direction, range_days, place_json, chart_name, created_at, factors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(telegramId, g.action, g.direction || null, g.rangeDays || null, g.placeJson || null, g.chartName || null, new Date().toISOString(), g.factorsJson || null);
  return info.lastInsertRowid;
}
function deleteSearchGoal(telegramId, id) {
  return db.prepare('DELETE FROM search_goals WHERE id = ? AND telegram_id = ?').run(id, telegramId);
}

module.exports = {
  rawDb: db, deleteUserData, emptyUserCandidates, logUsage, usageStats, exportUsersCsv, listUsersForAdmin, segmentUserIds, dbInfo, autoEnableNotifications, getNotifyUser, listRitualUsersWithPlace, setUserPlace, getUserPlace, getNotifyPrefsRaw, saveNotifyPrefs, wasNotifySent, markNotifySent, countNotifySent,
  listSearchGoals, saveSearchGoal, deleteSearchGoal, MAX_SEARCH_GOALS,
  upsertUser, getAllUserIds, getUserCount,
  getUser, isPremium, setTier,
  setNotifyEnabled, setPrimaryChart, listNotifiableUsers, saveNotifyState, setAstroSettings,
  setRitualNotifyEnabled, listRitualNotifiableUsers, setDisplayName,
  setReferredBy, markReferralRewardGranted, grantPremiumDays, logReferralReward, getReferralStats, getAllReferralStatsForAdmin,
  saveChart, listCharts, countCharts, getChart, deleteChart, updateChart, renameChart, setFolder, toggleFavorite,
  addNote, listNotes, updateNote, deleteNote,
};
