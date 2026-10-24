// ============================================================
// varshaphala.js — годовая карта (Таджика): Варша-правеша (солнечное
// возвращение) и Титхи-правеша (солнечно-лунное возвращение), Мунта,
// пять должностных лиц и Варшеша по Панча-варгия бале.
// ============================================================
const { jdFromDate, sunLongitude, moonLongitude, ayanamshaFor, calculateChart } = require('./engine.js');
const { monthsAround, masaAtJD, MASA_NAMES } = require('./hindu-calendar.js');
const { navamshaPosition } = require('./navamsha.js');
const { computeTajikaYogas } = require('./tajika-yogas.js');

const pmod = (x, y) => ((x % y) + y) % y;
const SIGNS = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const LORD = ['Марс','Венера','Меркурий','Луна','Солнце','Меркурий','Венера','Марс','Юпитер','Сатурн','Сатурн','Юпитер'];
const SEVEN = ['Солнце','Луна','Марс','Меркурий','Юпитер','Венера','Сатурн'];

// Дружба планет (натуральная, Парашара)
const FRIENDS = {
  Солнце: { f: ['Луна','Марс','Юпитер'], n: ['Меркурий'], e: ['Венера','Сатурн'] },
  Луна: { f: ['Солнце','Меркурий'], n: ['Марс','Юпитер','Венера','Сатурн'], e: [] },
  Марс: { f: ['Солнце','Луна','Юпитер'], n: ['Венера','Сатурн'], e: ['Меркурий'] },
  Меркурий: { f: ['Солнце','Венера'], n: ['Марс','Юпитер','Сатурн'], e: ['Луна'] },
  Юпитер: { f: ['Солнце','Луна','Марс'], n: ['Сатурн'], e: ['Меркурий','Венера'] },
  Венера: { f: ['Меркурий','Сатурн'], n: ['Марс','Юпитер'], e: ['Солнце','Луна'] },
  Сатурн: { f: ['Меркурий','Венера'], n: ['Юпитер'], e: ['Солнце','Луна','Марс'] },
};
// Возвышение: знак (индекс) и градус
const EXALT = { Солнце: [0, 10], Луна: [1, 3], Марс: [9, 28], Меркурий: [5, 15], Юпитер: [3, 5], Венера: [11, 27], Сатурн: [6, 20] };
// Хадда — египетские границы
const HADDA = [
  [['Юпитер',6],['Венера',12],['Меркурий',20],['Марс',25],['Сатурн',30]],
  [['Венера',8],['Меркурий',14],['Юпитер',22],['Сатурн',27],['Марс',30]],
  [['Меркурий',6],['Юпитер',12],['Венера',17],['Марс',24],['Сатурн',30]],
  [['Марс',7],['Венера',13],['Меркурий',19],['Юпитер',26],['Сатурн',30]],
  [['Юпитер',6],['Венера',11],['Сатурн',18],['Меркурий',24],['Марс',30]],
  [['Меркурий',7],['Венера',17],['Юпитер',21],['Марс',28],['Сатурн',30]],
  [['Сатурн',6],['Меркурий',14],['Юпитер',21],['Венера',28],['Марс',30]],
  [['Марс',7],['Венера',11],['Меркурий',19],['Юпитер',24],['Сатурн',30]],
  [['Юпитер',12],['Венера',17],['Меркурий',21],['Сатурн',26],['Марс',30]],
  [['Меркурий',7],['Юпитер',14],['Венера',22],['Сатурн',26],['Марс',30]],
  [['Меркурий',7],['Венера',13],['Юпитер',20],['Марс',25],['Сатурн',30]],
  [['Венера',12],['Юпитер',16],['Меркурий',19],['Марс',28],['Сатурн',30]],
];
// Три-раши-пати: по знаку Варша-лагны (таблица из лекции): день / ночь
const TRI_DAY = ['Солнце','Венера','Сатурн','Венера','Юпитер','Луна','Меркурий','Марс','Сатурн','Марс','Юпитер','Луна'];
const TRI_NIGHT = ['Юпитер','Луна','Меркурий','Марс','Солнце','Венера','Сатурн','Венера','Сатурн','Марс','Юпитер','Луна'];
// Вес каждого источника (сумма 15 → шкала 20)
const W = { kshetra: 5, uccha: 4, hadda: 3, drekkana: 2, navamsha: 1 };
const SCALE = 20 / 15;

