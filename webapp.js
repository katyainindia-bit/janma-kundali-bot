// ============================================================
// webapp.js — сервер Telegram Mini App, запускается в том же
// процессе, что и сам бот (один сервис на Railway, без лишних затрат).
// ============================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computePanchanga } = require('./panchanga.js');
const { calculateNavamsha } = require('./navamsha.js');
const { resolveCity } = require('./ru-timezone.js');
const { resolveWorldCity } = require('./world-geocoding.js');
const db = require('./database.js');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ------------------------------------------------------------
// Проверка Telegram.WebApp.initData — доказывает, что запрос
// действительно пришёл из Telegram и что telegram_id в нём не подделан.
// Алгоритм из официальной документации Telegram Mini Apps.
// Возвращает объект пользователя {id, username, first_name} или null.
// ------------------------------------------------------------
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [];
    for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) {
    console.error('initData verification error:', e);
    return null;
  }
}

// Мидлвара: проверяет initData из тела запроса, кладёт telegram-пользователя
// в req.tgUser. Если проверка не прошла — отвечает 401.
function requireTelegramUser(req, res, next) {
  const user = verifyInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Не удалось проверить пользователя Telegram' });
  req.tgUser = user;
  db.upsertUser({ from: user });
  next();
}

function startWebApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
      // Запрещаем кэширование — иначе Telegram может подолгу показывать старую версию страницы
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  app.post('/api/geocode', async (req, res) => {
    try {
      const { city, day, month, year } = req.body;
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      let found = resolveCity(city, dateForTz);
      if (!found) {
        const world = await resolveWorldCity(city, dateForTz);
        if (world) found = { city: world.city, lat: world.lat, lon: world.lon, utcOffset: world.utcOffset };
      }
      if (!found) return res.status(404).json({ error: 'Город не найден' });
      res.json(found);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chart', (req, res) => {
    try {
      const { day, month, year, hour, minute, lat, lon, utcOffset, ayanamshaType } = req.body;
      const params = { day, month, year, hour, minute, second: 0, utcOffset, lat, lon, ayanamshaType: ayanamshaType || 'lahiri' };
      const chart = calculateChart(params);
      res.json({ chart, params });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/dasha', (req, res) => {
    try {
      const { chart, birthDateUTC } = req.body;
      const mahadashas = computeVimshottariDasha(chart, new Date(birthDateUTC));
      const chain = findCurrentDashaChain(mahadashas, new Date());
      res.json({ mahadashas, chain });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/transits', (req, res) => {
    try {
      const { chart, atDate } = req.body;
      const transits = computeCurrentTransits(chart, atDate ? new Date(atDate) : new Date());
      res.json({ transits });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/navamsha', (req, res) => {
    try {
      const { chart } = req.body;
      const d9 = calculateNavamsha(chart);
      res.json({ d9 });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/panchanga', (req, res) => {
    try {
      const { day, month, year, hour, minute, lat, lon, utcOffset } = req.body;
      const p = computePanchanga(year, month, day, hour, minute, lat, lon, utcOffset);
      res.json({ panchanga: p });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- Архив: сохранённые карты, папки, избранное, заметки ----------

  app.post('/api/archive/list', requireTelegramUser, (req, res) => {
    try {
      const charts = db.listCharts(req.tgUser.id);
      res.json({ charts });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/save', requireTelegramUser, (req, res) => {
    try {
      const { label, params, placeLabel, folder } = req.body;
      if (!label || !label.trim()) return res.status(400).json({ error: 'Нужно название карты' });
      const chartId = db.saveChart(req.tgUser.id, label.trim(), params, placeLabel, folder);
      res.json({ id: chartId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/rename', requireTelegramUser, (req, res) => {
    try {
      const { chartId, label } = req.body;
      if (!label || !label.trim()) return res.status(400).json({ error: 'Нужно название карты' });
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.renameChart(req.tgUser.id, chartId, label.trim());
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/folder', requireTelegramUser, (req, res) => {
    try {
      const { chartId, folder } = req.body;
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.setFolder(req.tgUser.id, chartId, folder);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/favorite', requireTelegramUser, (req, res) => {
    try {
      const { chartId } = req.body;
      const newState = db.toggleFavorite(req.tgUser.id, chartId);
      if (newState === null) return res.status(404).json({ error: 'Карта не найдена' });
      res.json({ isFavorite: newState });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/delete', requireTelegramUser, (req, res) => {
    try {
      const { chartId } = req.body;
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.deleteChart(req.tgUser.id, chartId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/notes/list', requireTelegramUser, (req, res) => {
    try {
      const { chartId } = req.body;
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      res.json({ notes: db.listNotes(chartId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/notes/add', requireTelegramUser, (req, res) => {
    try {
      const { chartId, note } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: 'Пустая заметка' });
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      const noteId = db.addNote(chartId, note.trim());
      res.json({ id: noteId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/notes/update', requireTelegramUser, (req, res) => {
    try {
      const { chartId, noteId, note } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: 'Пустая заметка' });
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.updateNote(noteId, note.trim());
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/notes/delete', requireTelegramUser, (req, res) => {
    try {
      const { chartId, noteId } = req.body;
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.deleteNote(noteId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Railway сам передаёт правильный порт через переменную PORT для "публичных" сервисов
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Mini App сервер запущен на порту ${PORT}`));
}

module.exports = { startWebApp };
