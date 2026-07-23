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

const NOTABLE_TARA_QUALITIES = ['наиболее благоприятно', 'неблагоприятно', 'наименее благоприятно'];

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
function buildNotificationsForUser(chartRow, prevState) {
  const params = chartParamsFromRow(chartRow);
  const chart = calculateChart({ ...params, second: 0, ayanamshaType: 'lahiri' });
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
      params.lat, params.lon, params.utcOffset
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
      const { messages, newState } = buildNotificationsForUser(u.chart, u.notifyState);
      if (messages.length > 0) {
        const text = `✨ ${u.chart.label}\n\n` + messages.join('\n\n');
        await bot.telegram.sendMessage(u.telegramId, text);
      }
      db.saveNotifyState(u.telegramId, newState);
    } catch (e) {
      console.error(`Ошибка уведомления для ${u.telegramId}:`, e);
    }
    await new Promise(r => setTimeout(r, 50)); // не упираемся в лимиты Telegram
  }
}

// Простой планировщик без внешних зависимостей: раз в 15 минут проверяет,
// не наступил ли час запуска (по умолчанию 8:00 UTC+3 — примерно раннее
// утро для большинства пользователей из РФ) и не запускались ли мы уже сегодня.
function startNotificationScheduler(bot, { hourUTC = 5, checkIntervalMs = 15 * 60 * 1000 } = {}) {
  let lastRunDate = null;
  setInterval(async () => {
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === hourUTC && lastRunDate !== todayISO) {
      lastRunDate = todayISO;
      console.log('Запуск ежедневной проверки уведомлений...');
      await runDailyCheck(bot);
      console.log('Проверка уведомлений завершена.');
    }
  }, checkIntervalMs);
}

module.exports = { runDailyCheck, startNotificationScheduler, buildNotificationsForUser };
