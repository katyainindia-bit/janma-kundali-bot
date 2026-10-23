// ============================================================
// notifications.js — ежедневные уведомления для Premium.
// Раз в сутки (по умолчанию — в 8:00 по Москве) проверяет карту
// каждого пользователя с включёнными уведомлениями и решает,
// есть ли повод написать: сменился подпериод даши, сегодня
// особенно благоприятный/неблагоприятный день, или начался
// заметный транзит к чувствительной точке карты.
//
// Работает в том же процессе, что и бот (без внешнего cron) —
// простой таймер проверяет время раз в несколько минут.
// ============================================================

const db = require('./database.js');
const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computePanchanga, computeTaraBala } = require('./panchanga.js');
const { getEventsForDate } = require('./calendar-events.js');
const { sendMessageWithBackoff } = require('./telegram-send.js');
const { normalizePrefs, buildMorningMessage, buildWeeklyMessage, buildEveningMessage, buildWatchAlertMessage, buildRitualMessage, localDateParts, effectivePlace, inQuiet, intradayTransitions, intradayText } = require('./notify-engine.js');

const NOTABLE_TARA_QUALITIES = ['наиболее благоприятно', 'неблагоприятно', 'наименее благоприятно'];

// --- Ритуальные напоминания (Экадаши/Пурнима/Амавасья/праздники) ---
// Одинаковы для всех подписчиков — не завязаны на чью-то конкретную карту
// или координаты (титхи не зависит от места наблюдения). Дата берётся по
// единому опорному времени (UTC), как и у остального планировщика ниже —
// это то же упрощение, что уже принято в проекте, а не новый компромисс.
function buildRitualNotificationForToday() {
  const now = new Date();
  // Титхи не зависит от места, но нам всё равно нужна панчанга дня — берём
  // Москву как опорную точку (координаты нужны формально для восхода/заката,
  // на сам титхи и события они не влияют).
  const p = computePanchanga(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), 55.75, 37.6, 3);
  const events = getEventsForDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), p.tithi.number);
  if (events.length === 0) return null;
  return events.map(e => `🔔 ${e.label}${e.description ? '\n' + e.description : ''}`).join('\n\n');
}

