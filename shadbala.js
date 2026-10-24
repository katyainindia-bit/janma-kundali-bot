// ============================================================
// Шадбала по Парашаре (Брихат Парашара Хора Шастра), семь планет.
// Единицы: виринды (вирупы, 60 вирупа = 1 рупа). Раху и Кету не участвуют.
// Применённые методы перечислены в поле methods — они показываются в приложении.
// Юддха-бала учитывается при планетной войне.
// ============================================================
const { sunLongitude, ayanamshaFor, jdFromDate } = require('./engine.js');
const { sunriseSunsetMinutesUTC } = require('./panchanga.js');
const { navamshaPosition } = require('./navamsha.js');
const dc = require('./divisional-charts.js');
let Astronomy = null;
try { Astronomy = require('astronomy-engine'); } catch (e) { Astronomy = null; }

const PL = ['Солнце', 'Луна', 'Марс', 'Меркурий', 'Юпитер', 'Венера', 'Сатурн'];
const SIGN_LORDS = ['Марс', 'Венера', 'Меркурий', 'Луна', 'Солнце', 'Меркурий', 'Венера', 'Марс', 'Юпитер', 'Сатурн', 'Сатурн', 'Юпитер'];
const pmod = (x, n) => ((x % n) + n) % n;
const fold180 = (x) => { const d = pmod(x, 360); return d > 180 ? 360 - d : d; };

const FRIENDS = {
  Солнце: { f: ['Луна', 'Марс', 'Юпитер'], e: ['Венера', 'Сатурн'] },
  Луна: { f: ['Солнце', 'Меркурий'], e: [] },
  Марс: { f: ['Солнце', 'Луна', 'Юпитер'], e: ['Меркурий'] },
  Меркурий: { f: ['Солнце', 'Венера'], e: ['Луна'] },
  Юпитер: { f: ['Солнце', 'Луна', 'Марс'], e: ['Меркурий', 'Венера'] },
  Венера: { f: ['Меркурий', 'Сатурн'], e: ['Солнце', 'Луна'] },
  Сатурн: { f: ['Меркурий', 'Венера'], e: ['Солнце', 'Луна', 'Марс'] },
};
// Точки падения (дебилитации), долгота 0..360
const DEBIL_POINT = { Солнце: 6 * 30 + 10, Луна: 7 * 30 + 3, Марс: 3 * 30 + 28, Меркурий: 11 * 30 + 15, Юпитер: 9 * 30 + 5, Венера: 5 * 30 + 27, Сатурн: 20 };
// Мулатрикона: [знак, от°, до°]
const MULATRIKONA = { Солнце: [4, 0, 20], Луна: [1, 4, 30], Марс: [0, 0, 12], Меркурий: [5, 16, 20], Юпитер: [8, 0, 10], Венера: [6, 0, 15], Сатурн: [10, 0, 20] };
const NAISARGIKA = { Солнце: 60, Луна: 51.43, Венера: 42.86, Юпитер: 34.29, Меркурий: 25.71, Марс: 17.14, Сатурн: 8.57 };
const REQUIRED_RUPAS = { Солнце: 6.5, Луна: 6, Марс: 5, Меркурий: 7, Юпитер: 6.5, Венера: 5.5, Сатурн: 5 };
const DIG_HOUSE_OFFSET = { Юпитер: 0, Меркурий: 0, Солнце: 270, Марс: 270, Сатурн: 180, Луна: 90, Венера: 90 };
const DAY_LORD_OF_DOW = ['Солнце', 'Луна', 'Марс', 'Меркурий', 'Юпитер', 'Венера', 'Сатурн'];
const CHALDEAN = ['Солнце', 'Венера', 'Меркурий', 'Луна', 'Сатурн', 'Юпитер', 'Марс'];
const BODY = { Солнце: 'Sun', Луна: 'Moon', Марс: 'Mars', Меркурий: 'Mercury', Юпитер: 'Jupiter', Венера: 'Venus', Сатурн: 'Saturn' };
// Средние гелиоцентрические долготы (тропические), градусы: L0 + L1*T (T — юлианские столетия от J2000)
const MEAN_L = { Меркурий: [252.250906, 149472.6746358], Венера: [181.979801, 58517.8156760], Марс: [355.433275, 19140.2993313], Юпитер: [34.351484, 3034.9056746], Сатурн: [50.077471, 1222.1137943] };
const SUN_MEAN = [280.46646, 36000.76983];

