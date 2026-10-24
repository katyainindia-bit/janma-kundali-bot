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
  [['Меркурий',6],['Венера',12],['Юпитер',17],['Марс',24],['Сатурн',30]], // Близнецы по «Таджика Нилаканти» (ст. 21)
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
// Панча-варгия бала (по К.С. Чараку, сверено с таблицей J108): Грига 30, Уччха 20, Худда 15,
// Дреккана 10, Навамша 5; итог = сумма / 4. Дружба позиционная, по году: оси управителя
// относительно планеты в годовой карте.
const DEBIL_POINT = { Солнце: 6 * 30 + 10, Луна: 7 * 30 + 3, Марс: 3 * 30 + 28, Меркурий: 11 * 30 + 15, Юпитер: 9 * 30 + 5, Венера: 5 * 30 + 27, Сатурн: 0 * 30 + 20 };
const DREK_ORDER = ['Марс', 'Солнце', 'Венера', 'Меркурий', 'Луна', 'Сатурн', 'Юпитер'];
function axisRel(planetSign, lordSign) {
  const d = pmod(lordSign - planetSign, 12) + 1;
  if ([3, 5, 9, 11].includes(d)) return 0.75;
  if ([2, 6, 8, 12].includes(d)) return 0.5;
  return 0.25;
}
function relTo(planet, lord, signs) { return planet === lord ? 1 : axisRel(signs[planet], signs[lord]); }
function haddaRuler(lon) {
  const s = Math.floor(lon / 30), d = lon % 30;
  for (const [pl, end] of HADDA[s]) if (d < end) return pl;
  return HADDA[s][4][0];
}
function drekkanaRuler(lon) { const sg = Math.floor(lon / 30), k = Math.floor((lon % 30) / 10); return LORD[(sg + 4 * k) % 12]; } // 1-я, 5-я, 9-я от знака (книга, ст. 25 и 27)
/** signs: {планета: индекс знака в годовой карте}; lons — долготы планет */
function panchaVargiya(planet, lon, signs) {
  const sign = Math.floor(lon / 30);
  const griha = 30 * relTo(planet, LORD[sign], signs);
  const dist = Math.abs(pmod(lon - DEBIL_POINT[planet] + 180, 360) - 180);
  const uccha = Math.round(dist / 9 * 10) / 10; // у J108 Уччха округляется до 0.1 до суммирования
  const hudda = 15 * relTo(planet, haddaRuler(lon), signs);
  const drekkana = 10 * relTo(planet, drekkanaRuler(lon), signs);
  const navamsha = 5 * relTo(planet, navamshaPosition(lon).lord, signs);
  const total = Math.round((griha + uccha + hudda + drekkana + navamsha) / 4 * 100 + 1e-7) / 100;
  const label = total >= 15 ? 'Пурна-бали' : total >= 10 ? 'Мадхья-бали' : total >= 5 ? 'Хина-бали' : 'Нишкришта-бали';
  return { total, griha, uccha, hudda, drekkana, navamsha, label };
}

