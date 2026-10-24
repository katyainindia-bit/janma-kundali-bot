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

// Значение дришти (вирупы) по угловому расстоянию d от аспектирующей планеты до цели (0..360)
function drishtiValue(d) {
  if (d < 30) return 0;
  if (d < 60) return (d - 30) / 2;
  if (d < 90) return (d - 60) + 15;
  if (d < 120) return (120 - d) / 2 + 30;
  if (d < 150) return 150 - d;
  if (d < 180) return (d - 150) * 2;
  if (d <= 300) return (300 - d) / 2;
  return 0;
}
const SPECIAL = { Марс: [4, 8], Юпитер: [5, 9], Сатурн: [3, 10] };

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

  // --- Абда и Маса по ахарargане (Сурья-сиддханта / Парашара) ---
  // Ахаргана — число суток от начала Кали-юги (эпоха: JD 588465,5, пятница). Савана-год = 360 суток, месяц = 30 суток;
  // управитель года (месяца) — владыка вары первых суток этого года (месяца).
  const dayStart = civilDate(vd.rise, utcOffset);
  const ahargana = Math.floor(jdFromDate(dayStart.y, dayStart.m, dayStart.d, 12, 0, 0, 0)) - 588466;
  const lordOfDay = (n) => DAY_LORD_OF_DOW[(((5 + n) % 7) + 7) % 7];
  const abdaLord = lordOfDay(Math.floor(ahargana / 360) * 360);
  const masaLord = lordOfDay(Math.floor(ahargana / 30) * 30);

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
    let cheshta;
    if (p === 'Солнце') cheshta = ayana == null ? null : ayana / 2;
    else if (p === 'Луна') cheshta = paksha;
    else {
      const trueL = L[p];
      let ck;
      if (p === 'Марс' || p === 'Юпитер' || p === 'Сатурн') ck = sunMean - (meanL(p) + trueL) / 2;
      else ck = meanL(p) - (sunMean + trueL) / 2;
      cheshta = fold180(ck) / 3;
    }
    r.cheshta = cheshta;
    r.naisargika = NAISARGIKA[p];

    // Дришти
    let drik = 0;
    for (const q of PL) {
      if (q === p) continue;
      const d = pmod(L[p] - L[q], 360);
      let v = drishtiValue(d);
      const spec = SPECIAL[q];
      if (spec) {
        const dist = pmod(chart.planets[p].sign.index - chart.planets[q].sign.index, 12) + 1;
        if (spec.includes(dist)) v = Math.max(v, 60);
      }
      drik += (BENEFIC[q] ? v : -v) / 4;
    }
    r.drik = drik;

    r.total = r.sthana.total + r.dig + r.kala.total + (r.cheshta || 0) + r.naisargika + r.drik;
    r.rupas = r.total / 60;
    r.required = REQUIRED_RUPAS[p];
    r.ratio = r.rupas / r.required;
    r.strong = r.rupas >= r.required;
    out[p] = r;
  }

  // Юддха-бала: планетная война (Марс, Меркурий, Юпитер, Венера, Сатурн в пределах 1° по долготе)
  const DIAM = { Марс: 9.4, Меркурий: 6.6, Юпитер: 190.4, Венера: 16.6, Сатурн: 158.0 };
  const war = ['Марс', 'Меркурий', 'Юпитер', 'Венера', 'Сатурн'];
  const wars = [];
  for (let i = 0; i < war.length; i++) for (let j = i + 1; j < war.length; j++) {
    const a = war[i], b = war[j];
    if (Math.abs(L[a] - L[b]) < 1) {
      const win = L[a] < L[b] ? a : b, lose = win === a ? b : a;
      const val = Math.abs(out[win].total - out[lose].total) / Math.abs(DIAM[win] - DIAM[lose]);
      wars.push({ winner: win, loser: lose, value: val });
    }
  }
  for (const w of wars) {
    for (const [p, sign] of [[w.winner, 1], [w.loser, -1]]) {
      const r = out[p];
      r.kala.yuddha = (r.kala.yuddha || 0) + sign * w.value;
      r.kala.total += sign * w.value; r.total += sign * w.value;
      r.rupas = r.total / 60; r.ratio = r.rupas / r.required; r.strong = r.rupas >= r.required;
    }
    warnings.push('Планетная война: ' + w.winner + ' побеждает ' + w.loser + ' (меньшая долгота). Юддха-бала: +' + (Math.round(w.value * 10) / 10) + ' победителю, −' + (Math.round(w.value * 10) / 10) + ' проигравшему.');
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
  methods.push('Абда и Маса: по ахарargане от начала Кали-юги (эпоха JD 588465,5). Год считается по 360 суток, месяц по 30; управитель — владыка вары первых суток текущего года и месяца.');
  methods.push('Аяна-бала: (24° ± склонение)/48 × 60; у Солнца удваивается; у Меркурия 24° + модуль склонения. Склонение настоящее (с широтой планеты).');
  methods.push('Чешта-бала: расстояние чешта-кендры/3. Кендра = шигхрочча минус манда-спхута (среднее между средней и истинной долготой). Для Марса, Юпитера и Сатурна шигхрочча — средняя долгота Солнца; для Меркурия и Венеры — их средняя гелиоцентрическая долгота. У Солнца чешта равна аяна-бале без удвоения (максимум 60), у Луны — пакша-бале.');
  methods.push('Дришти-бала: четверть суммы аспектов благотворных минус злотворных; значение аспекта по классической ломаной функции угла; особые аспекты (Марс 4/8, Юпитер 5/9, Сатурн 3/10) берутся полными (60), если цель в таком знаке от аспектирующей планеты.');
  methods.push('Юддха-бала: война при расстоянии менее 1° по долготе между Марсом, Меркурием, Юпитером, Венерой и Сатурном; побеждает планета с меньшей долготой. Разница итоговых сил (без юддхи), делённая на разницу видимых диаметров, прибавляется победителю и вычитается у проигравшего. Диаметры (угловые минуты): Марс 9,4, Меркурий 6,6, Юпитер 190,4, Венера 16,6, Сатурн 158,0.');
  methods.push('Минимум по Парашаре (рупы): Солнце 6,5, Луна 6, Марс 5, Меркурий 7, Юпитер 6,5, Венера 5,5, Сатурн 5.');

  return { planets: out, methods, warnings, order: PL };
}

module.exports = { computeShadbala };