function relationScore(planet, other, chart) {
  const nat = FRIENDS[planet].f.includes(other) ? 1 : (FRIENDS[planet].e.includes(other) ? -1 : 0);
  const h = pmod(chart.planets[other].sign.index - chart.planets[planet].sign.index, 12) + 1;
  const temp = [2, 3, 4, 10, 11, 12].includes(h) ? 1 : -1;
  return nat + temp;
}
const DIGNITY_POINTS = { 2: ['Адхи-митра (лучший друг)', 22.5], 1: ['Друг', 15], 0: ['Нейтральный', 7.5], '-1': ['Враг', 3.75], '-2': ['Адхи-шатру (заклятый враг)', 1.875] };

function dignityInSign(planet, signIndex, chart, isRasi, degInSign) {
  if (isRasi) {
    const m = MULATRIKONA[planet];
    if (m && m[0] === signIndex && degInSign >= m[1] && degInSign < m[2]) return ['Мулатрикона', 45];
  }
  const lord = SIGN_LORDS[signIndex];
  if (lord === planet) return ['Свой знак', 30];
  return DIGNITY_POINTS[String(relationScore(planet, lord, chart))];
}

// Спхута-дришти по БПХШ, гл. 26, шлоки 6-12 (проверено по санскритскому тексту).
// d — расстояние от аспектирующей планеты до цели по долготе (0..360), результат в вирупах (0..60).
function drishtiGeneral(d) {
  if (d < 30) return 0;
  if (d < 60) return (d - 30) / 2;          // шл. 9: больше 1 знака — градусы сверх знака пополам
  if (d < 90) return (d - 60) + 15;         // шл. 8: больше 2 знаков — градусы сверх знаков плюс 15
  if (d < 120) return (120 - d) / 2 + 30;   // шл. 8: от 4 знаков вычесть, пополам, плюс 30
  if (d < 150) return 150 - d;              // шл. 7: больше 4 знаков — вычесть из 5 знаков
  if (d < 180) return (d - 150) * 2;        // шл. 7: больше 5 знаков — градусы сверх знаков вдвое
  if (d <= 300) return (300 - d) / 2;       // шл. 6: больше 6 знаков — вычесть из 10 знаков и пополам
  return 0;
}
// Особые формулы Сатурна (шл. 9-10), Марса (шл. 11), Юпитера (шл. 12)
function drishtiSpecial(planet, d) {
  if (planet === 'Сатурн') {
    if (d >= 30 && d < 60) return [2 * (d - 30), 'Сатурн: в 1-м знаке пройденные градусы вдвое'];
    if (d >= 60 && d < 90) return [60 - (d - 60) / 2, 'Сатурн: во 2-м знаке 60 минус половина градусов'];
    if (d >= 240 && d < 270) return [30 + (d - 240), 'Сатурн: в 8-м знаке 30 плюс градусы'];
    if (d >= 270 && d < 300) return [2 * (300 - d), 'Сатурн: в 9-м знаке оставшиеся градусы вдвое'];
  } else if (planet === 'Марс') {
    if (d >= 60 && d < 90) return [1.5 * (d - 60) + 15, 'Марс: во 2-м знаке 1,5 × градусы плюс 15'];
    if (d >= 90 && d < 120) return [60 - (d - 90), 'Марс: в 3-м знаке 60 минус градусы'];
    if (d >= 180 && d < 210) return [60, 'Марс: в 6-м знаке всегда 60'];
    if (d >= 210 && d < 240) return [60 - (d - 210), 'Марс: в 7-м знаке 60 минус градусы'];
  } else if (planet === 'Юпитер') {
    if (d >= 90 && d < 120) return [(d - 90) / 2 + 45, 'Юпитер: в 3-м знаке половина градусов плюс 45'];
    if (d >= 120 && d < 150) return [60 - 2 * (d - 120), 'Юпитер: в 4-м знаке 60 минус двойные градусы'];
    if (d >= 210 && d < 240) return [(d - 210) / 2 + 45, 'Юпитер: в 7-м знаке половина градусов плюс 45'];
    if (d >= 240 && d < 270) return [60 - 2 * (d - 240), 'Юпитер: в 8-м знаке 60 минус двойные градусы'];
  }
  return null;
}
function drishtiValue(planet, d) {
  const sp = drishtiSpecial(planet, d);
  return sp ? { value: sp[0], rule: sp[1] } : { value: drishtiGeneral(d), rule: 'общая формула' };
}

