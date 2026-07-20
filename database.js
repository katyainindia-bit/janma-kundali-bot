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
    created_at TEXT NOT NULL,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  );
`);

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

// --- Архив карт ---
function saveChart(telegramId, label, params, placeLabel) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO charts (telegram_id, label, day, month, year, hour, minute, lat, lon, utc_offset, place_label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegramId, label, params.day, params.month, params.year, params.hour, params.minute,
    params.lat, params.lon, params.utcOffset, placeLabel || null, now
  );
  return info.lastInsertRowid;
}

function listCharts(telegramId) {
  return db.prepare('SELECT * FROM charts WHERE telegram_id = ? ORDER BY created_at DESC').all(telegramId);
}

function getChart(telegramId, chartId) {
  return db.prepare('SELECT * FROM charts WHERE telegram_id = ? AND id = ?').get(telegramId, chartId);
}

function deleteChart(telegramId, chartId) {
  return db.prepare('DELETE FROM charts WHERE telegram_id = ? AND id = ?').run(telegramId, chartId);
}

module.exports = {
  upsertUser, getAllUserIds, getUserCount,
  saveChart, listCharts, getChart, deleteChart,
};
