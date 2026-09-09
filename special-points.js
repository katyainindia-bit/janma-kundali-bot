// ============================================================
// Бхригу-бинду и специальные лагны (Бхава/Хора/Гхати)
// Формулы проверены по нескольким независимым, полностью
// согласующимся друг с другом источникам (не по одной догадке):
// - Хора-лагна и Гхати-лагна: 1 раши на хору/гхати соответственно,
//   от долготы Солнца в момент восхода.
// - Бхава-лагна: 1 раши за 5 гхати (=2 часа) — та же логика.
// Оба файла (engine.js и panchanga.js) уже зависят друг от друга
// однонаправленно (panchanga.js импортирует из engine.js) — чтобы
// не создавать циклическую зависимость, этот модуль подключает
// оба отдельно, сам не являясь зависимостью ни для одного из них.
// ============================================================

const { jdFromDate, sunLongitude, moonLongitude, lahiriAyanamsha, ramanAyanamsha, krishnamurtiAyanamsha } = require('./engine.js');
const { sunriseSunsetMinutesUTC } = require('./panchanga.js');

function pmod(x, m) { return ((x % m) + m) % m; }

function ayanamshaByType(jd, ayanamshaType, customAyanamshaBase) {
  if (ayanamshaType === 'tropical') return 0;
  if (ayanamshaType === 'raman') return ramanAyanamsha(jd);
  if (ayanamshaType === 'krishnamurti') return krishnamurtiAyanamsha(jd);
  if (ayanamshaType === 'custom' && customAyanamshaBase != null) {
    // Та же прецессионная модель, что и в engine.js — здесь минимально
    // продублирована формула для случая произвольной аянамши, чтобы не
    // создавать лишнюю связь между файлами ради одной строки.
    const T = (jd - 2451545.0) / 36525;
    const pA = 5029.0966 * T + 1.11113 * T * T - 0.000006 * T * T * T;
    return customAyanamshaBase + pA / 3600;
  }
  return lahiriAyanamsha(jd);
}

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const SIGN_LORDS = ['Мангал','Шукра','Буддха','Чандра','Сурья','Буддха','Шукра','Мангал','Гуру','Шани','Шани','Гуру'];
function formatSignResult(lon) {
  const index = Math.floor(lon / 30);
  return { siderealLon: lon, sign: { name: SIGN_NAMES[index], index, lord: SIGN_LORDS[index], degInSign: lon - index * 30 } };
}

/**
 * Бхригу-бинду — середина между Луной и Раху, по КОРОТКОЙ дуге между ними
 * (у середины двух точек на окружности всегда два кандидата, 180° друг от
 * друга — берём тот, что ближе).
 */
function bhriguBindu(moonSidLon, rahuSidLon) {
  let diff = pmod(rahuSidLon - moonSidLon, 360);
  let mid = diff <= 180 ? pmod(moonSidLon + diff / 2, 360) : pmod(rahuSidLon + (360 - diff) / 2, 360);
  return formatSignResult(mid);
}

/**
 * Специальные лагны (Бхава/Хора/Гхати) — все три считаются от сидерической
 * долготы Солнца В МОМЕНТ ВОСХОДА в день события, плюс поправка на время,
 * прошедшее от восхода до самого момента, с разной скоростью для каждой.
 */
function specialLagnas(year, month, day, hour, minute, second, utcOffset, lat, lon, ayanamshaType, customAyanamshaBase) {
  const dateUTCNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const sunTimes = sunriseSunsetMinutesUTC(dateUTCNoon, lat, lon);
  if (sunTimes.polarNight || sunTimes.polarDay) return null; // за полярным кругом восхода может не быть

  const jdEvent = jdFromDate(year, month, day, hour, minute, second, utcOffset);

  // Долгота Солнца ровно в момент восхода (сидерическая, той же аянамшей)
  const jdSunriseUTC = jdFromDate(year, month, day, 0, 0, 0, 0) + sunTimes.sunriseUTC / 1440;
  const sunAtSunriseSid = pmod(sunLongitude(jdSunriseUTC) - ayanamshaByType(jdSunriseUTC, ayanamshaType, customAyanamshaBase), 360);

  // Минуты от восхода до момента события (тот же календарный день; если
  // время события раньше восхода — значит, речь о предыдущих суточных
  // сутках относительно восхода, поправка не требуется для целей этого
  // расчёта — берём как есть, отрицательные значения корректно уйдут
  // через pmod ниже).
  const eventUTCmin = (jdEvent - jdFromDate(year, month, day, 0, 0, 0, 0)) * 1440;
  const elapsedMin = eventUTCmin - sunTimes.sunriseUTC;

  const ghatiLagna = pmod(sunAtSunriseSid + elapsedMin * 1.25, 360);   // 30° за 24 мин
  const horaLagna = pmod(sunAtSunriseSid + elapsedMin * 0.5, 360);    // 30° за 60 мин
  const bhavaLagna = pmod(sunAtSunriseSid + elapsedMin * 0.25, 360);   // 30° за 120 мин

  return { ghatiLagna: formatSignResult(ghatiLagna), horaLagna: formatSignResult(horaLagna), bhavaLagna: formatSignResult(bhavaLagna) };
}

module.exports = { bhriguBindu, specialLagnas };
