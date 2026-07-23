// ============================================================
// divisional-charts.js — остальные дробные карты (варги), кроме
// уже существующих D9 (navamsha.js) и D10 (dashamsha.js).
//
// Все карты строятся по одному и тому же принципу: делим долготу
// внутри знака (0-30°) на N равных частей, и по классическому
// правилу определяем, с какого знака начинается отсчёт (иногда это
// сам знак, иногда — по чётности, иногда — по группе: подвижные/
// фиксированные/двойственные знаки, огонь/земля/воздух/вода и т.д.),
// а затем идём по знакам либо последовательно (+1), либо через
// фиксированный шаг ("трин" — через 4 для D3, "кендра" — через 3 для D4).
//
// Три карты — D2 (Хора), D30 (Тримшамша) и D60 (Шаштиамша) — не
// укладываются в эту простую схему и считаются отдельными функциями
// по своим классическим (неравномерным либо направленным) правилам.
// ============================================================

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const SIGN_LORDS = ['Марс','Венера','Меркурий','Луна','Солнце','Меркурий','Венера','Марс','Юпитер','Сатурн','Сатурн','Юпитер'];

// Группы знаков (0-based индексы), нужны для правил старта у некоторых варг
const MOVABLE = [0, 3, 6, 9];   // Овен, Рак, Весы, Козерог
const FIXED   = [1, 4, 7, 10];  // Телец, Лев, Скорпион, Водолей
const DUAL    = [2, 5, 8, 11];  // Близнецы, Дева, Стрелец, Рыбы

const FIRE  = [0, 4, 8];   // Овен, Лев, Стрелец
const EARTH = [1, 5, 9];   // Телец, Дева, Козерог
const AIR   = [2, 6, 10];  // Близнецы, Весы, Водолей
const WATER = [3, 7, 11];  // Рак, Скорпион, Рыбы

function pmod(x, n) { return ((x % n) + n) % n; }

function makeSignResult(signIndex, degInSign) {
  return { index: signIndex, name: SIGN_NAMES[signIndex], lord: SIGN_LORDS[signIndex], degInSign };
}

/**
 * Общий движок: N равных частей знака, старт по правилу startSignFn,
 * шаг step (обычно 1, для D3/D4 — через трин/кендру).
 */
function equalDivisionVarga(siderealLon, N, startSignFn, step = 1) {
  const signIndex0 = Math.floor(siderealLon / 30);
  const degInSignD1 = siderealLon % 30;
  const spanDeg = 30 / N;
  const padaIdx = Math.min(N - 1, Math.floor(degInSignD1 / spanDeg)); // защита от округления на самой границе 30°
  const startSign = startSignFn(signIndex0);
  const resultSign = pmod(startSign + step * padaIdx, 12);
  const posInPada = degInSignD1 - padaIdx * spanDeg;
  const degInSign = (posInPada / spanDeg) * 30;
  return makeSignResult(resultSign, degInSign);
}

// --- D3: Дрекана (братья/сёстры, усилия) — "трин": сам знак / 5-й / 9-й ---
function drekkanaPosition(lon) {
  return equalDivisionVarga(lon, 3, (s) => s, 4);
}

// --- D4: Чатуртхамша (недвижимость, удача) — "кендра": сам / 4-й / 7-й / 10-й ---
function chaturthamshaPosition(lon) {
  return equalDivisionVarga(lon, 4, (s) => s, 3);
}

// --- D7: Саптамша (дети) — нечётные знаки от себя, чётные — от 7-го от себя ---
function saptamshaPosition(lon) {
  return equalDivisionVarga(lon, 7, (s) => (s % 2 === 0 ? s : (s + 6) % 12), 1);
}

// --- D12: Двадашамша (родители) — всегда от самого знака ---
function dvadashamshaPosition(lon) {
  return equalDivisionVarga(lon, 12, (s) => s, 1);
}