// Харша бала (лекция): по 5 за каждый пункт, максимум 20
const HARSHA_HOUSE = { Солнце: 9, Луна: 3, Марс: 6, Меркурий: 1, Юпитер: 11, Венера: 5, Сатурн: 12 };
const OWN_OR_EXALT = { Солнце: [4, 0], Луна: [3, 1], Марс: [0, 7, 9], Меркурий: [2, 5], Юпитер: [8, 11, 3], Венера: [1, 6, 11], Сатурн: [9, 10, 6] };
function harshaBala(planet, house, signIndex, isDay) {
  const female = [1, 2, 3, 7, 8, 9].includes(house);
  const malePlanet = ['Солнце', 'Марс', 'Юпитер'].includes(planet);
  let n = 0;
  if (house === HARSHA_HOUSE[planet]) n += 5;
  if (OWN_OR_EXALT[planet].includes(signIndex)) n += 5;
  if (malePlanet ? !female : female) n += 5;
  if (malePlanet ? isDay : !isDay) n += 5;
  return n;
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
  const { year, mode, lat, lon } = opts;
  let utcOffset = opts.utcOffset;
  const ay = natal.ayanamshaType || 'lahiri', base = natal.customAyanamshaBase || null;
  const natalSun = natal.planets['Солнце'].siderealLon;
  const natalJD = natal.jd;
  const birthY = new Date((natalJD - 2440587.5) * 864e5).getUTCFullYear();
  if (year <= birthY) return { error: 'Годовая карта считается начиная с первого года жизни: выберите год позже ' + birthY + '.' };
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
  // Часовой пояс — на момент самой правеши (летнее время и переводы стрелок), если передана функция по координатам
  if (typeof opts.tzAt === 'function') { const o = opts.tzAt(jd); if (Number.isFinite(o)) utcOffset = o; }
  const lp = localParts(jd, utcOffset);
  const chart = calculateChart({ ...lp, utcOffset, lat, lon, ayanamshaType: ay, nodeType: natal.nodeType || 'mean', customAyanamshaBase: base });
  const age = Math.round((jd - natalJD) / 365.2425);
  const natalLagnaSign = natal.ascendant.sign.index;
  const lagnaSign = chart.ascendant.sign.index;
  const munthaSign = (natalLagnaSign + age) % 12;
  const munthaHouse = pmod(munthaSign - lagnaSign, 12) + 1;

  // День/ночь: Солнце над горизонтом — по градусу, а не по знаку. Над горизонтом Солнце, если оно
  // между Десцендентом и Асцендентом (идя против часовой через MC), то есть на 180–360° от лагны.
  const isDay = pmod(chart.planets['Солнце'].siderealLon - chart.ascendant.siderealLon, 360) >= 180;
  const signsMap = {}; SEVEN.forEach(n => { signsMap[n] = chart.planets[n].sign.index; });
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
    const bala = panchaVargiya(o.planet, p.siderealLon, signsMap);
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
  const table = SEVEN.map(n => { const b = panchaVargiya(n, chart.planets[n].siderealLon, signsMap); const pl = chart.planets[n]; return { planet: n, pvb: b.total, griha: b.griha, uccha: b.uccha, hudda: b.hudda, drekkana: b.drekkana, navamsha: b.navamsha, label: b.label, harsha: harshaBala(n, pl.house, pl.sign.index, isDay), dvadasha: dvadashaVargiya(n, pl.siderealLon) }; });

  return {
    mode, year, jd, local: lp, age, extra,
    chart, isDay,
    muntha: { sign: SIGNS[munthaSign], signIndex: munthaSign, house: munthaHouse, lord: LORD[munthaSign] },
    officers, varshesh: { planet: best.planet, role: best.role, pvb: best.pvb, byAspect: rule === 'pvb', rule },
    pvbTable: table,
    sahams: (() => { const L = { Лагна: chart.ascendant.siderealLon }; SEVEN.forEach(n => { L[n] = chart.planets[n].siderealLon; }); L.ЛагнаПати = L[LORD[lagnaSign]]; return computeSahams(L, isDay).map(x => { const si = Math.floor(x.lon / 30); return { ...x, sign: SIGNS[si], deg: x.lon % 30, house: pmod(si - lagnaSign, 12) + 1, nakshatra: NAK_NAMES[Math.min(26, Math.floor(x.lon / (360 / 27)))] }; }); })(),
    munthaMonths: (() => {
      // Мунта по месяцам (книга, стр. 112–113): за месяц +2°30′. Масапраveша — когда Солнце ушло от натальной долготы на 30°·i.
      const baseLon = pmod(natal.ascendant.siderealLon + 30 * age, 360);
      const rows = [];
      for (let i = 0; i < 12; i++) {
        let j = jd + i * 30.4;
        for (let k = 0; k < 10; k++) { const dd = signedDiff(siderealSun(j, ay, base) - (natalSun + 30 * i)); j -= dd / 0.9856; }
        const lonM = pmod(baseLon + 2.5 * i, 360), si = Math.floor(lonM / 30);
        const lp2 = localParts(j, utcOffset), pad = (n) => String(n).padStart(2, '0');
        rows.push({ n: i + 1, date: pad(lp2.day) + '.' + pad(lp2.month) + '.' + lp2.year, sign: SIGNS[si], deg: lonM % 30, house: pmod(si - lagnaSign, 12) + 1, lord: LORD[si] });
      }
      return rows;
    })(),
    mudda: muddaDasha(natal.planets['Луна'].siderealLon, age, jd, utcOffset),
    yogas: (() => { try { const m = {}; table.forEach(t => { m[t.planet] = t.pvb; }); return computeTajikaYogas(chart, m, { LORD, EXALT, FRIENDS, haddaRuler, drekkanaRuler, navamshaLord: (lon) => navamshaPosition(lon).lord }); } catch (e) { console.error('Таджика-йоги:', e.message); return []; } })(),
  };
}