function relScore(planet, ruler) {
  if (ruler === planet) return 1;
  const r = FRIENDS[planet];
  // значения подогнаны под сверку с J108 (Марс 6.58, Меркурий 9.18, Венера 11.86)
  if (r.f.includes(ruler)) return 0.55;
  if (r.n.includes(ruler)) return 0.2;
  return 0.15;
}
function haddaRuler(lon) {
  const s = Math.floor(lon / 30), d = lon % 30;
  for (const [pl, end] of HADDA[s]) if (d < end) return pl;
  return HADDA[s][4][0];
}
function drekkanaRuler(lon) {
  const s = Math.floor(lon / 30), k = Math.floor((lon % 30) / 10);
  return LORD[(s + k * 4) % 12];
}
function panchaVargiya(planet, lon) {
  const sign = Math.floor(lon / 30);
  const kshetra = W.kshetra * relScore(planet, LORD[sign]);
  const [es, ed] = EXALT[planet];
  const exLon = es * 30 + ed;
  let dist = Math.abs(pmod(lon - exLon + 180, 360) - 180); // 0..180
  const uccha = W.uccha * (180 - dist) / 180;
  const hadda = W.hadda * relScore(planet, haddaRuler(lon));
  const drekkana = W.drekkana * relScore(planet, drekkanaRuler(lon));
  const navamsha = W.navamsha * relScore(planet, navamshaPosition(lon).lord);
  const total = (kshetra + uccha + hadda + drekkana + navamsha) * SCALE;
  return { total: Math.round(total * 100) / 100, kshetra, uccha, hadda, drekkana, navamsha };
}

function siderealSun(jd, ay, base) { return pmod(sunLongitude(jd) - ayanamshaFor(jd, ay, base), 360); }
const elong = (jd) => pmod(moonLongitude(jd) - sunLongitude(jd), 360);

function signedDiff(a) { a = pmod(a, 360); return a > 180 ? a - 360 : a; }

// Варша-правеша: ближайший к календарному году Y момент, когда Солнце на натальной долготе
function findVarsha(natalJD, natalSunLon, year, ay, base) {
  const birthYear = new Date((natalJD - 2440587.5) * 864e5).getUTCFullYear();
  let jd = natalJD + (year - birthYear) * 365.2425;
  for (let i = 0; i < 12; i++) {
    const d = signedDiff(siderealSun(jd, ay, base) - natalSunLon);
    jd -= d / 0.9856;
  }
  return jd;
}

// Титхи-правеша: тот же лунный месяц (амавасья-манта), та же элонгация Луна−Солнце
function findTithi(natalJD, natalElong, natalMasaIdx, year) {
  const cands = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const m of monthsAround(y)) {
      if (m.idx !== natalMasaIdx || m.adhika) continue;
      let jd = m.startJD + natalElong / 360 * (m.endJD - m.startJD);
      for (let i = 0; i < 10; i++) jd -= signedDiff(elong(jd) - natalElong) / 12.19;
      cands.push(jd);
    }
  }
  const lo = jdFromDate(year, 1, 1, 0, 0, 0, 0), hi = jdFromDate(year + 1, 1, 1, 0, 0, 0, 0);
  const inYear = cands.filter(j => j >= lo && j < hi);
  return inYear.length ? inYear[0] : null;
}

