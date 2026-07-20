// ============================================================
// Panchanga calculator — титхи, накшатра дня, нитья-йога, карана, вара,
// восход/закат и деление дня на 8 частей (Раху-калам, Ямаганда, Гулика-калам).
// ============================================================

const { jdFromDate, sunLongitude, moonLongitude } = require('./engine.js');

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function pmod(x, y) {
  let r = x % y;
  if (r < 0) r += y;
  return r;
}

// Средний наклон эклиптики (та же формула, что используется в engine.js для Асцендента)
function meanObliquity(jd) {
  const T = (jd - 2451545.0) / 36525;
  return (23.4392911 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T);
}

// Солнечное склонение из эклиптической долготы (широта Солнца принимается за 0)
function sunDeclination(jd) {
  const sunLon = sunLongitude(jd) * D2R;
  const eps = meanObliquity(jd) * D2R;
  return Math.asin(Math.sin(eps) * Math.sin(sunLon)) * R2D;
}

// Уравнение времени (приближённая формула, точность ~1 минута — достаточно для панчанги)
function equationOfTimeMinutes(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000) + 1;
  const B = (360 / 365) * (dayOfYear - 81) * D2R;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/**
 * Восход и закат Солнца (в минутах от полуночи UTC) для заданной календарной даты и места.
 * Возвращает { sunriseUTC, sunsetUTC } в минутах от 00:00 UTC того дня.
 */
function sunriseSunsetMinutesUTC(dateUTCNoon, lat, lon) {
  const jd = jdFromDate(
    dateUTCNoon.getUTCFullYear(), dateUTCNoon.getUTCMonth() + 1, dateUTCNoon.getUTCDate(),
    12, 0, 0, 0
  );
  const decl = sunDeclination(jd) * D2R;
  const latRad = lat * D2R;

  // -0.8333° — стандартная поправка на атмосферную рефракцию и видимый радиус солнечного диска
  const cosH0 = (Math.sin(-0.8333 * D2R) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));

  if (cosH0 > 1) return { polarNight: true };
  if (cosH0 < -1) return { polarDay: true };

  const H0 = Math.acos(cosH0) * R2D; // градусы, половина дуги дня
  const eot = equationOfTimeMinutes(dateUTCNoon);

  const solarNoonUTCmin = 720 - 4 * lon - eot; // минуты от 00:00 UTC
  const sunriseUTC = solarNoonUTCmin - 4 * H0;
  const sunsetUTC = solarNoonUTCmin + 4 * H0;

  return { sunriseUTC, sunsetUTC, solarNoonUTCmin };
}

