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
    last_seen TEXT NOT NULL
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
    created_at TEXT NOT NULL,
    FOREIGN KEY (chart_id) REFERENCES charts(id)
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

function getAllUserIds() {
  return db.prepare('SELECT telegram_id FROM users').all().map(r => r.telegram_id);
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
  return db.prepare('UPDATE users SET tier = ?, premium_until = ? WHERE telegram_id = ?')
    .run(tier, untilISO || null, telegramId);
}

// --- Уведомления ---
function setNotifyEnabled(telegramId, enabled) {
  return db.prepare('UPDATE users SET notify_enabled = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, telegramId);
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
    WHERE u.notify_enabled = 1
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
function addNote(chartId, noteText) {
  const now = new Date().toISOString();
  const info = db.prepare('INSERT INTO chart_notes (chart_id, note, created_at) VALUES (?, ?, ?)').run(chartId, noteText, now);
  return info.lastInsertRowid;
}

function listNotes(chartId) {
  return db.prepare('SELECT * FROM chart_notes WHERE chart_id = ? ORDER BY created_at ASC').all(chartId);
}

function updateNote(noteId, noteText) {
  return db.prepare('UPDATE chart_notes SET note = ? WHERE id = ?').run(noteText, noteId);
}

function deleteNote(noteId) {
  return db.prepare('DELETE FROM chart_notes WHERE id = ?').run(noteId);
}

module.exports = {
  upsertUser, getAllUserIds, getUserCount,
  getUser, isPremium, setTier,
  setNotifyEnabled, setPrimaryChart, listNotifiableUsers, saveNotifyState,
  saveChart, listCharts, countCharts, getChart, deleteChart, updateChart, renameChart, setFolder, toggleFavorite,
  addNote, listNotes, updateNote, deleteNote,
};
