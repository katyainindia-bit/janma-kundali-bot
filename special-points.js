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

const { jdFromDate, ascendantSidereal, nakshatraOf, sunLongitude, moonLongitude, lahiriAyanamsha, ramanAyanamsha, krishnamurtiAyanamsha } = require('./engine.js');
const { sunriseSunsetMinutesUTC } = require('./panchanga.js');

// Восход/закат: высота центра Солнца над горизонтом в момент события.
// upper — верхний край диска с рефракцией (стандарт); center — центр диска на линии горизонта, без рефракции; lower — нижний край диска на горизонте.
const SUN_ALT = { upper: -0.8333, center: 0, lower: 0.2667 };
function sunAltitude(opts) { return (opts && SUN_ALT[opts.sunrise] != null) ? SUN_ALT[opts.sunrise] : SUN_ALT.upper; }
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
function specialLagnas(year, month, day, hour, minute, second, utcOffset, lat, lon, ayanamshaType, customAyanamshaBase, opts) {
  const dateUTCNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const sunTimes = sunriseSunsetMinutesUTC(dateUTCNoon, lat, lon, sunAltitude(opts));
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


/**
 * Гулика и Манди (Парашара): день (восход–закат) и ночь (закат–восход) делятся на 8 долей.
 * Днём доли идут от управителя дня недели, ночью — от пятого по счёту от него; восьмая доля без управителя.
 * Гулика = асцендент в НАЧАЛЕ доли Сатурна, Манди = асцендент в СЕРЕДИНЕ доли Сатурна.
 * День недели — по восходу (до восхода идёт предыдущий день).
 */
function gulikaMandi(year, month, day, hour, minute, second, utcOffset, lat, lon, ayanamshaType, customAyanamshaBase, opts) {
  const jdEvent = jdFromDate(year, month, day, hour, minute, second, utcOffset);
  const dayInfo = (off) => {
    const d = new Date(Date.UTC(year, month - 1, day + off, 12, 0, 0));
    const t = sunriseSunsetMinutesUTC(d, lat, lon, sunAltitude(opts));
    if (t.polarNight || t.polarDay) return null;
    const base = jdFromDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, 0, 0);
    return { rise: base + t.sunriseUTC / 1440, set: base + t.sunsetUTC / 1440, dow: d.getUTCDay() };
  };
  const days = {};
  for (const o of [-1, 0, 1, 2]) { days[o] = dayInfo(o); if (!days[o]) return null; }
  let part = null;
  for (const o of [-1, 0, 1]) {
    const a = days[o], b = days[o + 1];
    if (jdEvent >= a.rise && jdEvent < a.set) { part = { from: a.rise, to: a.set, dow: a.dow, night: false }; break; }
    if (jdEvent >= a.set && jdEvent < b.rise) { part = { from: a.set, to: b.rise, dow: a.dow, night: true }; break; }
  }
  if (!part) return null;
  // Порядок управителей по дням недели: Солнце, Луна, Марс, Меркурий, Юпитер, Венера, Сатурн (Сатурн = 6)
  const first = part.night ? (part.dow + 4) % 7 : part.dow;
  const j = (6 - first + 7) % 7; // номер доли Сатурна (0..6)
  const len = (part.to - part.from) / 8;
  const startJD = part.from + len * j;
  const midJD = startJD + len / 2;
  const asc = (jd) => ascendantSidereal(jd, lat, lon, ayanamshaType || 'lahiri', customAyanamshaBase);
  const withNak = (lon) => Object.assign(formatSignResult(lon), { nakshatra: nakshatraOf(lon) });
  // По умолчанию: Гулика в начале доли Сатурна, Манди в середине. Вариант 'mandi_start' — наоборот.
  const swap = opts && opts.gulikaMandi === 'mandi_start';
  return { gulika: withNak(asc(swap ? midJD : startJD)), mandi: withNak(asc(swap ? startJD : midJD)) };
}

module.exports = { bhriguBindu, specialLagnas, gulikaMandi };