function minutesToLocalHHMM(minutesUTC, utcOffsetHours) {
  let localMin = minutesUTC + utcOffsetHours * 60;
  localMin = ((localMin % 1440) + 1440) % 1440;
  const h = Math.floor(localMin / 60);
  const m = Math.round(localMin % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- Титхи (30 названий) ---
const TITHI_NAMES = [
  'Пратипада','Двития','Тритья','Чатуртхи','Панчами','Шаштхи','Саптами','Аштами',
  'Навами','Дашами','Экадаши','Двадаши','Трайодаши','Чатурдаши','Пурнима',
  'Пратипада','Двития','Тритья','Чатуртхи','Панчами','Шаштхи','Саптами','Аштами',
  'Навами','Дашами','Экадаши','Двадаши','Трайодаши','Чатурдаши','Амавасья'
];

function computeTithi(sunLon, moonLon) {
  const elong = pmod(moonLon - sunLon, 360);
  const idx = Math.floor(elong / 12); // 0-29
  const paksha = idx < 15 ? 'Шукла (растущая)' : 'Кришна (убывающая)';
  const percentComplete = ((elong % 12) / 12) * 100;
  return { name: TITHI_NAMES[idx], number: idx + 1, paksha, percentComplete };
}

// --- Нитья-йога (27 названий) ---
const YOGA_NAMES = [
  'Вишкамбха','Прити','Аюшман','Саубхагья','Шобхана','Атиганда','Сукарма','Дхрити',
  'Шула','Ганда','Вриддхи','Дхрува','Вьягхата','Харшана','Ваджра','Сиддхи',
  'Вьятипата','Варияна','Паригха','Шива','Сиддха','Садхья','Шубха','Шукла',
  'Брахма','Индра','Вайдхрити'
];

function computeNityaYoga(sunLon, moonLon) {
  const sum = pmod(sunLon + moonLon, 360);
  const span = 360 / 27;
  const idx = Math.floor(sum / span);
  return { name: YOGA_NAMES[idx], number: idx + 1 };
}

// --- Карана (11 названий: 7 подвижных + 4 фиксированных) ---
const CHARA_KARANAS = ['Бава','Балава','Каулава','Тайтила','Гара','Ванидж','Вишти'];
const FIXED_KARANAS = { 1: 'Кимстугхна', 58: 'Шакуни', 59: 'Чатушпада', 60: 'Нага' };

function computeKarana(sunLon, moonLon) {
  const elong = pmod(moonLon - sunLon, 360);
  const karanaIdx = Math.floor(elong / 6) + 1; // 1-60
  if (FIXED_KARANAS[karanaIdx]) {
    return { name: FIXED_KARANAS[karanaIdx], number: karanaIdx };
  }
  const charaIdx = (karanaIdx - 2) % 7;
  return { name: CHARA_KARANAS[charaIdx], number: karanaIdx };
}

// --- Вара (день недели, ведийское название через владыку) ---
const VARA_NAMES = ['Равивара (воскресенье, Солнце)', 'Сомавара (понедельник, Луна)', 'Мангалавара (вторник, Марс)',
  'Будхавара (среда, Меркурий)', 'Гуруvara (четверг, Юпитер)', 'Шукравара (пятница, Венера)', 'Шанивара (суббота, Сатурн)'];
// исправление опечатки Guru
VARA_NAMES[4] = 'Гурувара (четверг, Юпитер)';

function computeVara(date) {
  return VARA_NAMES[date.getUTCDay()];
}

// --- Раху-калам / Ямаганда / Гулика-калам: деление дня (восход-закат) на 8 равных частей ---
// Стандартные таблицы номеров сегмента (1-8) по дню недели (0=вс..6=сб)
const RAHU_KALAM_SEGMENT = [8, 2, 7, 5, 6, 4, 3];
const YAMAGANDA_SEGMENT = [5, 4, 3, 2, 1, 7, 6];
const GULIKA_KALAM_SEGMENT = [7, 6, 5, 4, 3, 2, 1];

function segmentToTimeRange(segmentNum, sunriseUTC, sunsetUTC, utcOffset) {
  const dayLen = sunsetUTC - sunriseUTC;
  const segLen = dayLen / 8;
  const startUTC = sunriseUTC + (segmentNum - 1) * segLen;
  const endUTC = sunriseUTC + segmentNum * segLen;
  return {
    start: minutesToLocalHHMM(startUTC, utcOffset),
    end: minutesToLocalHHMM(endUTC, utcOffset),
  };
}

/**
 * Полный расчёт панчанги на заданную календарную дату (местную) и место.
 * @param {number} year, month, day - календарная дата (местная)
 * @param {number} lat, lon - координаты места
 * @param {number} utcOffset - часовой пояс места (часы от UTC)
 */
function computePanchanga(year, month, day, lat, lon, utcOffset) {
  // Момент "полудня" этой даты в UTC — используется для дневных величин (титхи, накшатра, йога, карана)
  const noonUTCms = Date.UTC(year, month - 1, day, 12, 0, 0) - utcOffset * 3600 * 1000;
  const noonDate = new Date(noonUTCms);
  const jd = jdFromDate(year, month, day, 12, 0, 0, utcOffset);

  const sunLon = sunLongitude(jd);
  const moonLon = moonLongitude(jd);

  const tithi = computeTithi(sunLon, moonLon);
  const yoga = computeNityaYoga(sunLon, moonLon);
  const karana = computeKarana(sunLon, moonLon);
  const vara = computeVara(new Date(Date.UTC(year, month - 1, day)));

  const nakSpan = 360 / 27;
  const moonNakIdx = Math.floor(moonLon / nakSpan); // тропическая, без аянамши — для панчанги традиционно тоже сидерическая накшатра Луны
  // Для накшатры дня традиционно используют сидерическую позицию Луны (как и в натальной карте)
  const { lahiriAyanamsha } = require('./engine.js');
  const ayanamsha = lahiriAyanamsha(jd);
  const moonSidereal = pmod(moonLon - ayanamsha, 360);
  const moonNakSiderealIdx = Math.floor(moonSidereal / nakSpan);

  const NAKSHATRAS = [
    'Ашвини','Бхарани','Криттика','Рохини','Мригашира','Ардра','Пунарвасу','Пушья','Ашлеша',
    'Магха','Пурва Пхалгуни','Уттара Пхалгуни','Хаста','Читра','Свати','Вишакха','Анурадха','Джьештха',
    'Мула','Пурва Ашадха','Уттара Ашадха','Шравана','Дханишта','Шатабхиша','Пурва Бхадрапада','Уттара Бхадрапада','Ревати'
  ];
  const nakshatraOfDay = NAKSHATRAS[moonNakSiderealIdx];

  const sunTimes = sunriseSunsetMinutesUTC(noonDate, lat, lon);
  if (sunTimes.polarNight || sunTimes.polarDay) {
    return {
      date: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`,
      vara, tithi, yoga, karana, nakshatraOfDay, nakshatraOfDayIdx: moonNakSiderealIdx,
      sunError: sunTimes.polarNight ? 'Полярная ночь — восход не наступает' : 'Полярный день — заход не наступает',
    };
  }

  const sunriseLocal = minutesToLocalHHMM(sunTimes.sunriseUTC, utcOffset);
  const sunsetLocal = minutesToLocalHHMM(sunTimes.sunsetUTC, utcOffset);

  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const rahuKalam = segmentToTimeRange(RAHU_KALAM_SEGMENT[dow], sunTimes.sunriseUTC, sunTimes.sunsetUTC, utcOffset);
  const yamaganda = segmentToTimeRange(YAMAGANDA_SEGMENT[dow], sunTimes.sunriseUTC, sunTimes.sunsetUTC, utcOffset);
  const gulikaKalam = segmentToTimeRange(GULIKA_KALAM_SEGMENT[dow], sunTimes.sunriseUTC, sunTimes.sunsetUTC, utcOffset);

  return {
    date: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`,
    vara, tithi, yoga, karana, nakshatraOfDay, nakshatraOfDayIdx: moonNakSiderealIdx,
    sunrise: sunriseLocal, sunset: sunsetLocal,
    rahuKalam, yamaganda, gulikaKalam,
  };
}

// --- Тара-бала: персональная ежедневная оценка от натальной накшатры Луны ---
const TARA_NAMES = [
  { name: 'Джанма', quality: 'нейтрально' },
  { name: 'Сампат', quality: 'благоприятно' },
  { name: 'Випат', quality: 'неблагоприятно' },
  { name: 'Кшема', quality: 'благоприятно' },
  { name: 'Пратьяк', quality: 'неблагоприятно' },
  { name: 'Садхана', quality: 'благоприятно' },
  { name: 'Наидхана', quality: 'наименее благоприятно' },
  { name: 'Митра', quality: 'благоприятно' },
  { name: 'Парама Митра', quality: 'наиболее благоприятно' },
];

/**
 * Тара-бала: считает расстояние (в накшатрах) от натальной накшатры Луны
 * до накшатры дня, определяет одну из 9 категорий ("тара").
 * @param {number} natalMoonNakshatraIdx - индекс накшатры Луны в натальной карте (0-26)
 * @param {number} dayNakshatraIdx - индекс накшатры дня (0-26)
 */
function computeTaraBala(natalMoonNakshatraIdx, dayNakshatraIdx) {
  const count = pmod(dayNakshatraIdx - natalMoonNakshatraIdx, 27) + 1; // 1-27
  const taraIdx = pmod(count - 1, 9); // 0-8
  return { count, ...TARA_NAMES[taraIdx] };
}

module.exports = { computePanchanga, computeTaraBala };
