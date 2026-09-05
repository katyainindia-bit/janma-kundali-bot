// ============================================================
// webapp.js — сервер Telegram Mini App, запускается в том же
// процессе, что и сам бот (один сервис на Railway, без лишних затрат).
// ============================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits, transitDignity } = require('./transits.js');
const { computePanchanga, computeTaraBala } = require('./panchanga.js');
const { calculateNavamsha } = require('./navamsha.js');
const { calculateDashamsha } = require('./dashamsha.js');
const { calculateVarga: calculateOtherVarga, VARGA_DEFS } = require('./divisional-charts.js');
const { computeCalendarMonth, computeDateSearch, computeDayDetail, computeActionDateSearch, GOALS } = require('./date-tools.js');
const { ACTIONS, ACTION_ICONS, NICHE_ACTION_KEYS, evaluateAction } = require('./muhurta.js');
const { getEventsForDate, findUpcomingEvents, getYearEvents } = require('./calendar-events.js');
const { computeSadeSati } = require('./sade-sati.js');
const { findSignExitDate } = require('./transit-forecast.js');
const { houseMeaningPhrase, computeDayTier, transitPhrase } = require('./day-summary.js');
const { buildChartExportPDF } = require('./chart-export-pdf.js');
const { resolveCity } = require('./ru-timezone.js');
const { resolveWorldCityCandidates, resolveTimezoneForCoords } = require('./world-geocoding.js');
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
      const { lat, lon, day, month, year } = req.body;
      if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ error: 'Некорректные координаты' });
      }
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const { utcOffset, timezone } = resolveTimezoneForCoords(lat, lon, dateForTz);
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
      if (found) return res.json({ candidates: [{ city: found.city, lat: found.lat, lon: found.lon }] });
      const candidates = await resolveWorldCityCandidates(query, new Date(), 5);
      res.json({ candidates: candidates.map(c => ({ city: c.city, lat: c.lat, lon: c.lon })) });
    } catch (e) {
      console.error(e);
      res.json({ candidates: [] }); // тихо — это лишь подсказки, не критичный путь
    }
  });

  app.post('/api/geocode', async (req, res) => {
    try {
      const { city, day, month, year } = req.body;
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      let found = resolveCity(city, dateForTz);
      if (!found) {
        // Небольшая курируемая база городов России даёт однозначный ответ сразу —
        // за её пределами используем открытый геокодер и, если он находит
        // несколько похожих городов, отдаём список на выбор, а не молча первый.
        const candidates = await resolveWorldCityCandidates(city, dateForTz);
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

      // 3. Тара-бала дня: накшатра дня (Луна сегодня) относительно натальной накшатры Луны
      const nakSpan = 360 / 27;
      const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
      const todayPanchanga = computePanchanga(
        now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(),
        lat, lon, utcOffset
      );
      const taraBala = computeTaraBala(natalMoonNakIdx, todayPanchanga.nakshatraOfDayIdx);

      // 4. Транзитная Луна сегодня — в каком натальном доме
      const moonTransitHouse = transits.planets['Луна'].transitHouse;

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
      const events = getEventsForDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), todayPanchanga.tithi.number);

      // 8. Движок мухурты: прогоняем сегодняшний день по всем настроенным действиям,
      // делим на «что поддержано» / «что лучше отложить». Действия с пустыми roles
      // (пока не заполненные — например, Посвящения) пропускаем.
      const dayCtx = {
        tithiNumber: todayPanchanga.tithi.number,
        nakshatraIdx: todayPanchanga.nakshatraOfDayIdx,
        weekdayIdx: now.getUTCDay(),
        taraBala,
        dashaChangeToday,
        moonHouseFromLagna: moonTransitHouse,
        calendarEvents: events,
      };
      const muhurtaResults = Object.keys(ACTIONS)
        .filter(key => ACTIONS[key].roles && Object.keys(ACTIONS[key].roles).length > 0)
        .map(key => evaluateAction(key, dayCtx));

      // «Поддержано» строго = нет ограничений + есть явный плюс. Но в дни, где почти
      // всё под ограничением (например, Экадаши), этот список может остаться пустым —
      // а блок «поддержано» должен быть виден всегда (иначе выглядит как один сплошной
      // негатив). В этом случае смягчаем условие до «хотя бы нет ограничений».
      let supportedResults = muhurtaResults.filter(r => r.restrictions.length === 0 && r.favorable.length > 0);
      const strictSupportedCount = supportedResults.length; // для тона заголовка/энергии — не смягчаем
      if (supportedResults.length === 0) {
        supportedResults = muhurtaResults.filter(r => r.restrictions.length === 0);
      }
      // Повседневные действия — вперёд, нишевые (мед./посвящения/стрижка/финдень) — только если места хватает
      supportedResults = supportedResults.slice().sort((a, b) => {
        const an = NICHE_ACTION_KEYS.includes(a.actionKey) ? 1 : 0;
        const bn = NICHE_ACTION_KEYS.includes(b.actionKey) ? 1 : 0;
        return an - bn;
      });
      const supported = supportedResults.slice(0, 4).map(r => ({ key: r.actionKey, label: r.label, icon: ACTION_ICONS[r.actionKey] || '✅' }));
      const postpone = muhurtaResults.filter(r => r.restrictions.length > 0).slice(0, 4).map(r => ({ key: r.actionKey, label: r.label, icon: ACTION_ICONS[r.actionKey] || '⚠' }));

      // 9. Ближайшие предстоящие события
      const allUpcoming = findUpcomingEvents(now, 120, (d) => {
        const pp = computePanchanga(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 12, 0, lat, lon, utcOffset);
        return pp.tithi.number;
      }).filter(e => e.daysAhead > 0);
      let upcomingEvents = allUpcoming.slice(0, 4);
      // Праздники редки по сравнению с Пурнимой/Экадаши/Санкранти — гарантируем,
      // что ближайший праздник всегда виден, даже если формально не попал в топ-4
      const nearestFestival = allUpcoming.find(e => e.type === 'Праздник');
      if (nearestFestival && !upcomingEvents.some(e => e.type === 'Праздник')) {
        upcomingEvents = [...upcomingEvents.slice(0, 3), nearestFestival];
      }

      // 9. Заголовок дня + индикатор энергии — единая логика тона (не должны противоречить друг другу)
      const hasEclipse = events.some(ev => ev.type === 'Затмение (лунное)' || ev.type === 'Затмение (солнечное)');
      const dayTier = computeDayTier({
        dateISO: now.toISOString().slice(0, 10),
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
        nakshatraOfDay: todayPanchanga.nakshatraOfDay,
        tithi: todayPanchanga.tithi,
        rahuKalam: todayPanchanga.rahuKalam,
        moonTransitHouse,
        moonHouseMeaning,
        notableTransits: notableTransits.slice(0, 3),
        dashaChangeToday,
        supported,
        postpone,
        events,
        upcomingEvents,
        daySummary: dayTier.headline,
        dayEnergy: { emoji: dayTier.emoji, label: dayTier.energyLabel },
        energyDescriptor: dayTier.energyDescriptor,
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
        .filter(([, a]) => a.roles && Object.keys(a.roles).length > 0)
        .map(([key, a]) => ({ key, label: a.label })),
    });
  });

  app.post('/api/action-date-search', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { chart, birthDateUTC, lat, lon, utcOffset, action, fromDate, toDate } = req.body;
      const result = computeActionDateSearch(
        chart, new Date(birthDateUTC), lat, lon, utcOffset, action,
        new Date(fromDate), new Date(toDate)
      );
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
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
      const { year } = req.body;
      res.json({ events: getYearEvents(year) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/transit-end-date', requireTelegramUser, requirePremium, (req, res) => {
    try {
      const { planet, lat, lon, utcOffset } = req.body;
      const result = findSignExitDate(planet, new Date(), lat, lon, utcOffset);
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
      primaryChartId: row.primary_chart_id,
      nodeType: row.node_type,
      zodiacType: row.zodiac_type,
      chartStyle: row.chart_style,
      ayanamshaVariant: row.ayanamsha_variant,
      customAyanamshaBase: row.custom_ayanamsha_base,
      observationMode: row.observation_mode,
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