const NAK_NAMES = ['Ашвини','Бхарани','Криттика','Рохини','Мригашира','Ардра','Пунарвасу','Пушья','Ашлеша','Магха','Пурва Пхалгуни','Уттара Пхалгуни','Хаста','Читра','Свати','Вишакха','Анурадха','Джьештха','Мула','Пурва Ашадха','Уттара Ашадха','Шравана','Дханишта','Шатабхиша','Пурва Бхадрапада','Уттара Бхадрапада','Ревати'];

// ---------- Дваадашаваргия-бала (книга, стр. 24–28) ----------
// Двенадцать варг. Десятая (дашамша) в тексте книги читается неоднозначно, поэтому не учитывается: считаем 11.
// Для каждой варги берётся её владыка; свой или друг по натуральной дружбе = благоприятная варга (шубха),
// враг = неблагоприятная (папа), остальное нейтрально. В раши: экзальтация = шубха, падение = папа.
const PANCHAMSHA_ODD = ['Марс','Сатурн','Юпитер','Меркурий','Венера'];
const EKADASHA_ORDER = [0, 11, 8, 9, 2, 7, 6, 5, 4, 3, 1];
function vargaLords(lon) {
  const sg = Math.floor(lon / 30), d = lon % 30, odd = sg % 2 === 0; // Овен (0) — нечётный знак
  const movable = [0, 3, 6, 9].includes(sg), fixed = [1, 4, 7, 10].includes(sg);
  const L = (i) => LORD[pmod(i, 12)];
  const out = [];
  out.push(['Раши', L(sg)]);
  out.push(['Хора', (odd ? d < 15 : d >= 15) ? 'Солнце' : 'Луна']);
  out.push(['Дреккана', L(sg + 4 * Math.floor(d / 10))]);
  out.push(['Чатуртхамша', L(sg + 3 * Math.floor(d / 7.5))]);
  const k5 = Math.floor(d / 6);
  out.push(['Панчамша', odd ? PANCHAMSHA_ODD[k5] : PANCHAMSHA_ODD[4 - k5]]);
  out.push(['Шаштхамша', L((odd ? 0 : 6) + Math.floor(d / 5))]);
  out.push(['Саптамша', L(sg + (odd ? 0 : 6) + Math.floor(d / (30 / 7)))]);
  out.push(['Аштамша', L((movable ? 0 : fixed ? 8 : 4) + Math.floor(d / 3.75))]);
  out.push(['Навамша', navamshaPosition(lon).lord]);
  out.push(['Экадашамша', L(EKADASHA_ORDER[Math.min(10, Math.floor(d / (30 / 11)))])]);
  out.push(['Двадашамша', L(sg + Math.floor(d / 2.5))]);
  return out;
}
function dvadashaVargiya(planet, lon) {
  const sg = Math.floor(lon / 30);
  let good = 0, bad = 0;
  const rows = vargaLords(lon).map(([name, lord], i) => {
    let t = 'sama';
    if (lord === planet || FRIENDS[planet].f.includes(lord)) t = 'shubha';
    else if (FRIENDS[planet].e.includes(lord)) t = 'papa';
    if (i === 0) { if (EXALT[planet][0] === sg) t = 'shubha'; else if ((EXALT[planet][0] + 6) % 12 === sg) t = 'papa'; }
    if (t === 'shubha') good++; else if (t === 'papa') bad++;
    return { varga: name, lord, type: t };
  });
  const label = good > bad ? 'Шубха' : good < bad ? 'Папа' : 'Поровну';
  return { good, bad, neutral: rows.length - good - bad, label, rows };
}