/** Лунный календарь для подписчиков: в 8:00 по местному времени (место — «Где я сейчас», иначе Москва). */
async function runRitualDailyCheck(bot, force, onlyTelegramId, nowOverride) {
  const users = db.listRitualUsersWithPlace().filter((u) => !onlyTelegramId || u.telegramId === onlyTelegramId);
  const now = nowOverride || new Date();
  for (const u of users) {
    try {
      const urow = db.getUser(u.telegramId);
      // у тех, кому события дня приходят в утреннем сообщении, отдельное не шлём (чтобы не дублировать)
      if (!force && urow && urow.notify_enabled && db.isPremium(u.telegramId)) {
        const pr = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
        if (pr.morning.enabled && pr.morning.blocks.events) continue;
      }
      const off = u.place && typeof u.place.utcOffset === 'number' ? u.place.utcOffset : 3;
      const lp = localDateParts(now, off);
      const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
      if (!force) {
        const minutesNow = lp.hh * 60 + lp.mm;
        if (minutesNow < 8 * 60 || minutesNow > 11 * 60) continue;
        if (db.wasNotifySent(u.telegramId, 'ritual', dateKey)) continue;
        db.markNotifySent(u.telegramId, 'ritual', dateKey);
      }
      const msg = buildRitualMessage(u.place, now);
      if (!msg) continue;
      await sendMessageWithBackoff(bot, u.telegramId, msg.text);
    } catch (e) {
      console.error(`Ошибка ритуального уведомления для ${u.telegramId}:`, e);
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

function chartParamsFromRow(row) {
  return {
    day: row.day, month: row.month, year: row.year, hour: row.hour, minute: row.minute,
    lat: row.lat, lon: row.lon, utcOffset: row.utc_offset,
  };
}

function birthDateUTCFromRow(row) {
  return new Date(Date.UTC(row.year, row.month - 1, row.day, row.hour, row.minute, 0) - row.utc_offset * 3600000);
}

/**
 * Собирает список сообщений (может быть 0, 1 или несколько), которые нужно
 * отправить пользователю сегодня, и обновляет его notify_state — если ничего
 * нового, notifyState возвращается без изменений.
 */
function buildNotificationsForUser(chartRow, prevState, userSettings) {
  const params = chartParamsFromRow(chartRow);
  // Берём ту же аянамшу/узел/кастомную базу, что пользователь выбрал в
  // настройках — иначе уведомления (даши, транзиты, тара-бала) считаются
  // по другой карте, чем та, которую пользователь видит в приложении.
  const ayanamshaType = (userSettings && userSettings.zodiac_type !== 'tropical') ? ((userSettings && userSettings.ayanamsha_variant) || 'lahiri') : 'lahiri';
  const nodeType = (userSettings && userSettings.node_type === 'true') ? 'true' : 'mean';
  const customAyanamshaBase = userSettings ? userSettings.custom_ayanamsha_base : null;
  const chart = calculateChart({ ...params, second: 0, ayanamshaType, nodeType, customAyanamshaBase });
  const now = new Date();

  const messages = [];
  const newState = { ...prevState };

  // 1. Смена антардаши/пратьянтардаши
  const mahadashas = computeVimshottariDasha(chart, birthDateUTCFromRow(chartRow));
  const chain = findCurrentDashaChain(mahadashas, now);
  if (chain) {
    if (chain.antardasha && chain.antardasha.lord !== prevState.antardashaLord) {
      messages.push(
        `🔔 Началась антардаша ${chain.antardasha.lord} (в махадаше ${chain.mahadasha.lord}) — продлится примерно до ${chain.antardasha.end.toISOString().slice(0,10).split('-').reverse().join('.')}.`
      );
      newState.antardashaLord = chain.antardasha.lord;
    }
    if (chain.pratyantardasha && chain.pratyantardasha.lord !== prevState.pratyantardashaLord) {
      messages.push(
        `Новый подпериод: пратьянтардаша ${chain.pratyantardasha.lord} — до ${chain.pratyantardasha.end.toISOString().slice(0,10).split('-').reverse().join('.')}.`
      );
      newState.pratyantardashaLord = chain.pratyantardasha.lord;
    }
  }

  // 2. Тара-бала дня (только заметные дни — не каждый день, иначе спам)
  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const todayISO = now.toISOString().slice(0, 10);
  if (prevState.lastTaraNotifiedDate !== todayISO) {
    const todayPanchanga = computePanchanga(
      now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(),
      params.lat, params.lon, params.utcOffset, ayanamshaType, customAyanamshaBase
    );
    const taraBala = computeTaraBala(natalMoonNakIdx, todayPanchanga.nakshatraOfDayIdx);
    if (NOTABLE_TARA_QUALITIES.includes(taraBala.quality)) {
      messages.push(`📅 Сегодня тара-бала «${taraBala.name}» — день ${taraBala.quality}.`);
    }
    newState.lastTaraNotifiedDate = todayISO;
  }

  // 3. Новые заметные транзиты (сравниваем с тем, что было отмечено вчера)
  const transits = computeCurrentTransits(chart, now);
  const sensitivePoints = [
    { key: 'Асцендент', house: 1 },
    { key: 'натальную Луну', house: chart.planets['Луна'].house },
    { key: 'натальное Солнце', house: chart.planets['Солнце'].house },
  ];
  if (chain && chain.antardasha && chart.planets[chain.antardasha.lord]) {
    sensitivePoints.push({ key: `лорда антардаши (${chain.antardasha.lord})`, house: chart.planets[chain.antardasha.lord].house });
  }
  const currentNotable = [];
  for (const [planetName, t] of Object.entries(transits.planets)) {
    const hits = sensitivePoints.filter(sp => sp.house === t.transitHouse).map(sp => sp.key);
    if (hits.length > 0) currentNotable.push(`${planetName} → ${hits.join(', ')}`);
  }
  const prevNotableSet = new Set(prevState.notableTransits || []);
  const freshOnes = currentNotable.filter(n => !prevNotableSet.has(n));
  if (freshOnes.length > 0) {
    messages.push(`🌓 Новый заметный транзит: ${freshOnes.join('; ')}.`);
  }
  newState.notableTransits = currentNotable;

  return { messages, newState };
}

async function runDailyCheck(bot) {
  const users = db.listNotifiableUsers();
  for (const u of users) {
    try {
      const userSettings = db.getUser(u.telegramId);
      const { messages, newState } = buildNotificationsForUser(u.chart, u.notifyState, userSettings);
      if (messages.length > 0) {
        const text = `✨ ${u.chart.label}\n\n` + messages.join('\n\n');
        await sendMessageWithBackoff(bot, u.telegramId, text);
      }
      db.saveNotifyState(u.telegramId, newState);
    } catch (e) {
      console.error(`Ошибка уведомления для ${u.telegramId}:`, e);
    }
    await new Promise(r => setTimeout(r, 50)); // не упираемся в лимиты Telegram
  }
}

/**
 * Утреннее сообщение: каждому пользователю в его время по его местному часовому поясу.
 * Отправляется в течение 3 часов после выбранного времени (если сервер перезапускался),
 * и ровно один раз за местную дату (запись в notify_sent).
 */
async function sendMorningFor(bot, u, now, force) {
  const userSettings = db.getUser(u.telegramId);
  const prefs = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
  if (!prefs.morning.enabled && !force) return false;
  const place = effectivePlace(u.chart, db.getUserPlace(u.telegramId));
  const lp = localDateParts(now, place.utcOffset);
  const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  if (!force) {
    const [hh, mm] = prefs.morning.time.split(':').map(Number);
    const minutesNow = lp.hh * 60 + lp.mm, due = hh * 60 + mm;
    if (minutesNow < due || minutesNow > due + 180) return false;
    if (db.wasNotifySent(u.telegramId, 'morning', dateKey)) return false;
  }
  const msg = buildMorningMessage(u.chart, userSettings, db.getUserPlace(u.telegramId), prefs, now);
  if (!force) db.markNotifySent(u.telegramId, 'morning', dateKey);
  if (!msg) return false;
  const extra = process.env.WEBAPP_URL
    ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: process.env.WEBAPP_URL } }]] } }
    : undefined;
  await sendMessageWithBackoff(bot, u.telegramId, msg.text, extra);
  return true;
}

