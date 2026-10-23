// ============================================================
// hindu-calendar.js — расчёт индуистского календаря (без таблиц дат).
//
// Лунные месяцы (амавасья-манта: от новолуния до новолуния). Название месяца —
// по знаку, в который Солнце входит внутри месяца; если Санкранти в месяце нет —
// это Адхика-маса (лишний), праздники в нём не отмечаются.
// Праздник = (месяц, титхи) + момент суток, на который титхи должна приходиться
// (восход / полдень / послеполуденное время / вечер-прадоша / полночь).
// Все даты — местные, по месту (широта, долгота, часовой пояс).
// ============================================================

const { jdFromDate, sunLongitude, moonLongitude, lahiriAyanamsha } = require('./engine.js');
const { sunriseJD, jdToLocalDateTimeStr } = require('./panchanga.js');

function pmod(x, y) { let r = x % y; if (r < 0) r += y; return r; }
const SYNODIC = 29.530588;

const MASA_NAMES = ['Чайтра', 'Ваишакха', 'Джьештха', 'Ашадха', 'Шравана', 'Бхадрапада', 'Ашвина', 'Картика', 'Маргаширша', 'Пауша', 'Магха', 'Пхалгуна'];

const elong = (jd) => pmod(moonLongitude(jd) - sunLongitude(jd), 360);
const tithiAt = (jd) => Math.floor(elong(jd) / 12) + 1; // 1..30
// Карана в момент jd: Вишти (Бхадра) — каждая седьмая из подвижных
const isVishtiAt = (jd) => { const n = Math.floor(elong(jd) / 6) + 1; return n >= 2 && n <= 57 && (n - 2) % 7 === 6; };
const sunSignAt = (jd) => Math.floor(pmod(sunLongitude(jd) - lahiriAyanamsha(jd), 360) / 30);

// Ближайшее новолуние к приближению t0 (элонгация = 0°)
function refineNewMoon(t0) {
  let t = t0;
  for (let i = 0; i < 8; i++) {
    let d = elong(t);
    if (d > 180) d -= 360; // (-180, 180]
    t -= d / 12.19;
  }
  return t;
}

// ---------- Таблица лунных месяцев ----------
const monthCache = new Map(); // year -> [{startJD, endJD, idx, adhika}]
function monthsAround(year) {
  if (monthCache.has(year)) return monthCache.get(year);
  const jan1 = jdFromDate(year, 1, 1, 0, 0, 0, 0) - 40;
  // первое новолуние до jan1 - 40 суток
  let nm = refineNewMoon(jan1 - elong(jan1) / 12.19);
  while (nm > jan1) nm -= SYNODIC;
  nm = refineNewMoon(nm);
  const moons = [nm];
  const endJD = jdFromDate(year + 1, 1, 1, 0, 0, 0, 0) + 45;
  while (moons[moons.length - 1] < endJD) {
    const last = moons[moons.length - 1];
    moons.push(refineNewMoon(last + SYNODIC));
  }
  const months = [];
  for (let i = 0; i < moons.length - 1; i++) {
    // знак Солнца берём чуть после начала и чуть до конца (границы — моменты новолуния)
    const s1 = sunSignAt(moons[i] + 0.01);
    const s2 = sunSignAt(moons[i + 1] + 0.01);
    months.push({ startJD: moons[i], endJD: moons[i + 1], idx: (s1 + 1) % 12, adhika: s1 === s2 });
  }
  // Если Санкранти дважды (кшая-маса) — имя берём по началу; случай редкий (раз в десятилетия).
  monthCache.set(year, months);
  return months;
}
function masaAtJD(jd, year) {
  const months = monthsAround(year);
  const m = months.find(x => jd >= x.startJD && jd < x.endJD) || months[0];
  return { idx: m.idx, adhika: m.adhika, name: MASA_NAMES[m.idx] };
}