// ---------- Сахамы ----------
// Формулы A − B + C берутся из таблицы сахам (Сахамасарани) «Таджика Нилаканти», стр. 84-86:
// отдельно для дня и для ночи (где-то ночью меняются местами A и B, где-то нет, у Гаурава меняются B и C).
// Если C не лежит на дуге от B до A вперёд, к результату добавляется 30°.
// hidden: сахам нужен для расчёта другого и в списке не показывается.
const SAHAMS = [
  ['Пунья', 'Удача', ['Луна','Солнце','Лагна'], ['Солнце','Луна','Лагна']],
  ['Гуру', 'Наставник', ['Солнце','Луна','Лагна'], ['Луна','Солнце','Лагна'], true],
  ['Видья', 'Образование', ['Солнце','Луна','Лагна'], ['Луна','Солнце','Лагна']],
  ['Йаша', 'Слава', ['Юпитер','Пунья','Лагна'], ['Пунья','Юпитер','Лагна']],
  ['Митра', 'Друг', ['Гуру','Пунья','Венера'], ['Пунья','Гуру','Венера']],
  ['Махатмья', 'Величие', ['Пунья','Марс','Лагна'], ['Марс','Пунья','Лагна']],
  ['Аша', 'Желания', ['Сатурн','Венера','Лагна'], ['Венера','Сатурн','Лагна']],
  ['Самартха', 'Способности, предприимчивость', ['Марс','ЛагнаПати','Лагна'], ['ЛагнаПати','Марс','Лагна']],
  ['Бхратру', 'Брат', ['Юпитер','Сатурн','Лагна'], ['Юпитер','Сатурн','Лагна']],
  ['Гаурава', 'Уважение, признание, респектабельность', ['Юпитер','Луна','Солнце'], ['Юпитер','Солнце','Луна']],
  ['Питру', 'Отец', ['Сатурн','Солнце','Лагна'], ['Солнце','Сатурн','Лагна']],
  ['Раджья', 'Царство', ['Сатурн','Солнце','Лагна'], ['Солнце','Сатурн','Лагна']],
  ['Матру', 'Мать', ['Луна','Венера','Лагна'], ['Венера','Луна','Лагна']],
  ['Путра', 'Дети', ['Юпитер','Луна','Лагна'], ['Юпитер','Луна','Лагна']],
  ['Джива', 'Жизнь', ['Сатурн','Юпитер','Лагна'], ['Юпитер','Сатурн','Лагна']],
  ['Карма', 'Деятельность', ['Марс','Меркурий','Лагна'], ['Меркурий','Марс','Лагна']],
  ['Рога', 'Болезни', ['Лагна','Луна','Лагна'], ['Лагна','Луна','Лагна']], // по тексту книги (ст. 12): всегда лагна − Луна + лагна; в таблице для дня опечатка
];
function computeSahams(lons, isDay) {
  const val = { ...lons };
  const out = [];
  for (const [name, mean, day, night, hidden] of SAHAMS) {
    const [A, B, C] = isDay ? day : night;
    const a = val[A], b = val[B], c = val[C];
    let r = pmod(a - b + c, 360);
    if (!(pmod(c - b, 360) <= pmod(a - b, 360))) r = pmod(r + 30, 360);
    val[name] = r;
    if (!hidden) out.push({ name, mean, lon: r });
  }
  return out;
}

// ---------- Мудда-даша ----------
// Вимшоттари, сжатая до 360 дней (1 год Вимшоттари = 3 дня). Первая даша — по накшатре, которая
// на `age` накшатр дальше натальной накшатры Луны; доля пройденного та же, что у натальной Луны
// (сверено с J108: Меркурий начинается за 5.5% своего срока до правеши).
const VIM_ORDER = ['Кету', 'Венера', 'Солнце', 'Луна', 'Марс', 'Раху', 'Юпитер', 'Сатурн', 'Меркурий'];
const VIM_YEARS = { Кету: 7, Венера: 20, Солнце: 6, Луна: 10, Марс: 7, Раху: 18, Юпитер: 16, Сатурн: 19, Меркурий: 17 };
function muddaDasha(natalMoonLon, age, praveshJD, utcOffset) {
  const span = 360 / 27;
  const nakIdx = Math.floor(natalMoonLon / span), frac = (natalMoonLon % span) / span;
  const startIdx = (nakIdx + age) % 27;
  const first = startIdx % 9;
  const DAY = 3; // дней на год Вимшоттари
  const fmt = (jd) => { const p = localParts(jd, utcOffset); const pad = (n) => String(n).padStart(2, '0'); return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`; };
  let t = praveshJD - frac * VIM_YEARS[VIM_ORDER[first]] * DAY;
  const periods = [];
  for (let i = 0; i < 9; i++) {
    const lord = VIM_ORDER[(first + i) % 9];
    const len = VIM_YEARS[lord] * DAY;
    const antars = [];
    let at = t;
    for (let k = 0; k < 9; k++) {
      const al = VIM_ORDER[((first + i) + k) % 9];
      const alen = len * VIM_YEARS[al] / 120;
      antars.push({ lord: al, from: fmt(at), to: fmt(at + alen), fromJD: at, toJD: at + alen });
      at += alen;
    }
    periods.push({ lord, from: fmt(t), to: fmt(t + len), fromJD: t, toJD: t + len, antars });
    t += len;
  }
  return periods;
}

module.exports = { computeVarshaphala, panchaVargiya, muddaDasha, computeSahams, dvadashaVargiya };