// --- D16: Шодашамша (транспорт, общее счастье) — по природе знака ---
function shodashamshaPosition(lon) {
  return equalDivisionVarga(lon, 16, (s) => {
    if (MOVABLE.includes(s)) return 0;  // Овен
    if (FIXED.includes(s)) return 4;    // Лев
    return 8;                            // Стрелец (двойственные)
  }, 1);
}

// --- D20: Вимшамша (духовный прогресс) — по природе знака (другой набор стартов) ---
function vimshamshaPosition(lon) {
  return equalDivisionVarga(lon, 20, (s) => {
    if (MOVABLE.includes(s)) return 0;  // Овен
    if (FIXED.includes(s)) return 8;    // Стрелец
    return 4;                            // Лев (двойственные)
  }, 1);
}

// --- D24: Чатурвимшамша (образование) — нечётные от Льва, чётные от Рака ---
function chaturvimshamshaPosition(lon) {
  return equalDivisionVarga(lon, 24, (s) => (s % 2 === 0 ? 4 : 3), 1);
}

// --- D27: Бхамша/Накшатрамша (сила и слабость) — по стихии знака ---
function bhamshaPosition(lon) {
  return equalDivisionVarga(lon, 27, (s) => {
    if (FIRE.includes(s)) return 0;   // Овен
    if (EARTH.includes(s)) return 3;  // Рак
    if (AIR.includes(s)) return 6;    // Весы
    return 9;                          // Козерог (вода)
  }, 1);
}

// --- D40: Хаведамша (благоприятные/неблагоприятные эффекты по линии рода) ---
function khavedamshaPosition(lon) {
  return equalDivisionVarga(lon, 40, (s) => (s % 2 === 0 ? 0 : 6), 1); // нечётные от Овна, чётные от Весов
}

// --- D45: Акшаведамша (общий характер, поведение) — по природе знака ---
function akshavedamshaPosition(lon) {
  return equalDivisionVarga(lon, 45, (s) => {
    if (MOVABLE.includes(s)) return 0;  // Овен
    if (FIXED.includes(s)) return 4;    // Лев
    return 8;                            // Стрелец
  }, 1);
}

// --- D2: Хора (богатство) — всегда либо Рак, либо Лев ---
function horaPosition(lon) {
  const signIndex0 = Math.floor(lon / 30);
  const degInSignD1 = lon % 30;
  const isOddSign = signIndex0 % 2 === 0; // 0-based чётный индекс = нечётный знак
  const firstHalf = degInSignD1 < 15;
  // Нечётные знаки: 1-я половина — Лев (Солнце), 2-я — Рак (Луна).
  // Чётные знаки: наоборот.
  const resultSign = isOddSign
    ? (firstHalf ? 4 : 3)
    : (firstHalf ? 3 : 4);
  const posInHalf = degInSignD1 % 15;
  const degInSign = (posInHalf / 15) * 30;
  return makeSignResult(resultSign, degInSign);
}

// --- D30: Тримшамша (трудности, недостатки) — неравные сегменты по BPHS ---
const TRIMSHAMSHA_ODD = [
  { end: 5, sign: 0 },   // Марс — Овен
  { end: 10, sign: 10 }, // Сатурн — Водолей
  { end: 18, sign: 8 },  // Юпитер — Стрелец
  { end: 25, sign: 2 },  // Меркурий — Близнецы
  { end: 30, sign: 6 },  // Венера — Весы
];
const TRIMSHAMSHA_EVEN = [
  { end: 5, sign: 1 },   // Венера — Телец
  { end: 12, sign: 5 },  // Меркурий — Дева
  { end: 20, sign: 11 }, // Юпитер — Рыбы
  { end: 25, sign: 9 },  // Сатурн — Козерог
  { end: 30, sign: 7 },  // Марс — Скорпион
];
function trimshamshaPosition(lon) {
  const signIndex0 = Math.floor(lon / 30);
  const degInSignD1 = lon % 30;
  const isOddSign = signIndex0 % 2 === 0;
  const table = isOddSign ? TRIMSHAMSHA_ODD : TRIMSHAMSHA_EVEN;
  let segStart = 0;
  for (const seg of table) {
    if (degInSignD1 < seg.end) {
      const span = seg.end - segStart;
      const degInSign = ((degInSignD1 - segStart) / span) * 30;
      return makeSignResult(seg.sign, degInSign);
    }
    segStart = seg.end;
  }
  // На случай погрешности округления ровно в 30° — берём последний сегмент
  const last = table[table.length - 1];
  return makeSignResult(last.sign, 29.999);
}

