// ============================================================
// transit-forecast.js — «до какого числа» для заметных транзитов:
// когда транзитная планета покинет текущий знак (= сменит дом, т.к.
// дома здесь целиком по знакам).
//
// Метод сканирования тот же, что в sade-sati.js — сканируем вперёд с
// шагом, а не по дням, но здесь шаг и диапазон подобраны ОТДЕЛЬНО под
// каждую планету, потому что скорости различаются на порядки (Луна
// ~2 дня на знак, Сатурн ~2.5 года) — единый шаг был бы либо слишком
// грубым для быстрых планет, либо расточительным по числу итераций
// для медленных. Марс/Меркурий/Венера — с запасом на ретроградность
// (в ретрограде планета может задержаться в знаке намного дольше обычного).
// ============================================================

const { calculateChart } = require('./engine.js');

const SIGN_SCAN_SETTINGS = {
  'Луна': { step: 1, maxDays: 35 },
  'Солнце': { step: 2, maxDays: 35 },
  'Меркурий': { step: 2, maxDays: 150 },
  'Венера': { step: 3, maxDays: 220 },
  'Марс': { step: 3, maxDays: 260 },
  'Юпитер': { step: 15, maxDays: 450 },
  'Сатурн': { step: 20, maxDays: 1000 },
  'Раху': { step: 20, maxDays: 700 },
  'Кету': { step: 20, maxDays: 700 },
};

function planetSignIndexAt(planetName, date, lat, lon, utcOffset) {
  const chart = calculateChart({
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: 0,
    lat, lon, utcOffset, ayanamshaType: 'lahiri',
  });
  return chart.planets[planetName].sign.index;
}

/**
 * Ищет дату, когда транзитная планета покинет текущий знак.
 * Возвращает { daysAhead, date } либо null, если в пределах разумного
 * диапазона сканирования смены знака не произошло (не ошибка — просто
 * планета ещё долго будет в этом знаке дольше, чем мы сканируем).
 */
function findSignExitDate(planetName, now, lat, lon, utcOffset) {
  const settings = SIGN_SCAN_SETTINGS[planetName];
  if (!settings) return null;
  const currentSign = planetSignIndexAt(planetName, now, lat, lon, utcOffset);
  const dayMs = 24 * 3600 * 1000;
  for (let d = settings.step; d <= settings.maxDays; d += settings.step) {
    const checkDate = new Date(now.getTime() + d * dayMs);
    const signAtCheck = planetSignIndexAt(planetName, checkDate, lat, lon, utcOffset);
    if (signAtCheck !== currentSign) {
      return { daysAhead: d, date: checkDate.toISOString().slice(0, 10) };
    }
  }
  return null;
}

module.exports = { findSignExitDate };