/** «Моя неделя»: в выбранный день недели и время (по местному времени), раз в неделю. */
async function sendWeeklyFor(bot, u, now, force) {
  const userSettings = db.getUser(u.telegramId);
  const prefs = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
  if (!prefs.weekly.enabled && !force) return false;
  const place = effectivePlace(u.chart, db.getUserPlace(u.telegramId));
  const lp = localDateParts(now, place.utcOffset);
  const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  if (!force) {
    const weekday = new Date(Date.UTC(lp.y, lp.m - 1, lp.d)).getUTCDay();
    if (weekday !== prefs.weekly.weekday) return false;
    const [hh, mm] = prefs.weekly.time.split(':').map(Number);
    const minutesNow = lp.hh * 60 + lp.mm, due = hh * 60 + mm;
    if (minutesNow < due || minutesNow > due + 180) return false;
    if (db.wasNotifySent(u.telegramId, 'weekly', dateKey)) return false;
  }
  const msg = buildWeeklyMessage(u.chart, userSettings, db.getUserPlace(u.telegramId), prefs, now);
  if (!force) db.markNotifySent(u.telegramId, 'weekly', dateKey);
  if (!msg) return false;
  const extra = process.env.WEBAPP_URL
    ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: process.env.WEBAPP_URL } }]] } }
    : undefined;
  await sendMessageWithBackoff(bot, u.telegramId, msg.text, extra);
  return true;
}