function eclipticToDeclination(planet, date) {
  const t = Astronomy.MakeTime(date);
  const v = Astronomy.GeoVector(BODY[planet], t, true);
  const rot = Astronomy.Rotation_EQJ_EQD(t);
  const eq = Astronomy.EquatorFromVector(Astronomy.RotateVector(rot, v));
  return eq.dec;
}

function jdToDate(jd) { return new Date((jd - 2440587.5) * 86400000); }

// Времена восхода/захода (JD) для местной гражданской даты
function riseSetJD(y, m, d, lat, lon) {
  const t = sunriseSunsetMinutesUTC(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), lat, lon, -0.8333);
  if (t.sunriseUTC == null) throw new Error('В этой точке в этот день нет восхода или захода (полярный день или ночь)');
  const base = jdFromDate(y, m, d, 0, 0, 0, 0);
  return { rise: base + t.sunriseUTC / 1440, set: base + t.sunsetUTC / 1440 };
}
function civilDate(jd, utcOffset) {
  const dt = jdToDate(jd + utcOffset / 24);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}
// Ведический день для момента jd: от восхода до восхода. Возвращает вару и границы.
function vedicDay(jd, lat, lon, utcOffset) {
  const c = civilDate(jd, utcOffset);
  let cur = riseSetJD(c.y, c.m, c.d, lat, lon);
  let dow = c.dow;
  let dayDate = c;
  if (jd < cur.rise) {
    const p = civilDate(jd - 1, utcOffset);
    cur = riseSetJD(p.y, p.m, p.d, lat, lon); dow = p.dow; dayDate = p;
  }
  const nd = civilDate(jdFromDate(dayDate.y, dayDate.m, dayDate.d, 12, 0, 0, utcOffset) + 1, utcOffset);
  const next = riseSetJD(nd.y, nd.m, nd.d, lat, lon);
  return { dow, rise: cur.rise, set: cur.set, nextRise: next.rise };
}

function sunSidLon(jd, chart) {
  return pmod(sunLongitude(jd) - ayanamshaFor(jd, chart.ayanamshaType || 'lahiri', chart.customAyanamshaBase), 360);
}
// Момент последнего входа Солнца в точку target (кратную 30°) до jd
function lastSolarIngress(jd, chart, step) {
  const lon = sunSidLon(jd, chart);
  const target = Math.floor(lon / step) * step;
  let t = jd - (lon - target) / 0.9856;
  for (let i = 0; i < 6; i++) {
    const diff = ((sunSidLon(t, chart) - target + 540) % 360) - 180;
    t -= diff / 0.9856;
  }
  return t;
}

/**
 * @param chart натальная карта (planets, ascendant, jd, ayanamsha, ayanamshaType)
 * @param geo { lat, lon, utcOffset }
 */