// ---------- Названия Экадаши (по месяцу и пакше) ----------
const EKADASHI_SHUKLA = ['Камада', 'Мохини', 'Нирджала (Пандава)', 'Девшаяни (Шаяна)', 'Путрада (Шравана)', 'Паршва', 'Папанкуша', 'Уттхана (Девуттхана)', 'Мокшада', 'Путрада', 'Джая (Бхаими)', 'Амалаки'];
// амавасья-манта: Кришна-пакша месяца M = пурнимант-месяц M+1
// амавасья-манта: Кришна-пакша месяца M = пурнимант-месяц M+1
const EKADASHI_KRISHNA_BY_MASA = {
  0: 'Варутхини',   // Чайтра Кришна (амавасья-манта)
  1: 'Апара',       // Ваишакха Кришна
  2: 'Йогини',      // Джьештха Кришна
  3: 'Камика',      // Ашадха Кришна
  4: 'Аджа',        // Шравана Кришна
  5: 'Индира',      // Бхадрапада Кришна
  6: 'Рама',        // Ашвина Кришна
  7: 'Утпанна',     // Картика Кришна
  8: 'Сапхала',     // Маргаширша Кришна
  9: 'Шат-тила',     // Пауша Кришна
  10: 'Виджая (Вайкунтха)', // Магха Кришна
  11: 'Папамочани', // Пхалгуна Кришна
};
// Имя Экадаши по месяцу (на момент jd) и номеру титхи (11 — Шукла, 26 — Кришна); null — Адхика-маса
function ekadashiNameAt(jd, year, tithiNumber) {
  const t = tithiNumber || tithiAt(jd);
  const m = masaAtJD(jd, year);
  if (m.adhika) return null;
  if (t === 11) return EKADASHI_SHUKLA[m.idx];
  if (t === 26) return EKADASHI_KRISHNA_BY_MASA[m.idx];
  return null;
}

// ---------- Правила праздников ----------
// masa: индекс (0 = Чайтра), tithi: 1..30 (абсолютная), moment: когда титхи должна идти
const FESTIVAL_RULES = [
  { label: 'Начало Чайтра Навратри', masa: 0, tithi: 1, moment: 'sunrise', description: 'Девять ночей поклонения Дурге — начало весеннего цикла Навратри. Также Угади и Гуди Падва.' },
  { label: 'Рама Навами', masa: 0, tithi: 9, moment: 'madhyahna', description: 'День рождения Рамы — благоприятен для начинаний, связанных со служением и идеалами.' },
  { label: 'Хануман Джаянти', masa: 0, tithi: 15, moment: 'sunrise', description: 'День рождения Ханумана — почитание преданности и силы.' },
  { label: 'Акшая Тритья', masa: 1, tithi: 3, moment: 'madhyahna', description: 'Один из самых благоприятных дней года — традиционно для покупок, инвестиций и новых начинаний.' },
  { label: 'Будда Пурнима', masa: 1, tithi: 15, moment: 'sunrise', description: 'День рождения, просветления и ухода Будды.' },
  { label: 'Ганга Дусхера', masa: 2, tithi: 10, moment: 'sunrise', description: 'День почитания Ганги.' },
  { label: 'Ратха-ятра (Пури)', masa: 3, tithi: 2, moment: 'sunrise', description: 'Колесничное шествие Джаганнатха в Пури.' },
  { label: 'Гуру Пурнима', masa: 3, tithi: 15, moment: 'sunrise', description: 'День почитания учителей и наставников — благоприятен для обучения и духовной практики.' },
  { label: 'Нага Панчами', masa: 4, tithi: 5, moment: 'sunrise', description: 'День почитания змей-нагов.' },
  { label: 'Ракша Бандхан', masa: 4, tithi: 15, moment: 'aparahna', avoidBhadra: 'moment', description: 'Праздник связи между братьями и сёстрами.' },
  { label: 'Джанмаштами', masa: 4, tithi: 23, moment: 'nishita', labelDate: 'moment', description: 'День рождения Кришны — один из важнейших духовных праздников года.' },
  { label: 'Ганеша Чатуртхи', masa: 5, tithi: 4, moment: 'madhyahna', description: 'Праздник Ганеши — благоприятен для начинаний, устраняющих препятствия.' },
  { label: 'Начало Шарад Навратри', masa: 6, tithi: 1, moment: 'sunrise', description: 'Девять ночей поклонения Дурге — главный осенний цикл Навратри.' },
  { label: 'Дуссехра (Виджаядашами)', masa: 6, tithi: 10, moment: 'aparahna', description: 'Победа добра над злом — один из самых благоприятных дней года для новых начинаний.' },
  { label: 'Шарад Пурнима', masa: 6, tithi: 15, moment: 'pradosha', description: 'Осеннее полнолуние.' },
  { label: 'Дхантерас', masa: 6, tithi: 28, moment: 'pradosha', description: 'Открывает цикл Дивали — традиционный день для покупки золота и утвари.' },
  { label: 'Дивали', masa: 6, tithi: 30, moment: 'pradosha', description: 'Праздник света — один из главных праздников года, время нового начала и почитания благополучия.' },
  { label: 'Говардхан Пуджа', masa: 7, tithi: 1, moment: 'sunrise', description: 'Почитание горы Говардхан и благодарность природе.' },
  { label: 'Бхаи Дудж', masa: 7, tithi: 2, moment: 'aparahna', pick: 'second', description: 'Праздник связи между братьями и сёстрами, завершающий цикл Дивали.' },
  { label: 'Картика Пурнима (Дев Дивали)', masa: 7, tithi: 15, moment: 'pradosha', description: 'Полнолуние месяца Картика — день огней и омовений.' },
  { label: 'Васант Панчами', masa: 10, tithi: 5, moment: 'madhyahna', description: 'Начало весны, день Сарасвати — благоприятен для обучения.' },
  { label: 'Маха Шиваратри', masa: 10, tithi: 29, moment: 'nishita', description: 'Ночь Шивы — один из сильнейших дней года для практик, поста и медитации.' },
  { label: 'Холика Дахан', masa: 11, tithi: 15, moment: 'pradosha', avoidBhadra: 'night', description: 'Сожжение Холики накануне Холи — символ победы над злом.' },
];