/** Предупреждение накануне о подходящем дне для дел из «Моих дел». */
async function sendWatchAlertFor(bot, u, now, force) {
  const userSettings = db.getUser(u.telegramId);
  const prefs = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
  if (!prefs.watchAlert.enabled && !force) return false;
  if (!prefs.watch.length) return false;
  const userPlace = db.getUserPlace(u.telegramId);
  const place = effectivePlace(u.chart, userPlace);
  const lp = localDateParts(now, place.utcOffset);
  const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  if (!force) {
    const [hh, mm] = prefs.watchAlert.time.split(':').map(Number);
    const minutesNow = lp.hh * 60 + lp.mm, due = hh * 60 + mm;
    if (minutesNow < due || minutesNow > due + 180) return false;
    if (db.wasNotifySent(u.telegramId, 'watch', dateKey)) return false;
  }
  const msg = buildWatchAlertMessage(u.chart, userSettings, userPlace, prefs, now);
  if (!force) db.markNotifySent(u.telegramId, 'watch', dateKey);
  if (!msg) return false;
  const extra = process.env.WEBAPP_URL
    ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: process.env.WEBAPP_URL } }]] } }
    : undefined;
  await sendMessageWithBackoff(bot, u.telegramId, msg.text, extra);
  return true;
}

/** Пример сообщения о смене дня (для проверки): ближайшая к текущему моменту смена, иначе пояснение. */
async function sendIntradaySample(bot, u, now) {
  const trans = intradayTransitions(u.telegramId, u.chart, db.getUser(u.telegramId), db.getUserPlace(u.telegramId), now)
    .filter((t) => t.tone !== 'moderate');
  const nowJD = now.getTime() / 86400000 + 2440587.5;
  let pick = null;
  for (const t of trans) if (!pick || Math.abs(t.atJD - nowJD) < Math.abs(pick.atJD - nowJD)) pick = t;
  const text = pick ? intradayText(pick, 0) : 'Сегодня оценка дня не меняется, сообщения о смене не будет.';
  await sendMessageWithBackoff(bot, u.telegramId, text);
  return true;
}

/** Вечернее сообщение: в выбранное время (по умолчанию выключено). */
async function sendEveningFor(bot, u, now, force) {
  const userSettings = db.getUser(u.telegramId);
  const prefs = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
  if (!prefs.evening.enabled && !force) return false;
  const userPlace = db.getUserPlace(u.telegramId);
  const place = effectivePlace(u.chart, userPlace);
  const lp = localDateParts(now, place.utcOffset);
  const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  if (!force) {
    const [hh, mm] = prefs.evening.time.split(':').map(Number);
    const minutesNow = lp.hh * 60 + lp.mm, due = hh * 60 + mm;
    if (minutesNow < due || minutesNow > due + 180) return false;
    if (db.wasNotifySent(u.telegramId, 'evening', dateKey)) return false;
  }
  const msg = buildEveningMessage(u.chart, userSettings, userPlace, prefs, now, (k) => db.wasNotifySent(u.telegramId, 'warn', k));
  if (!force) db.markNotifySent(u.telegramId, 'evening', dateKey);
  if (!msg) return false;
  const extra = process.env.WEBAPP_URL
    ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: process.env.WEBAPP_URL } }]] } }
    : undefined;
  await sendMessageWithBackoff(bot, u.telegramId, msg.text, extra);
  if (!force) msg.keys.forEach((k) => db.markNotifySent(u.telegramId, 'warn', k));
  return true;
}