function computeShadbala(chart, geo) {
  const { lat, lon, utcOffset } = geo;
  const jd = chart.jd;
  const ayan = chart.ayanamsha || 0;
  const L = {}; // сидерические долготы
  for (const p of PL) L[p] = chart.planets[p].siderealLon;
  const asc = chart.ascendant.siderealLon;
  const date = jdToDate(jd);
  const methods = [];
  const warnings = [];

  const vd = vedicDay(jd, lat, lon, utcOffset);
  const isDay = jd >= vd.rise && jd < vd.set;
  const weekdayLord = DAY_LORD_OF_DOW[vd.dow];

  // --- Паксха ---
  const elong = pmod(L['Луна'] - L['Солнце'], 360);
  const elongFold = elong > 180 ? 360 - elong : elong;
  const waxing = elong < 180;
  const BENEFIC = { Луна: waxing, Меркурий: true, Юпитер: true, Венера: true, Солнце: false, Марс: false, Сатурн: false };

  // --- Деления дня ---
  const noonJD = (vd.rise + vd.set) / 2;
  let dt = (jd - noonJD) * 24;
  dt = pmod(dt + 12, 24) - 12;
  const hFromNoon = Math.abs(dt);
  let tribhagaLord;
  if (isDay) {
    const part = Math.min(2, Math.floor(((jd - vd.rise) / (vd.set - vd.rise)) * 3));
    tribhagaLord = ['Меркурий', 'Солнце', 'Сатурн'][part];
  } else {
    const part = Math.min(2, Math.max(0, Math.floor(((jd - vd.set) / (vd.nextRise - vd.set)) * 3)));
    tribhagaLord = ['Луна', 'Венера', 'Марс'][part];
  }

  // --- Хора ---
  const horaIdx = Math.floor((jd - vd.rise) * 24);
  const horaLord = CHALDEAN[(CHALDEAN.indexOf(weekdayLord) + horaIdx) % 7];

  // --- Абда и Маса по ахаргане (БПХШ 27.13, перевод Сантанама) ---
  // Номер дня N: дни от эпохи Кали-юги (пятница) с выравниванием по вара: N mod 7 = 1 — воскресенье ... 6 — пятница, 0 — суббота.
  // Год: (N div 360) × 3 + 1, остаток от деления на 7 даёт вару первого дня года.
  // Месяц: (N div 30) × 2 + 1, остаток от деления на 7 даёт вару первого дня месяца.
  const dayStart = civilDate(vd.rise, utcOffset);
  const keliDays = Math.floor(jdFromDate(dayStart.y, dayStart.m, dayStart.d, 12, 0, 0, 0)) - 588466;
  const ahargana = keliDays + 6;
  const lordOfRem = (r) => DAY_LORD_OF_DOW[(((r - 1) % 7) + 7) % 7];
  const qYear = Math.floor(ahargana / 360), qMonth = Math.floor(ahargana / 30);
  const remYear = (qYear * 3 + 1) % 7, remMonth = (qMonth * 2 + 1) % 7;
  const abdaLord = lordOfRem(remYear);
  const masaLord = lordOfRem(remMonth);
  const abdaMasaInfo = { ahargana, qYear, prodYear: qYear * 3 + 1, remYear, qMonth, prodMonth: qMonth * 2 + 1, remMonth, abdaLord, masaLord, weekdayRem: ahargana % 7 };

  // --- Склонения для Аяна-балы ---
  const decl = {};
  if (Astronomy) { for (const p of PL) decl[p] = eclipticToDeclination(p, date); }

  // --- Варги для Саптаваргаджа ---
  const vargaSign = (p) => {
    const l = L[p];
    return [
      ['Раши (D1)', chart.planets[p].sign.index, true],
      ['Хора (D2, Парашара)', dc.horaPosition(l).index, false],
      ['Дрекана (D3)', dc.drekkanaPosition(l).index, false],
      ['Саптамша (D7)', dc.saptamshaPosition(l).index, false],
      ['Навамша (D9)', navamshaPosition(l).index, false],
      ['Двадашамша (D12)', dc.dvadashamshaPosition(l).index, false],
      ['Тримшамша (D30)', dc.trimshamshaPosition(l).index, false],
    ];
  };

  const T = (jd - 2451545.0) / 36525;
  const meanL = (p) => pmod(MEAN_L[p][0] + MEAN_L[p][1] * T - ayan, 360); // сидерическая
  const sunMean = pmod(SUN_MEAN[0] + SUN_MEAN[1] * T - ayan, 360);

  const out = {};
  for (const p of PL) {
    const r = { sthana: {}, kala: {} };
    // Стхана
    const uccha = fold180(L[p] - DEBIL_POINT[p]) / 3;
    const sv = vargaSign(p).map(([name, si, isRasi]) => {
      const [dn, pts] = dignityInSign(p, si, chart, isRasi, chart.planets[p].sign.degInSign);
      return { varga: name, signIndex: si, dignity: dn, points: pts };
    });
    const sapta = sv.reduce((s, x) => s + x.points, 0);
    const rasiSign = chart.planets[p].sign.index;
    const navSign = navamshaPosition(L[p]).index;
    const male = ['Солнце', 'Марс', 'Юпитер', 'Меркурий', 'Сатурн'].includes(p); // нечётные знаки
    const oddRasi = rasiSign % 2 === 0, oddNav = navSign % 2 === 0;
    const ojayugma = (male ? (oddRasi ? 15 : 0) + (oddNav ? 15 : 0) : (!oddRasi ? 15 : 0) + (!oddNav ? 15 : 0));
    const house = pmod(rasiSign - chart.ascendant.sign.index, 12) + 1;
    const kendradi = [1, 4, 7, 10].includes(house) ? 60 : ([2, 5, 8, 11].includes(house) ? 30 : 15);
    const deg = chart.planets[p].sign.degInSign;
    const dr = deg < 10 ? 0 : (deg < 20 ? 1 : 2);
    const drekkana = ((['Солнце', 'Марс', 'Юпитер'].includes(p) && dr === 0) || (['Меркурий', 'Сатурн'].includes(p) && dr === 1) || (['Луна', 'Венера'].includes(p) && dr === 2)) ? 15 : 0;
    r.sthana = { uccha, saptavargaja: sapta, saptavargajaDetails: sv, ojayugma, kendradi, drekkana, total: uccha + sapta + ojayugma + kendradi + drekkana };

    // Диг
    const strongPoint = pmod(asc + DIG_HOUSE_OFFSET[p], 360);
    r.dig = (180 - fold180(L[p] - strongPoint)) / 3;

    // Кала
    const diurnal = ['Солнце', 'Юпитер', 'Венера'].includes(p);
    const natonnata = p === 'Меркурий' ? 60 : (diurnal ? 60 * (12 - hFromNoon) / 12 : 60 * hFromNoon / 12);
    let paksha = BENEFIC[p] ? elongFold / 3 : 60 - elongFold / 3;
    if (p === 'Луна') paksha *= 2;
    const tribhaga = (p === 'Юпитер' || p === tribhagaLord) ? 60 : 0;
    const abda = p === abdaLord ? 15 : 0, masa = p === masaLord ? 30 : 0, vara = p === weekdayLord ? 45 : 0, hora = p === horaLord ? 60 : 0;
    let ayana = null;
    if (Astronomy) {
      const dd = decl[p];
      if (p === 'Меркурий') ayana = (24 + Math.abs(dd)) / 48 * 60;
      else if (p === 'Луна' || p === 'Сатурн') ayana = (24 - dd) / 48 * 60;
      else ayana = (24 + dd) / 48 * 60;
      if (p === 'Солнце') ayana *= 2;
    }
    r.kala = { natonnata, paksha, tribhaga, abda, masa, vara, hora, ayana, total: natonnata + paksha + tribhaga + abda + masa + vara + hora + (ayana || 0) };

    // Чешта
    let cheshta; let cheshtaInfo = null;
    if (p === 'Солнце') cheshta = ayana == null ? null : ayana / 2;
    else if (p === 'Луна') cheshta = paksha;
    else {
      const trueL = L[p];
      let ck;
      if (p === 'Марс' || p === 'Юпитер' || p === 'Сатурн') ck = sunMean - (meanL(p) + trueL) / 2;
      else ck = meanL(p) - (sunMean + trueL) / 2;
      cheshta = fold180(ck) / 3;
      cheshtaInfo = { shighrochcha: (p === 'Марс' || p === 'Юпитер' || p === 'Сатурн') ? sunMean : meanL(p), meanLongitude: (p === 'Марс' || p === 'Юпитер' || p === 'Сатурн') ? meanL(p) : sunMean, trueLongitude: trueL, kendra: fold180(ck) };
    }
    r.cheshta = cheshta;
    r.naisargika = NAISARGIKA[p];

    // Дришти-бала (БПХШ 27.19): четверть дришти-пинды от благотворных плюс, от злотворных минус; дришти Меркурия и Юпитера добавляются целиком
    let drik = 0;
    const drikList = [];
    for (const q of PL) {
      if (q === p) continue;
      const d = pmod(L[p] - L[q], 360);
      const dv = drishtiValue(q, d);
      let contrib;
      if (q === 'Меркурий' || q === 'Юпитер') contrib = dv.value;
      else contrib = (BENEFIC[q] ? dv.value : -dv.value) / 4;
      drik += contrib;
      drikList.push({ from: q, distance: d, value: dv.value, rule: dv.rule, nature: (q === 'Меркурий' || q === 'Юпитер') ? 'целиком' : (BENEFIC[q] ? 'благотворная, +¼' : 'злотворная, −¼'), contribution: contrib });
    }
    r.drik = drik;
    r.drikDetails = drikList;
    r.details = {
      uccha: { debilPoint: DEBIL_POINT[p], distance: fold180(L[p] - DEBIL_POINT[p]) },
      dig: { strongPoint, distance: fold180(L[p] - strongPoint) },
      natonnata: { hoursFromNoon: hFromNoon, diurnal },
      paksha: { elongation: elongFold, waxing, benefic: BENEFIC[p] },
      ayana: { declination: decl[p] != null ? decl[p] : null },
      tribhaga: { part: isDay ? 'день' : 'ночь', lord: tribhagaLord },
      hora: { lord: horaLord, hoursFromSunrise: (jd - vd.rise) * 24 },
      vara: { lord: weekdayLord },
      cheshta: cheshtaInfo,
    };

    r.total = r.sthana.total + r.dig + r.kala.total + (r.cheshta || 0) + r.naisargika + r.drik;
    r.rupas = r.total / 60;
    r.required = REQUIRED_RUPAS[p];
    r.ratio = r.rupas / r.required;
    r.strong = r.rupas >= r.required;
    out[p] = r;
  }

  // Юддха-бала (БПХШ 27.20): разница Шадбал двух планет прибавляется к победителю и вычитается у побеждённого.
  // Победитель: планета с меньшей долготой (в тексте шлоки способ не указан, комментаторы расходятся — см. методы).
  const war = ['Марс', 'Меркурий', 'Юпитер', 'Венера', 'Сатурн'];
  const wars = [];
  for (let i = 0; i < war.length; i++) for (let j = i + 1; j < war.length; j++) {
    const a = war[i], b = war[j];
    if (Math.abs(L[a] - L[b]) < 1) {
      const win = L[a] < L[b] ? a : b, lose = win === a ? b : a;
      wars.push({ winner: win, loser: lose, winnerBefore: out[win].total, loserBefore: out[lose].total, value: Math.abs(out[win].total - out[lose].total) });
    }
  }
  for (const w of wars) {
    for (const [p, sign] of [[w.winner, 1], [w.loser, -1]]) {
      const r = out[p];
      r.kala.yuddha = (r.kala.yuddha || 0) + sign * w.value;
      r.kala.total += sign * w.value; r.total += sign * w.value;
      r.rupas = r.total / 60; r.ratio = r.rupas / r.required; r.strong = r.rupas >= r.required;
    }
    warnings.push('Планетная война: ' + w.winner + ' побеждает ' + w.loser + ' (меньшая долгота). Разница Шадбал ' + (Math.round(w.value * 10) / 10) + ' вирупы: +' + (Math.round(w.value * 10) / 10) + ' победителю, −' + (Math.round(w.value * 10) / 10) + ' побеждённому.');
  }
  if (!Astronomy) warnings.push('Аяна-бала и Чешта-бала Солнца не посчитаны: нет данных склонения.');

  methods.push('Уччха-бала: расстояние от точки падения, делённое на 3.');
  methods.push('Саптаваргаджа: семь варг (D1, хора Парашары, D3, D7, D9, D12, D30); достоинство по составной дружбе (естественная + временная). Мулатрикона учитывается только в D1; для Луны Телец от 4° до 30°.');
  methods.push('Оджа-югма: Луна и Венера получают за чётные знаки, остальные планеты за нечётные (в раши и навамше по 15).');
  methods.push('Кендрадi: от лагны по знакам (целые знаки): кендра 60, панапара 30, апоклима 15.');
  methods.push('Диг-бала: расстояние до точки силы, делённое на 3; точки силы отсчитаны от градуса лагны (равные дома).');
  methods.push('Натоннната: от истинного полудня (середина между восходом и заходом); Меркурий всегда 60.');
  methods.push('Пакша: благотворные (Луна растущая, Меркурий, Юпитер, Венера) получают угол Луна–Солнце/3, злотворные — 60 минус это; у Луны значение удваивается. Меркурий считается благотворным всегда.');
  methods.push('Трибхага: день и ночь делятся на три части; Юпитер всегда 60.');
  methods.push('Вара — по восходу. Хора — равные часы от восхода в халдейской последовательности.');
  methods.push('Абда и Маса (БПХШ 27.13, перевод Сантанама): номер дня N (ахаргана) делится на 360 (год) или на 30 (месяц), частное умножается на 3 (год) или на 2 (месяц), прибавляется 1, остаток от деления на 7 даёт вару первого дня года или месяца (1 — воскресенье). В примечаниях к переводу делитель года напечатан как 60, но умножение на 3 даёт верную вару только для 360, поэтому взято 360. Эпоха ахарганы в доступном тексте не названа: взяты сутки от начала Кали-юги, выровненные по вара.');
  methods.push('Аяна-бала: (24° ± склонение)/48 × 60; у Солнца удваивается; у Меркурия 24° + модуль склонения. Склонение настоящее (с широтой планеты).');
  methods.push('Чешта-бала: расстояние чешта-кендры/3. Кендра = шигхрочча минус манда-спхута (среднее между средней и истинной долготой). Для Марса, Юпитера и Сатурна шигхрочча — средняя долгота Солнца; для Меркурия и Венеры — их средняя гелиоцентрическая долгота. У Солнца чешта равна аяна-бале без удвоения (максимум 60), у Луны — пакша-бале.');
  methods.push('Дришти-бала (БПХШ гл. 26, шлоки 6-12 и 27.19): спхута-дришти по расстоянию от аспектирующей планеты, с особыми формулами Сатурна, Марса и Юпитера; четверть значений благотворных планет прибавляется, четверть злотворных вычитается, дришти Меркурия и Юпитера добавляются целиком. В шлоке «добавить целиком» можно понять и как «сверх четверти»; взято: вместо четверти.');
  methods.push('Юддха-бала (БПХШ 27.20): при расстоянии менее 1° между Марсом, Меркурием, Юпитером, Венерой и Сатурном разница их Шадбал прибавляется к победителю и вычитается у побеждённого. В шлоке не сказано, кто побеждает; взято правило «меньшая долгота», комментаторы называют и другие (северная широта, зависит от аяны).');
  methods.push('Минимум по Парашаре (рупы): Солнце 6,5, Луна 6, Марс 5, Меркурий 7, Юпитер 6,5, Венера 5,5, Сатурн 5.');

  return { planets: out, methods, warnings, order: PL, abdaMasa: abdaMasaInfo, wars };
}

module.exports = { computeShadbala };
