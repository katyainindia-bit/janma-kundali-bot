// ============================================================
// navamsha.js — расчёт дробной карты D9 (Навамша) на основе уже
// посчитанной натальной карты (использует те же сидерические
// долготы планет и Асцендента).
// ============================================================

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const SIGN_LORDS = ['Марс','Венера','Меркурий','Луна','Солнце','Меркурий','Венера','Марс','Юпитер','Сатурн','Сатурн','Юпитер'];

const NAVAMSHA_SPAN = 30 / 9; // 3°20'

/**
 * Считает знак и позицию внутри знака в D9 (Навамша) по сидерической
 * долготе (0-360) в основной карте (D1).
 * Формула: единая для всех знаков (не требует отдельно проверять
 * подвижность/фиксированность/двойственность знака — это уже заложено
 * в самой формуле floor(lon/span) mod 12).
 */
function navamshaPosition(siderealLon) {
  const totalPadas = Math.floor(siderealLon / NAVAMSHA_SPAN);
  const signIndex = totalPadas % 12;
  const posInPada = siderealLon % NAVAMSHA_SPAN;
  const degInSign = (posInPada / NAVAMSHA_SPAN) * 30; // масштабируем 3°20' -> 30° для отображения
  return {
    index: signIndex,
    name: SIGN_NAMES[signIndex],
    lord: SIGN_LORDS[signIndex],
    degInSign,
  };
}

/**
 * Строит полную структуру D9-карты (аналогичную по форме основной карте),
 * чтобы её можно было передать в те же функции отрисовки.
 * @param {object} chart - результат calculateChart() из engine.js
 */
function calculateNavamsha(chart) {
  const ascD9Sign = navamshaPosition(chart.ascendant.siderealLon);

  const planets = {};
  for (const [name, p] of Object.entries(chart.planets)) {
    const sign = navamshaPosition(p.siderealLon);
    const house = (sign.index - ascD9Sign.index + 12) % 12 + 1;
    planets[name] = { sign, house, retrograde: !!p.retrograde };
  }

  return {
    ascendant: { sign: ascD9Sign },
    planets,
  };
}

module.exports = { calculateNavamsha, navamshaPosition };