/** Смена оценки внутри дня: в момент смены (или за lead минут), не в тихие часы, не больше maxPerDay в день. */
async function sendIntradayFor(bot, u, now) {
  const prefs = normalizePrefs(db.getNotifyPrefsRaw(u.telegramId));
  if (!prefs.intraday.enabled) return 0;
  const userPlace = db.getUserPlace(u.telegramId);
  const place = effectivePlace(u.chart, userPlace);
  const lp = localDateParts(now, place.utcOffset);
  if (inQuiet(prefs.quiet, lp.hh, lp.mm)) return 0;
  const dateKey = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  const trans = intradayTransitions(u.telegramId, u.chart, db.getUser(u.telegramId), userPlace, now);
  const nowJD = now.getTime() / 86400000 + 2440587.5;
  const lead = prefs.intraday.lead / 1440;
  let sent = 0;
  for (const t of trans) {
    if (t.tone === 'bad' && !prefs.intraday.toBad) continue;
    if (t.tone === 'good' && !prefs.intraday.toGood) continue;
    if (t.tone === 'moderate') continue; // смену на «нейтрально» не отправляем
    // окно отправки: от (момент − lead) до 20 минут после момента
    if (nowJD < t.atJD - lead || nowJD > t.atJD + 20 / 1440) continue;
    const key = `${dateKey}|${Math.round(t.atJD * 1440)}`;
    if (db.wasNotifySent(u.telegramId, 'intraday', key)) continue;
    if (db.countNotifySent(u.telegramId, 'intraday', dateKey + '|') >= prefs.intraday.maxPerDay) break;
    db.markNotifySent(u.telegramId, 'intraday', key);
    const extra = process.env.WEBAPP_URL
      ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: process.env.WEBAPP_URL } }]] } }
      : undefined;
    await sendMessageWithBackoff(bot, u.telegramId, intradayText(t, prefs.intraday.lead), extra);
    sent++;
  }
  return sent;
}

async function runMorningCheck(bot, force, onlyTelegramId) {
  const users = db.listNotifiableUsers().filter((u) => !onlyTelegramId || u.telegramId === onlyTelegramId);
  const now = new Date();
  for (const u of users) {
    try {
      await sendMorningFor(bot, u, now, force);
    } catch (e) {
      console.error(`Ошибка утреннего уведомления для ${u.telegramId}:`, e);
    }
    try {
      await sendWatchAlertFor(bot, u, now, force && !!onlyTelegramId);
    } catch (e) {
      console.error(`Ошибка предупреждения по делам для ${u.telegramId}:`, e);
    }
    try {
      await sendEveningFor(bot, u, now, force && !!onlyTelegramId);
    } catch (e) {
      console.error(`Ошибка вечернего уведомления для ${u.telegramId}:`, e);
    }
    try {
      if (!force) await sendIntradayFor(bot, u, now);
    } catch (e) {
      console.error(`Ошибка уведомления о смене дня для ${u.telegramId}:`, e);
    }
    try {
      await sendWeeklyFor(bot, u, now, force && !!onlyTelegramId);
    } catch (e) {
      console.error(`Ошибка недельного уведомления для ${u.telegramId}:`, e);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Простой планировщик без внешних зависимостей: раз в 15 минут проверяет,
// не наступил ли час запуска (по умолчанию 8:00 UTC+3 — примерно раннее
// утро для большинства пользователей из РФ) и не запускались ли мы уже сегодня.
function startNotificationScheduler(bot, { hourUTC = 5, checkIntervalMs = 60 * 1000 } = {}) {
  
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const todayISO = now.toISOString().slice(0, 10);
      // личные уведомления: утреннее — каждому в его местное время
      await runMorningCheck(bot, false);
      // лунный календарь (бесплатная подписка) — каждому в 8:00 по его местному времени
      await runRitualDailyCheck(bot, false);
    } catch (e) {
      console.error('Сбой в планировщике уведомлений:', e);
    } finally {
      busy = false;
    }
  }, checkIntervalMs);
}

module.exports = { sendWatchAlertFor, sendIntradaySample, sendEveningFor, sendIntradayFor, runMorningCheck, sendMorningFor, sendWeeklyFor, runDailyCheck, startNotificationScheduler, buildNotificationsForUser, runRitualDailyCheck, buildRitualNotificationForToday };