// Моменты суток: sr — восход, ss — закат, nsr — следующий восход (JD)
function momentJD(kind, sr, ss, nsr) {
  const day = ss - sr;
  switch (kind) {
    case 'sunrise': return sr + 0.003;       // сразу после восхода
    case 'madhyahna': return sr + day * 0.5;
    case 'aparahna': return sr + day * 0.7;
    case 'pradosha': return ss + 0.04;        // ~1 ч после заката
    case 'nishita': return ss + (nsr - ss) / 2; // середина ночи
    default: return sr;
  }
}

function localISO(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Заход Солнца — сразу после восхода тем же методом (по формуле дуги дня)
function sunsetJDFor(year, month, day, lat, lon, utcOffset, srJD) {
  const { sunriseSunsetMinutesUTC } = require('./panchanga.js');
  const noonDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0) - utcOffset * 3600 * 1000);
  const st = sunriseSunsetMinutesUTC(noonDate, lat, lon);
  if (st.sunsetUTC === undefined) return srJD + 0.5; // полярный день/ночь — условно 12 ч
  const utcMidnightJD = jdFromDate(noonDate.getUTCFullYear(), noonDate.getUTCMonth() + 1, noonDate.getUTCDate(), 0, 0, 0, 0);
  return utcMidnightJD + st.sunsetUTC / 1440;
}

const yearCache = new Map();
/**
 * Праздники и названные Экадаши за календарный год.
 * @returns {Object} { festivals: {iso:[{label, description}]}, ekadashi: {iso: name} }
 */
