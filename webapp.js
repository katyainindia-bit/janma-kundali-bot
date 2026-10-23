// ============================================================
// webapp.js — сервер Telegram Mini App, запускается в том же
// процессе, что и сам бот (один сервис на Railway, без лишних затрат).
// ============================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { calculateChart, jdFromDate } = require('./engine.js');
const { bhriguBindu, specialLagnas } = require('./special-points.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits, transitDignity } = require('./transits.js');
const { computePanchanga, computeTaraBala, computeDayNakshatraSegments, moonSignSpan } = require('./panchanga.js');
const { calculateNavamsha } = require('./navamsha.js');
const { calculateDashamsha } = require('./dashamsha.js');
const { calculateVarga: calculateOtherVarga, VARGA_DEFS } = require('./divisional-charts.js');
const { tithiWindow, windowEventsForDate, computeCalendarMonth, computeDateSearch, computeDayDetail, computeActionDateSearch, evaluateMuhurtaLists, personalFromSegment, GOALS } = require('./date-tools.js');
const { ACTIONS } = require('./muhurta.js');
const { getEventsForDate, findUpcomingEvents, getYearEvents } = require('./calendar-events.js');
const { computeSadeSati } = require('./sade-sati.js');
const { findSignExitDate } = require('./transit-forecast.js');
const { buildDayEnergy } = require('./day-energy.js');
const { normalizePrefs } = require('./notify-engine.js');
const { houseMeaningPhrase, computeDayTier, transitPhrase } = require('./day-summary.js');
const { buildChartExportPDF } = require('./chart-export-pdf.js');
const { resolveCity } = require('./ru-timezone.js');
const { resolveWorldCityCandidates, resolveTimezoneForCoords, reverseGeocode } = require('./world-geocoding.js');
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

// Проверка диапазонов даты/времени/координат рождения — то же самое, что
// уже проверяется в мастере бота (bot.js), но /api/chart раньше принимал
// эти поля вообще без проверки: месяц=13 или широта=200 тихо уходили в
// расчёт и давали бессмысленную, но не падающую с ошибкой карту.
// Возвращает строку с описанием проблемы, либо null, если всё в порядке.
function validateBirthParams({ day, month, year, hour, minute, lat, lon, utcOffset }) {
  if (![day, month, year, hour, minute, lat, lon, utcOffset].every(v => typeof v === 'number' && Number.isFinite(v))) {
    return 'Не все поля даты/времени/места заполнены числами';
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Некорректный день';
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Некорректный месяц';
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return 'Некорректный год (допустимо 1900–2100)';
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return 'Такой даты не существует: в этом месяце нет ' + day + '-го числа';
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 'Некорректный час';
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return 'Некорректная минута';
  if (lat < -90 || lat > 90) return 'Широта должна быть в диапазоне от -90 до 90';
  if (lon < -180 || lon > 180) return 'Долгота должна быть в диапазоне от -180 до 180';
  if (utcOffset < -12 || utcOffset > 14) return 'Некорректный часовой пояс';
  return null;
}

// Мидлвара: пропускает дальше только пользователей с активным Premium.
// Использовать ПОСЛЕ requireTelegramUser (нужен req.tgUser).
function requirePremium(req, res, next) {
  if (!db.isPremium(req.tgUser.id)) {
    return res.status(403).json({ error: 'Эта функция доступна только в Premium', premiumRequired: true });
  }
  next();
}

function startWebApp() {
  const app = express();
  // Railway (и большинство PaaS) завершают HTTPS на своём edge-прокси и
  // проксируют запрос на наш сервер уже по обычному HTTP — без этой настройки
  // req.protocol в Express всегда возвращает 'http', даже когда сайт публично
  // доступен только по https. Полезно для любого кода, который сам собирает
  // абсолютную ссылку на сервер (сейчас таких нет, но пусть будет на будущее).
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
      // Запрещаем кэширование — иначе Telegram может подолгу показывать старую версию страницы
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  app.post('/api/timezone-for-coords', (req, res) => {
    try {
      const { lat, lon, day, month, year, hour, minute } = req.body;
      if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ error: 'Некорректные координаты' });
      }
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const { utcOffset, timezone } = resolveTimezoneForCoords(lat, lon, dateForTz, hour, minute);
      res.json({ utcOffset, timezone });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Живые подсказки при наборе города — без учёта даты (часовой пояс здесь
  // не нужен, только сам список похожих городов для выбора по мере ввода).
  app.post('/api/geocode-suggest', async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || query.trim().length < 2) return res.json({ candidates: [] });
      const found = resolveCity(query, new Date());
      if (found) {
        const fullAddress = await reverseGeocode(found.lat, found.lon);
        return res.json({ candidates: [{ city: fullAddress || found.city, lat: found.lat, lon: found.lon }] });
      }
      const candidates = await resolveWorldCityCandidates(query, new Date(), 5);
      res.json({ candidates: candidates.map(c => ({ city: c.city, lat: c.lat, lon: c.lon })) });
    } catch (e) {
      console.error(e);
      res.json({ candidates: [] }); // тихо — это лишь подсказки, не критичный путь
    }
  });

  app.post('/api/geocode', async (req, res) => {
    try {
      const { city, day, month, year, hour, minute } = req.body;
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      let found = resolveCity(city, dateForTz, hour, minute);
      if (found && found.utcOffset !== null) {
        // Наша курируемая база даёт точные координаты и верный исторический
        // часовой пояс, но хранит название без региона — непонятно, тот ли
        // это Орёл (город) или его тёзка. Дополняем настоящим адресом через
        // обратное геокодирование, не меняя сами координаты/часовой пояс.
        const fullAddress = await reverseGeocode(found.lat, found.lon);
        if (fullAddress) found = { ...found, city: fullAddress };
      }
      if (!found) {
        // Небольшая курируемая база городов России даёт однозначный ответ сразу —
        // за её пределами используем открытый геокодер и, если он находит
        // несколько похожих городов, отдаём список на выбор, а не молча первый.
        const candidates = await resolveWorldCityCandidates(city, dateForTz, 5, hour, minute);
        if (candidates.length === 0) return res.status(404).json({ error: 'Город не найден' });
        if (candidates.length === 1) {
          found = { city: candidates[0].city, lat: candidates[0].lat, lon: candidates[0].lon, utcOffset: candidates[0].utcOffset };
        } else {
          return res.json({ candidates });
        }
      }
      res.json(found);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chart', (req, res) => {
    try {
      const { day, month, year, hour, minute, lat, lon, utcOffset, ayanamshaType, nodeType, observationMode, initData } = req.body;
      const validationError = validateBirthParams({ day, month, year, hour, minute, lat, lon, utcOffset });
      if (validationError) return res.status(400).json({ error: validationError });
      // Настройки зодиака/узла берём из сохранённого профиля пользователя, если он
      // авторизован через Telegram initData — иначе (или если явно передали
      // параметром) используем классический дефолт: сидерический Лахири, средний узел.
      let effectiveAyanamsha = ayanamshaType;
      let effectiveNode = nodeType;
      let effectiveObservation = observationMode;
      let customAyanamshaBase = null;
      if (!effectiveAyanamsha || !effectiveNode || !effectiveObservation) {
        const tgUser = verifyInitData(initData);
        if (tgUser) {
          const row = db.getUser(tgUser.id);
          if (row) {
            if (!effectiveAyanamsha) {
              effectiveAyanamsha = row.zodiac_type === 'tropical' ? 'tropical' : (row.ayanamsha_variant || 'lahiri');
              customAyanamshaBase = row.custom_ayanamsha_base;
            }
            if (!effectiveNode) effectiveNode = row.node_type === 'true' ? 'true' : 'mean';
            if (!effectiveObservation) effectiveObservation = row.observation_mode === 'topocentric' ? 'topocentric' : 'geocentric';
          }
        }
      }
      const params = { day, month, year, hour, minute, second: 0, utcOffset, lat, lon, ayanamshaType: effectiveAyanamsha || 'lahiri', nodeType: effectiveNode || 'true', customAyanamshaBase, observationMode: effectiveObservation || 'geocentric' };
      const chart = calculateChart(params);
      // Бхригу-бинду и специальные лагны — не критичны для основного расчёта,
      // поэтому неполадка здесь не должна ронять весь ответ карты.
      try {
        const sl = specialLagnas(year, month, day, hour, minute, 0, utcOffset, lat, lon, params.ayanamshaType, customAyanamshaBase);
        chart.bhriguBindu = bhriguBindu(chart.planets['Луна'].siderealLon, chart.planets['Раху'].siderealLon);
        if (sl) Object.assign(chart, sl);
      } catch (e) {
        console.error('Ошибка спецточек (не критично):', e.message);
      }
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

  app.post('/api/dashamsha', (req, res) => {
    try {
      const { chart } = req.body;
      const d10 = calculateDashamsha(chart);
      res.json({ d10 });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Общий эндпоинт для остальных дробных карт (D2-D60, кроме D9/D10 выше).
  // D9 и D10 — бесплатные, всё остальное — Premium.
  const FREE_VARGAS = ['d9', 'd10'];
  app.post('/api/varga', requireTelegramUser, (req, res) => {
    try {
      const { chart: clientChart, birthParams, key } = req.body;
      if (!FREE_VARGAS.includes(key) && !VARGA_DEFS[key]) {
        return res.status(400).json({ error: 'Неизвестная дробная карта' });
      }
      if (!FREE_VARGAS.includes(key) && !db.isPremium(req.tgUser.id)) {
        return res.status(403).json({ error: 'Эта дробная карта доступна только в Premium', premiumRequired: true });
      }
      // Дробные карты классически имеют смысл только от сидерических позиций —
      // если основная карта построена в тропическом зодиаке (пользовательская
      // настройка), здесь всё равно берём сидерическую (в той аянамше, что
      // выбрана в настройках), а не саму карту с клиента. Метод узла
      // (средний/истинный) при этом сохраняем — это отдельный, не связанный
      // с зодиаком выбор.
      let chart = clientChart;
      if (birthParams) {
        const row = db.getUser(req.tgUser.id);
        const nodeType = (row && row.node_type === 'true') ? 'true' : 'mean';
        const ayanamshaType = (row && row.zodiac_type !== 'tropical') ? (row.ayanamsha_variant || 'lahiri') : 'lahiri';
        const customAyanamshaBase = row ? row.custom_ayanamsha_base : null;
        chart = calculateChart({ ...birthParams, second: 0, ayanamshaType, nodeType, customAyanamshaBase });
      }
      let varga;
      if (key === 'd9') varga = calculateNavamsha(chart);
      else if (key === 'd10') varga = calculateDashamsha(chart);
      else varga = calculateOtherVarga(chart, key);
      res.json({ varga });
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
      const FREE_ARCHIVE_LIMIT = 3;
      if (!db.isPremium(req.tgUser.id) && db.countCharts(req.tgUser.id) >= FREE_ARCHIVE_LIMIT) {
        return res.status(403).json({
          error: `В бесплатном архиве можно сохранить не больше ${FREE_ARCHIVE_LIMIT} карт. В Premium — без ограничений.`,
          premiumRequired: true,
        });
      }
      // Папки — премиум-функция; для free игнорируем переданную папку, чтобы не создавать "теневых" премиум-данных
      const effectiveFolder = db.isPremium(req.tgUser.id) ? folder : null;
      const chartId = db.saveChart(req.tgUser.id, label.trim(), params, placeLabel, effectiveFolder);
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

  app.post('/api/archive/folder', requireTelegramUser, requirePremium, (req, res) => {
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

  app.post('/api/archive/favorite', requireTelegramUser, requirePremium, (req, res) => {
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

  app.post('/api/archive/notes/add', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chartId, note, periodStart } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: 'Пустая заметка' });
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      const noteId = db.addNote(chartId, note.trim(), periodStart);
      res.json({ id: noteId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/notes/update', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chartId, noteId, note } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: 'Пустая заметка' });
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      const info = db.updateNote(chartId, noteId, note.trim());
      if (!info.changes) return res.status(404).json({ error: 'Заметка не найдена' });
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
      const info = db.deleteNote(chartId, noteId);
      if (!info.changes) return res.status(404).json({ error: 'Заметка не найдена' });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- «Сегодня для меня» (Premium): даши + транзиты + кара дня, собранные вместе ----------
  app.post('/api/today', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, lat, lon, utcOffset } = req.body;
      const now = new Date();

      // 1. Текущая цепочка даш (маха/антар/пратьянтар)
      const mahadashas = computeVimshottariDasha(chart, new Date(birthDateUTC));
      const chain = findCurrentDashaChain(mahadashas, now);

      // 2. Текущие транзиты относительно натальной карты
      const transits = computeCurrentTransits(chart, now);

      // 3. Тара-бала дня. Всё считаем по МЕСТНОМУ времени пользователя (раньше UTC-часы
      // подставлялись как местные и момент сдвигался на несколько часов). Ведический
      // день идёт от восхода до восхода: до восхода «сегодня» ещё вчерашнего дня.
      const nakSpan = 360 / 27;
      const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
      const localNow = new Date(now.getTime() + utcOffset * 3600000);
      let ly = localNow.getUTCFullYear(), lm = localNow.getUTCMonth() + 1, ld = localNow.getUTCDate();
      const nowJD = jdFromDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), 0, 0);
      let dayNak = computeDayNakshatraSegments(ly, lm, ld, lat, lon, utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, Math.floor(chart.planets['Луна'].siderealLon / 30) % 12);
      if (nowJD < dayNak.startJD) {
        const prev = new Date(Date.UTC(ly, lm - 1, ld) - 24 * 3600000);
        ly = prev.getUTCFullYear(); lm = prev.getUTCMonth() + 1; ld = prev.getUTCDate();
        dayNak = computeDayNakshatraSegments(ly, lm, ld, lat, lon, utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, Math.floor(chart.planets['Луна'].siderealLon / 30) % 12);
      }
      let currentSegmentIndex = dayNak.segments.findIndex(sg => nowJD >= sg.fromJD && nowJD < sg.toJD);
      if (currentSegmentIndex < 0) currentSegmentIndex = 0;
      const currentSeg = dayNak.segments[currentSegmentIndex];
      const todayPanchanga = computePanchanga(
        ly, lm, ld, localNow.getUTCHours(), localNow.getUTCMinutes(),
        lat, lon, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase
      );
      const taraBala = currentSeg.tara;

      // 4. Транзитная Луна сегодня — в каком натальном доме
      const moonTransitHouse = transits.planets['Луна'].transitHouse;
      const transitHouses = {};
      for (const planetName of ['Марс', 'Венера', 'Юпитер', 'Меркурий']) {
        transitHouses[planetName] = transits.planets[planetName].transitHouse;
      }

      // 5. "Заметные" транзиты сегодня: транзитная планета в том же доме, что натальный
      // Асцендент, лорд текущей антардаши, ИЛИ любая другая натальная планета (включая Луну/Солнце) —
      // раньше список был из 4 фиксированных точек, теперь включены все натальные планеты.
      const sensitivePoints = [{ key: 'Асцендент', house: 1 }];
      for (const [natalPlanetName, natalP] of Object.entries(chart.planets)) {
        sensitivePoints.push({ key: `${natalPlanetName} (натал.)`, house: natalP.house });
      }
      if (chain && chain.antardasha) {
        const lordName = chain.antardasha.lord;
        if (chart.planets[lordName]) {
          sensitivePoints.push({ key: `Лорд антардаши (${lordName})`, house: chart.planets[lordName].house });
        }
      }
      const notableTransits = [];
      for (const [planetName, t] of Object.entries(transits.planets)) {
        const sensitiveHits = sensitivePoints.filter(sp => sp.house === t.transitHouse).map(sp => sp.key);
        // Другие планеты, которые СЕЙЧАС транзитом проходят тот же дом — не только натальные точки
        const coTransits = Object.entries(transits.planets)
          .filter(([otherName, ot]) => otherName !== planetName && ot.transitHouse === t.transitHouse)
          .map(([otherName]) => `${otherName} (транзит)`);
        const allHits = [...sensitiveHits, ...coTransits];
        const dignity = transitDignity(planetName, t.sign.index);
        if (allHits.length > 0 || dignity) {
          notableTransits.push({ planet: planetName, house: t.transitHouse, hits: allHits, sensitiveHitCount: sensitiveHits.length, dignity, phrase: transitPhrase(planetName, t.transitHouse, dignity) });
        }
      }
      // Соединение с чувствительной точкой карты (Асцендент/натальная Луна/Солнце/лорд антардаши)
      // важнее и персональнее, чем просто "рядом с другой транзитной планетой" или "сильная позиция" —
      // именно оно должно выживать при обрезке до 3 карточек
      notableTransits.sort((a, b) => (a.sensitiveHitCount > 0 ? 0 : 1) - (b.sensitiveHitCount > 0 ? 0 : 1));

      // 6. Смена периода даши именно сегодня (по календарной дате, не только по времени)
      function isSameUTCDate(d1, d2) {
        return d1.getUTCFullYear() === d2.getUTCFullYear() && d1.getUTCMonth() === d2.getUTCMonth() && d1.getUTCDate() === d2.getUTCDate();
      }
      let dashaChangeToday = null;
      if (chain) {
        if (chain.pratyantardasha && isSameUTCDate(new Date(chain.pratyantardasha.start), now)) {
          dashaChangeToday = { level: 'пратьянтардаша', lord: chain.pratyantardasha.lord };
        } else if (chain.antardasha && isSameUTCDate(new Date(chain.antardasha.start), now)) {
          dashaChangeToday = { level: 'антардаша', lord: chain.antardasha.lord };
        } else if (isSameUTCDate(new Date(chain.mahadasha.start), now)) {
          dashaChangeToday = { level: 'махадаша', lord: chain.mahadasha.lord };
        }
      }

      // 7. Астрологические события сегодня (нужны заранее — движок мухурты учитывает
      // Санкранти/затмения как «особые дни», не только Экадаши/Пурниму/Амавасью из титхи)
      const events = getEventsForDate(ly, lm, ld, todayPanchanga.tithi.number, undefined, { lat, lon, utcOffset });
      const displayEvents = windowEventsForDate(ly, lm, ld, lat, lon, utcOffset);

      // 8. Движок мухурты: прогоняем сегодняшний день по всем настроенным действиям,
      // делим на «что поддержано» / «что лучше отложить». Действия с пустыми roles
      // (пока не заполненные — например, Посвящения) пропускаем.
      const dayCtx = {
        tithiNumber: todayPanchanga.tithi.number,
        nakshatraIdx: currentSeg.nakshatraIdx,
        nakshatraPada: todayPanchanga.nakshatraPada,
        weekdayIdx: new Date(Date.UTC(ly, lm - 1, ld)).getUTCDay(),
        yogaName: todayPanchanga.yoga.name,
        karanaName: todayPanchanga.karana.name,
        personal: personalFromSegment(currentSeg),
        calendarEvents: events,
      };
      // «Сегодня» показывает только простые дела (крупные — в «Днях» и «Поиске по цели»).
      // В «Благоприятно» попадают лишь дела с реальной поддержкой, в «Отложить» — только
      // со строгим ограничением. «Недостаточно оснований» не выводится ни туда, ни туда.
      const lists = evaluateMuhurtaLists(dayCtx);
      const supported = lists.supported;
      const postpone = lists.postpone;
      const strictSupportedCount = lists.strictSupportedCount;

      // 9. Ближайшие предстоящие события
      const allUpcoming = findUpcomingEvents(now, 120, (d) => {
        const pp = computePanchanga(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 12, 0, lat, lon, utcOffset);
        return pp.tithi.number;
      }, (d) => tithiWindow(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), lat, lon, utcOffset), { lat, lon, utcOffset }).filter(e => e.daysAhead > 0);
      let upcomingEvents = allUpcoming.slice(0, 4);
      // Праздники редки по сравнению с Пурнимой/Экадаши/Санкранти — гарантируем,
      // что ближайший праздник всегда виден, даже если формально не попал в топ-4
      const nearestFestival = allUpcoming.find(e => e.type === 'Праздник');
      if (nearestFestival && !upcomingEvents.some(e => e.type === 'Праздник')) {
        upcomingEvents = [...upcomingEvents.slice(0, 3), nearestFestival];
      }

      // 9. Заголовок дня + индикатор энергии — единая логика тона (не должны противоречить друг другу)
      const hasEclipse = events.some(ev => (ev.type === 'Затмение (лунное)' || ev.type === 'Затмение (солнечное)') && !ev.penumbral);
      const dayTier = computeDayTier({
        dateISO: `${ly}-${String(lm).padStart(2, '0')}-${String(ld).padStart(2, '0')}`,
        hasEclipse,
        tithiName: todayPanchanga.tithi.name,
        dashaChangeToday,
        supportedCount: strictSupportedCount,
        postponeCount: postpone.length,
      });
      const moonHouseMeaning = houseMeaningPhrase(moonTransitHouse);

      res.json({
        asOf: now.toISOString(),
        chain,
        taraBala,
        daySegments: dayNak.segments.map(sg => ({ nakshatra: sg.nakshatra, from: sg.from, to: sg.to, fromDate: sg.fromDate, toDate: sg.toDate, share: sg.share, taraName: sg.tara.name, taraQuality: sg.tara.quality, moonSign: sg.moonSign, chandraHouse: sg.chandra ? sg.chandra.house : null, chandraQuality: sg.chandra ? sg.chandra.quality : null, tone: sg.tone, paksha: sg.paksha })),
        dayTone: currentSeg.tone,
        dayTierKey: dayTier.tier,
        currentSegmentIndex,
        nakshatraOfDay: currentSeg.nakshatra,
        tithi: todayPanchanga.tithi,
        rahuKalam: todayPanchanga.rahuKalam,
        moonTransitHouse,
        moonHouseMeaning,
        notableTransits: notableTransits.slice(0, 3),
        dashaChangeToday,
        supported,
        postpone,
        events: displayEvents,
        upcomingEvents,
        daySummary: dayTier.headline,
        dayEnergy: { emoji: dayTier.emoji, label: dayTier.energyLabel },
        energyDescriptor: dayTier.energyDescriptor,
        dayEnergyText: buildDayEnergy(dayNak.segments, chart.ascendant.sign.index, moonSignSpan(dayNak.startJD + 1e-4, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase)),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });


  // ---------- «Дни»: персональный календарь и поиск дат под цель (Premium) ----------
  // ---------- Экспорт карты в PDF (выбор разделов) ----------
  // Временное хранилище готовых PDF: отдаём НАСТоящую ссылку с сервера,
  // а не blob: URL — в вебвью Telegram на телефоне blob-ссылки часто не
  // открываются ("не найдено приложение для открытия"). Ссылка живёт
  // недолго и одноразовая по смыслу использования.
  const pdfExportCache = new Map(); // token -> { buffer, expiresAt }
  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of pdfExportCache.entries()) {
      if (entry.expiresAt < now) pdfExportCache.delete(token);
    }
  }, 5 * 60 * 1000);

  app.post('/api/export-pdf', requireTelegramUser, (req, res) => {
    try {
      const { name, dateStr, timeStr, placeLabel, chart, birthDateUTC, sections } = req.body;
      const isPremiumUser = db.isPremium(req.tgUser.id);
      const FREE_VARGAS = ['d9', 'd10'];

      const requestedVargas = (sections && sections.vargas) || [];
      const allowedVargas = requestedVargas.filter(k => FREE_VARGAS.includes(k) || isPremiumUser);

      let transitsResult = null;
      if (sections && sections.transits) {
        transitsResult = computeCurrentTransits(chart, new Date());
      }
      let dashaData = null;
      if (sections && sections.periods) {
        const mahadashas = computeVimshottariDasha(chart, new Date(birthDateUTC));
        const chain = findCurrentDashaChain(mahadashas, new Date());
        dashaData = { mahadashas, chain };
      }

      buildChartExportPDF({
        name: name || 'Без имени', dateStr, timeStr, placeLabel, chart,
        sections: { chart: !!(sections && sections.chart), vargas: allowedVargas, transits: !!(sections && sections.transits), periods: !!(sections && sections.periods), periodsMode: sections && sections.periodsMode },
        transitsResult, dashaData,
      }).then(buf => {
        const token = crypto.randomBytes(16).toString('hex');
        pdfExportCache.set(token, { buffer: buf, expiresAt: Date.now() + 10 * 60 * 1000 });
        res.json({ downloadUrl: `/export-download/${token}` });
      }).catch(e => {
        console.error(e);
        res.status(500).json({ error: e.message });
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/export-download/:token', (req, res) => {
    const entry = pdfExportCache.get(req.params.token);
    if (!entry) return res.status(404).send('Ссылка устарела — соберите PDF заново.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="chart-export.pdf"');
    res.send(entry.buffer);
  });

  app.post('/api/goals', (req, res) => {
    res.json({ goals: Object.entries(GOALS).map(([key, g]) => ({ key, label: g.label })) });
  });

  // Список действий движка мухурты — новая версия «Поиск по цели»,
  // на замену старым 8 GOALS (те остаются для обратной совместимости выше)
  app.post('/api/actions', (req, res) => {
    res.json({
      actions: Object.entries(ACTIONS)
        .map(([key, a]) => ({ key, label: a.label, category: a.category })),
    });
  });

  app.post('/api/action-date-search', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, lat, lon, utcOffset, action, fromDate, toDate, travelDirection, factors } = req.body;
      const result = computeActionDateSearch(
        chart, new Date(birthDateUTC), lat, lon, utcOffset, action,
        new Date(fromDate), new Date(toDate), travelDirection, factors
      );
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Сохранённые цели поиска -----
  app.post('/api/search-goals/list', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const goals = db.listSearchGoals(req.tgUser.id).map(g => ({
        id: g.id, action: g.action, direction: g.direction, rangeDays: g.range_days,
        place: g.place_json ? JSON.parse(g.place_json) : null, chartName: g.chart_name,
        factors: g.factors_json ? JSON.parse(g.factors_json) : null,
      }));
      res.json({ goals });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });
  app.post('/api/search-goals/save', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { action, direction, rangeDays, place, chartName, factors } = req.body;
      let factorsJson = null;
      if (factors && typeof factors === 'object') {
        const f = { muhurta: !!factors.muhurta, dasha: !!factors.dasha, gochara: !!factors.gochara };
        if (f.muhurta || f.dasha || f.gochara) factorsJson = JSON.stringify(f);
      }
      if (!ACTIONS[action]) return res.status(400).json({ error: 'Неизвестное дело' });
      const days = Number(rangeDays);
      let placeJson = null;
      if (place && typeof place.lat === 'number' && typeof place.lon === 'number' && typeof place.utcOffset === 'number') {
        placeJson = JSON.stringify({ name: String(place.name || '').slice(0, 120), lat: place.lat, lon: place.lon, utcOffset: place.utcOffset });
      }
      const id = db.saveSearchGoal(req.tgUser.id, {
        action, direction: direction ? String(direction).slice(0, 20) : null,
        rangeDays: [7, 30, 90].includes(days) ? days : null, placeJson, factorsJson,
        chartName: chartName ? String(chartName).slice(0, 80) : null,
      });
      if (id === null) return res.status(400).json({ error: `Можно хранить до ${db.MAX_SEARCH_GOALS} целей — удалите лишние.` });
      res.json({ ok: true, id });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });
  app.post('/api/search-goals/delete', requireTelegramUser, requirePremium, (req, res) => {
    try {
      db.deleteSearchGoal(req.tgUser.id, Number(req.body.id));
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/calendar-month', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, year, month, lat, lon, utcOffset } = req.body;
      const days = computeCalendarMonth(chart, new Date(birthDateUTC), year, month, lat, lon, utcOffset);
      res.json({ days });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/year-events', requireTelegramUser, (req, res) => {
    try {
      const { year, lat, lon, utcOffset } = req.body;
      const place = (typeof lat === 'number' && typeof lon === 'number' && typeof utcOffset === 'number') ? { lat, lon, utcOffset } : null;
      res.json({ events: getYearEvents(year, place) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/transit-end-date', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { planet, lat, lon, utcOffset } = req.body;
      const row = db.getUser(req.tgUser.id);
      const ayanamshaType = (row && row.zodiac_type !== 'tropical') ? (row.ayanamsha_variant || 'lahiri') : 'lahiri';
      const customAyanamshaBase = row ? row.custom_ayanamsha_base : null;
      const result = findSignExitDate(planet, new Date(), lat, lon, utcOffset, ayanamshaType, customAyanamshaBase);
      res.json(result || { daysAhead: null, date: null });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/sade-sati', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, lat, lon, utcOffset } = req.body;
      const result = computeSadeSati(chart, new Date(), lat, lon, utcOffset);
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/day-detail', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, year, month, day, lat, lon, utcOffset } = req.body;
      const detail = computeDayDetail(chart, new Date(birthDateUTC), year, month, day, lat, lon, utcOffset);
      res.json(detail);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/date-search', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, lat, lon, utcOffset, goal, fromDate, toDate } = req.body;
      const result = computeDateSearch(
        chart, new Date(birthDateUTC), lat, lon, utcOffset, goal,
        new Date(fromDate), new Date(toDate)
      );
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/tier', requireTelegramUser, (req, res) => {
    const row = db.getUser(req.tgUser.id);
    res.json({
      tier: row.tier,
      premiumUntil: row.premium_until,
      isPremium: db.isPremium(req.tgUser.id),
      notifyEnabled: !!row.notify_enabled,
      notifyRitualsEnabled: !!row.notify_rituals_enabled,
      notifyPrefs: normalizePrefs(db.getNotifyPrefsRaw(req.tgUser.id)),
      primaryChartId: row.primary_chart_id,
      nodeType: row.node_type,
      zodiacType: row.zodiac_type,
      chartStyle: row.chart_style,
      ayanamshaVariant: row.ayanamsha_variant,
      customAyanamshaBase: row.custom_ayanamsha_base,
      observationMode: row.observation_mode,
      displayName: row.display_name,
    });
  });

  app.post('/api/settings/update', requireTelegramUser, (req, res) => {
    try {
      const { nodeType, zodiacType, chartStyle, ayanamshaVariant, customAyanamshaBase, observationMode } = req.body;
      if (nodeType && !['mean', 'true'].includes(nodeType)) return res.status(400).json({ error: 'Некорректный тип узла' });
      if (zodiacType && !['sidereal', 'tropical'].includes(zodiacType)) return res.status(400).json({ error: 'Некорректный тип зодиака' });
      if (chartStyle && !['north', 'south'].includes(chartStyle)) return res.status(400).json({ error: 'Некорректный стиль карты' });
      if (ayanamshaVariant && !['lahiri', 'raman', 'krishnamurti', 'custom'].includes(ayanamshaVariant)) return res.status(400).json({ error: 'Некорректная аянамша' });
      if (ayanamshaVariant === 'custom' && (typeof customAyanamshaBase !== 'number' || isNaN(customAyanamshaBase))) return res.status(400).json({ error: 'Укажите числовое значение своей аянамши' });
      if (observationMode && !['geocentric', 'topocentric'].includes(observationMode)) return res.status(400).json({ error: 'Некорректный режим наблюдения' });
      db.setAstroSettings(req.tgUser.id, { nodeType, zodiacType, chartStyle, ayanamshaVariant, customAyanamshaBase, observationMode });
      const row = db.getUser(req.tgUser.id);
      res.json({ nodeType: row.node_type, zodiacType: row.zodiac_type, chartStyle: row.chart_style, ayanamshaVariant: row.ayanamsha_variant, customAyanamshaBase: row.custom_ayanamsha_base, observationMode: row.observation_mode });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // «Где я сейчас» — сервер должен знать место, чтобы слать уведомления по местному времени
  app.post('/api/place/save', requireTelegramUser, (req, res) => {
    try {
      const { place } = req.body;
      if (place === null) { db.setUserPlace(req.tgUser.id, null); return res.json({ ok: true }); }
      if (!place || typeof place.lat !== 'number' || typeof place.lon !== 'number' || typeof place.utcOffset !== 'number' ||
          Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180 || Math.abs(place.utcOffset) > 15) {
        return res.status(400).json({ error: 'Некорректное место' });
      }
      db.setUserPlace(req.tgUser.id, { name: String(place.name || '').slice(0, 120), lat: place.lat, lon: place.lon, utcOffset: place.utcOffset });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // Автовключение после первой построенной карты: лунный календарь — всем, личные уведомления — Premium
  app.post('/api/notify/auto-enable', requireTelegramUser, (req, res) => {
    try {
      res.json({ ok: true, ...db.autoEnableNotifications(req.tgUser.id) });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // «Прислать пример»: собирает выбранное сообщение за сегодняшний день и отправляет самому пользователю
  app.post('/api/notify/test', requireTelegramUser, requirePremium, async (req, res) => {
    try {
      const kind = String(req.body.kind || '');
      const u = db.getNotifyUser(req.tgUser.id);
      if (!u) return res.status(400).json({ error: 'Сначала сохраните карту в архиве или выберите основную карту.' });
      if (!BOT_TOKEN) return res.status(500).json({ error: 'Бот не настроен' });
      const tgBot = { telegram: { sendMessage: async (chatId, text, extra) => {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, ...(extra || {}) }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.description || 'Telegram не принял сообщение');
        return j;
      } } };
      const notifications = require('./notifications.js');
      const now = new Date();
      let sent = false;
      if (kind === 'morning') sent = await notifications.sendMorningFor(tgBot, u, now, true);
      else if (kind === 'weekly') sent = await notifications.sendWeeklyFor(tgBot, u, now, true);
      else if (kind === 'evening') sent = await notifications.sendEveningFor(tgBot, u, now, true);
      else if (kind === 'intraday') sent = await notifications.sendIntradaySample(tgBot, u, now);
      else if (kind === 'watch') sent = await notifications.sendWatchAlertFor(tgBot, u, now, true);
      else return res.status(400).json({ error: 'Неизвестный тип' });
      res.json({ ok: true, sent: !!sent, note: sent ? null : 'Сейчас в этом сообщении нечего показать (нет подходящих событий).' });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/notify/prefs', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const prefs = normalizePrefs(req.body.prefs);
      db.saveNotifyPrefs(req.tgUser.id, prefs);
      res.json({ ok: true, prefs });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/notify/toggle', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { enabled } = req.body;
      db.setNotifyEnabled(req.tgUser.id, !!enabled);
      res.json({ ok: true, enabled: !!enabled });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Ритуальные напоминания — отдельная бесплатная подписка, не требует Premium
  app.post('/api/notify/ritual-toggle', requireTelegramUser, (req, res) => {
    try {
      const { enabled } = req.body;
      db.setRitualNotifyEnabled(req.tgUser.id, !!enabled);
      res.json({ ok: true, enabled: !!enabled });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/referral/info', requireTelegramUser, (req, res) => {
    try {
      const botUsername = process.env.BOT_USERNAME;
      if (!botUsername) {
        return res.status(500).json({ error: 'BOT_USERNAME не задан на сервере' });
      }
      const link = `https://t.me/${botUsername}?start=ref_${req.tgUser.id}`;
      const stats = db.getReferralStats(req.tgUser.id);
      res.json({ link, ...stats });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/account/set-name', requireTelegramUser, (req, res) => {
    try {
      const { name } = req.body;
      const trimmed = (name || '').trim().slice(0, 60);
      db.setDisplayName(req.tgUser.id, trimmed || null);
      res.json({ ok: true, name: trimmed });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/archive/set-primary', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chartId } = req.body;
      const row = db.getChart(req.tgUser.id, chartId);
      if (!row) return res.status(404).json({ error: 'Карта не найдена' });
      db.setPrimaryChart(req.tgUser.id, chartId);
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