// --- D60: Шаштиамша (самая тонкая карта, кармическая предыстория) ---
// Общепринятый алгоритмический аналог классической таблицы 60 деят:
// нечётные знаки — считаем вперёд от самого знака, чётные — назад,
// цикл длиной 12 (60 = 12 x 5).
function shashtiamshaPosition(lon) {
  const signIndex0 = Math.floor(lon / 30);
  const degInSignD1 = lon % 30;
  const spanDeg = 30 / 60;
  const padaIdx = Math.min(59, Math.floor(degInSignD1 / spanDeg)); // 0-59
  const reduced = padaIdx % 12;
  const isOddSign = signIndex0 % 2 === 0;
  const resultSign = isOddSign
    ? pmod(signIndex0 + reduced, 12)
    : pmod(signIndex0 - reduced, 12);
  const posInPada = degInSignD1 - padaIdx * spanDeg;
  const degInSign = (posInPada / spanDeg) * 30;
  return makeSignResult(resultSign, degInSign);
}

// --- Общая обёртка: строит полную структуру варги (как D9/D10) по натальной карте ---
function buildVargaChart(chart, positionFn) {
  const ascSign = positionFn(chart.ascendant.siderealLon);
  const planets = {};
  for (const [name, p] of Object.entries(chart.planets)) {
    const sign = positionFn(p.siderealLon);
    const house = (sign.index - ascSign.index + 12) % 12 + 1;
    planets[name] = { sign, house, retrograde: !!p.retrograde };
  }
  return { ascendant: { sign: ascSign }, planets };
}

const VARGA_DEFS = {
  d2: { label: 'Хора (D2)', positionFn: horaPosition },
  d3: { label: 'Дрекана (D3)', positionFn: drekkanaPosition },
  d4: { label: 'Чатуртхамша (D4)', positionFn: chaturthamshaPosition },
  d7: { label: 'Саптамша (D7)', positionFn: saptamshaPosition },
  d12: { label: 'Двадашамша (D12)', positionFn: dvadashamshaPosition },
  d16: { label: 'Шодашамша (D16)', positionFn: shodashamshaPosition },
  d20: { label: 'Вимшамша (D20)', positionFn: vimshamshaPosition },
  d24: { label: 'Чатурвимшамша (D24)', positionFn: chaturvimshamshaPosition },
  d27: { label: 'Бхамша (D27)', positionFn: bhamshaPosition },
  d30: { label: 'Тримшамша (D30)', positionFn: trimshamshaPosition },
  d40: { label: 'Хаведамша (D40)', positionFn: khavedamshaPosition },
  d45: { label: 'Акшаведамша (D45)', positionFn: akshavedamshaPosition },
  d60: { label: 'Шаштиамша (D60)', positionFn: shashtiamshaPosition },
};

function calculateVarga(chart, key) {
  const def = VARGA_DEFS[key];
  if (!def) throw new Error(`Неизвестная варга: ${key}`);
  return buildVargaChart(chart, def.positionFn);
}

module.exports = {
  calculateVarga,
  VARGA_DEFS,
  // экспортируем и отдельные функции — на случай точечных проверок/тестов
  horaPosition, drekkanaPosition, chaturthamshaPosition, saptamshaPosition,
  dvadashamshaPosition, shodashamshaPosition, vimshamshaPosition,
  chaturvimshamshaPosition, bhamshaPosition, trimshamshaPosition,
  khavedamshaPosition, akshavedamshaPosition, shashtiamshaPosition,
};