function computeYear(year, lat, lon, utcOffset) {
  const key = `${year}|${lat.toFixed(2)}|${lon.toFixed(2)}|${utcOffset}`;
  if (yearCache.has(key)) return yearCache.get(key);
  const days = [];
  const d0 = Date.UTC(year, 0, 1);
  const total = (Date.UTC(year + 1, 0, 1) - d0) / 86400000;
  for (let i = -1; i <= total; i++) {
    const dt = new Date(d0 + i * 86400000);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const sr = sunriseJD(y, m, d, lat, lon, utcOffset);
    const ss = sunsetJDFor(y, m, d, lat, lon, utcOffset, sr);
    const nx = new Date(d0 + (i + 1) * 86400000);
    const nsr = sunriseJD(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate(), lat, lon, utcOffset);
    days.push({ iso: localISO(y, m, d), sr, ss, nsr, inYear: y === year });
  }
  const festivals = {};
  const ekadashi = {};
  const add = (iso, label, description) => {
    (festivals[iso] = festivals[iso] || []).push({ label, description });
  };

  // Для каждого правила: день, на момент которого шла нужная титхи нужного (не адхика) месяца.
  for (const rule of FESTIVAL_RULES) {
    const hits = [];
    days.forEach((day, i) => {
      const mj = momentJD(rule.moment, day.sr, day.ss, day.nsr);
      const mm = masaAtJD(mj, year);
      if (!mm.adhika && mm.idx === rule.masa && tithiAt(mj) === rule.tithi) hits.push(i);
    });
    // Пропущенная титхи (кшая): на момент вчера t-1, сегодня t+1 — праздник в тот день, где титхи шла хоть часть суток
    if (!hits.length) {
      days.forEach((day, i) => {
        if (i === 0 || i === days.length - 1) return;
        const t1 = tithiAt(momentJD(rule.moment, day.sr, day.ss, day.nsr));
        const t2 = tithiAt(momentJD(rule.moment, days[i + 1].sr, days[i + 1].ss, days[i + 1].nsr));
        const prevTarget = rule.tithi === 1 ? 30 : rule.tithi - 1;
        const nextTarget = rule.tithi === 30 ? 1 : rule.tithi + 1;
        const mm = masaAtJD(momentJD(rule.moment, day.sr, day.ss, day.nsr), year);
        if (!mm.adhika && (mm.idx === rule.masa || mm.idx === (rule.masa + 11) % 12) && t1 === prevTarget && t2 === nextTarget) hits.push(i);
      });
    }
    // Серии подряд идущих дней: если титхи покрывает момент в два дня — по правилу (по умолчанию первый)
    const series = [];
    for (const i of hits) {
      const last = series[series.length - 1];
      if (last && i - last[last.length - 1] === 1) last.push(i); else series.push([i]);
    }
    for (const ser of series) {
      let i = rule.pick === 'second' ? ser[ser.length - 1] : ser[0];
      if (rule.avoidBhadra) {
        const mj = momentJD(rule.moment, days[i].sr, days[i].ss, days[i].nsr);
        if (isVishtiAt(mj) && days[i + 1]) {
          if (rule.avoidBhadra === 'night') {
            // Бхадра закончилась до полуночи — праздник в ту же ночь (после Бхадры); позже — переносится на следующий день
            let t = mj; while (isVishtiAt(t) && t < days[i].nsr + 0.5) t += 0.01;
            const midnight = days[i].ss + (days[i].nsr - days[i].ss) / 2;
            if (t > midnight) i = i + 1;
          } else {
            i = i + 1;
          }
        }
      }
      if (rule.labelDate === 'moment') {
        const mj = momentJD(rule.moment, days[i].sr, days[i].ss, days[i].nsr);
        const iso = jdToLocalDateTimeStr(mj, utcOffset).slice(0, 10).split('.').reverse().join('-');
        if (iso.startsWith(String(year))) add(iso, rule.label, rule.description);
        continue;
      }
      if (days[i].inYear) add(days[i].iso, rule.label, rule.description);
    }
  }

  // Холи — на следующий день после Холика Дахан
  days.forEach((day, i) => {
    const list = festivals[day.iso] || [];
    if (list.some(f => f.label === 'Холика Дахан') && days[i + 1] && days[i + 1].inYear) {
      add(days[i + 1].iso, 'Холи', 'Праздник красок и обновления.');
    }
  });

  // Макара Санкранти — вход Солнца в сидерический Козерог (до заката — в этот день, после — на следующий)
  days.forEach((day, i) => {
    if (!day.inYear) return;
    const a = sunSignAt(day.nsr - 1e-4), b = sunSignAt(day.sr - 1e-4);
    if (b === 8 && a === 9) {
      // вход произошёл между восходом дня i и восходом дня i+1
      let lo = day.sr, hi = day.nsr;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (sunSignAt(mid) === 9) hi = mid; else lo = mid; }
      const target = hi < day.ss ? day.iso : (days[i + 1] ? days[i + 1].iso : day.iso);
      add(target, 'Макара Санкранти', 'Солнце входит в Козерог — один из ключевых дней солнечного календаря.');
    }
  });

  const res = { festivals, ekadashi };
  yearCache.set(key, res);
  if (yearCache.size > 60) yearCache.delete(yearCache.keys().next().value);
  return res;
}

function festivalsForDate(dateISO, lat, lon, utcOffset) {
  const year = Number(dateISO.slice(0, 4));
  return computeYear(year, lat, lon, utcOffset).festivals[dateISO] || [];
}

module.exports = { MASA_NAMES, masaAtJD, ekadashiNameAt, computeYear, festivalsForDate, FESTIVAL_RULES, tithiAt };