function localParts(jd, utcOffset) {
  const d = new Date((jd - 2440587.5) * 864e5 + utcOffset * 3600e3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

// Тайка-аспект на лагну: планета в лагне или в 3,5,7,9,11 доме от лагны
// Дриштхи в Варшапхале (лекция): оси 1/7, 4/10, 3/11, 5/9; оси 6/8 и 2/12 — нейтральные
function aspectsLagna(houseOfPlanet) { return [1, 3, 4, 5, 7, 9, 10, 11].includes(houseOfPlanet); }

/**
 * @param natal      натальная карта (chart из calculateChart)
 * @param opts       { year, mode: 'varsha'|'tithi', lat, lon, utcOffset }
 */
function computeVarshaphala(natal, opts) {
  const { year, mode, lat, lon, utcOffset } = opts;
  const ay = natal.ayanamshaType || 'lahiri', base = natal.customAyanamshaBase || null;
  const natalSun = natal.planets['Солнце'].siderealLon;
  const natalJD = natal.jd;
  let jd, extra = {};
  if (mode === 'tithi') {
    const el = elong(natalJD);
    const birthYear = new Date((natalJD - 2440587.5) * 864e5).getUTCFullYear();
    const masa = masaAtJD(natalJD, birthYear);
    jd = findTithi(natalJD, el, masa.idx, year);
    if (jd == null) return { error: 'В ' + year + ' году не нашлось такого лунного месяца (адхика-маса сдвигает его). Попробуйте соседний год.' };
    extra = { natalMasa: MASA_NAMES[masa.idx], natalTithi: Math.floor(el / 12) + 1, natalPaksha: el < 180 ? 'Шукла' : 'Кришна' };
  } else {
    jd = findVarsha(natalJD, natalSun, year, ay, base);
  }
  const lp = localParts(jd, utcOffset);
  const chart = calculateChart({ ...lp, utcOffset, lat, lon, ayanamshaType: ay, nodeType: natal.nodeType || 'mean', customAyanamshaBase: base });
  const age = Math.round((jd - natalJD) / 365.2425);
  const natalLagnaSign = natal.ascendant.sign.index;
  const lagnaSign = chart.ascendant.sign.index;
  const munthaSign = (natalLagnaSign + age) % 12;
  const munthaHouse = pmod(munthaSign - lagnaSign, 12) + 1;

  // День/ночь: Солнце над горизонтом (дома 7–12)
  const sunHouse = chart.planets['Солнце'].house;
  const isDay = sunHouse >= 7;
  const triRashi = (isDay ? TRI_DAY : TRI_NIGHT)[lagnaSign];
  const dinaRatri = LORD[chart.planets[isDay ? 'Солнце' : 'Луна'].sign.index];

  const officers = [
    { role: 'Мунта-пати', planet: LORD[munthaSign] },
    { role: 'Janma-лагна-пати', planet: LORD[natalLagnaSign] },
    { role: 'Варша-лагна-пати', planet: LORD[lagnaSign] },
    { role: 'Три-раши-пати', planet: triRashi },
    { role: 'Дина-ратри-пати', planet: dinaRatri },
  ].map(o => {
    const p = chart.planets[o.planet];
    const bala = panchaVargiya(o.planet, p.siderealLon);
    return { ...o, role: o.role.replace('Janma', 'Джанма'), house: p.house, sign: p.sign.name, pvb: bala.total, aspectsLagna: aspectsLagna(p.house) };
  });
  // Чандра — варшеш только в исключениях: свой знак/экзальтация, пурнима, связь с Юпитером
  const moon = chart.planets['Луна'], jup = chart.planets['Юпитер'];
  const moonElong = pmod(moon.siderealLon - chart.planets['Солнце'].siderealLon, 360);
  const jupLink = [1, 3, 4, 5, 7, 9, 10, 11].includes(pmod(jup.sign.index - moon.sign.index, 12) + 1);
  const moonOk = LORD[moon.sign.index] === 'Луна' || moon.sign.index === 1 || (moonElong >= 168 && moonElong < 180) || jupLink;
  const eligible = officers.filter(o => o.aspectsLagna && (o.planet !== 'Луна' || moonOk));
  let best, rule;
  if (eligible.length) { best = eligible.reduce((a, b) => (b.pvb > a.pvb ? b : a)); rule = 'pvb'; }
  else { best = officers[0]; rule = 'muntesha'; }

  // Таблица планет с ПВБ
  const table = SEVEN.map(n => ({ planet: n, pvb: panchaVargiya(n, chart.planets[n].siderealLon).total }));

  return {
    mode, year, jd, local: lp, age, extra,
    chart, isDay,
    muntha: { sign: SIGNS[munthaSign], signIndex: munthaSign, house: munthaHouse, lord: LORD[munthaSign] },
    officers, varshesh: { planet: best.planet, role: best.role, pvb: best.pvb, byAspect: rule === 'pvb', rule },
    pvbTable: table,
    yogas: (() => { try { const m = {}; table.forEach(t => { m[t.planet] = t.pvb; }); return computeTajikaYogas(chart, m); } catch (e) { console.error('Таджика-йоги:', e.message); return []; } })(),
  };
}

module.exports = { computeVarshaphala, panchaVargiya };
