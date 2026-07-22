// ============================================================
// dashamsha.js — расчёт дробной карты D10 (Дашамша) на основе уже
// посчитанной натальной карты (использует те же сидерические
// долготы планет и Асцендента). Дашамша традиционно связана
// с карьерой, статусом и профессиональной реализацией.
// ============================================================

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const SIGN_LORDS = ['Марс','Венера','Меркурий','Луна','Солнце','Меркурий','Венера','Марс','Юпитер','Сатурн','Сатурн','Юпитер'];

const DASHAMSHA_SPAN = 30 / 10; // 3°00'

/**
 * Считает знак и позицию внутри знака в D10 (Дашамша) по сидерической
 * долготе (0-360) в основной карте (D1).
 * Классическое правило (в отличие от D9, здесь оно НЕ сводится к единой
 * формуле на весь круг): у нечётных знаков (Овен, Близнецы, Лев, Весы,
 * Стрелец, Водолей) отсчёт 10 частей идёт от самого знака; у чётных
 * (Телец, Рак, Дева, Скорпион, Козерог, Рыбы) — от знака, отстоящего
 * на 9 позиций вперёд (т.е. от знака +8 по индексу).
 */
function dashamshaPosition(siderealLon) {
  const signIndex0 = Math.floor(siderealLon / 30); // 0-based знак в D1
  const degInSignD1 = siderealLon % 30;
  const padaIdx = Math.floor(degInSignD1 / DASHAMSHA_SPAN); // 0-9

  const isOddSign = signIndex0 % 2 === 0; // 0-based чётный индекс = нечётный знак (Овен и т.д.)
  const startSign = isOddSign ? signIndex0 : (signIndex0 + 8) % 12;
  const signIndex = (startSign + padaIdx) % 12;

  const posInPada = degInSignD1 % DASHAMSHA_SPAN;
  const degInSign = (posInPada / DASHAMSHA_SPAN) * 30; // масштабируем 3° -> 30° для отображения

  return {
    index: signIndex,
    name: SIGN_NAMES[signIndex],
    lord: SIGN_LORDS[signIndex],
    degInSign,
  };
}

/**
 * Строит полную структуру D10-карты (аналогичную по форме основной карте),
 * чтобы её можно было передать в те же функции отрисовки.
 * @param {object} chart - результат calculateChart() из engine.js
 */
function calculateDashamsha(chart) {
  const ascD10Sign = dashamshaPosition(chart.ascendant.siderealLon);

  const planets = {};
  for (const [name, p] of Object.entries(chart.planets)) {
    const sign = dashamshaPosition(p.siderealLon);
    const house = (sign.index - ascD10Sign.index + 12) % 12 + 1;
    planets[name] = { sign, house };
  }

  return {
    ascendant: { sign: ascD10Sign },
    planets,
  };
}

module.exports = { calculateDashamsha, dashamshaPosition };
