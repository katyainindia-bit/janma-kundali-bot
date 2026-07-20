// ============================================================
// Transit calculator — текущее положение планет относительно
// натальной карты (в каком доме натальной карты сейчас проходит транзит).
// ============================================================

const { calculateChart } = require('./engine.js');

/**
 * Считает текущие (на момент вызова) сидерические позиции всех планет
 * и определяет, в каком доме натальной карты они сейчас находятся.
 * @param {object} natalChart - результат calculateChart() для натальной карты
 * @param {Date} [atDate] - момент времени для расчёта транзитов (по умолчанию — сейчас)
 */
function computeCurrentTransits(natalChart, atDate = new Date()) {
  const params = {
    year: atDate.getUTCFullYear(),
    month: atDate.getUTCMonth() + 1,
    day: atDate.getUTCDate(),
    hour: atDate.getUTCHours(),
    minute: atDate.getUTCMinutes(),
    second: atDate.getUTCSeconds(),
    utcOffset: 0,
    lat: 0,
    lon: 0,
    ayanamshaType: 'lahiri',
  };
  // Долгота планет геоцентрическая и не зависит от места наблюдения,
  // поэтому lat/lon/utcOffset здесь используются только формально
  // (Асцендент транзитной "карты" далее не используется).
  const transitChart = calculateChart(params);

  const natalAscSignIdx = natalChart.ascendant.sign.index;
  const planets = {};
  for (const [name, p] of Object.entries(transitChart.planets)) {
    const transitHouse = (p.sign.index - natalAscSignIdx + 12) % 12 + 1;
    planets[name] = {
      sign: p.sign,
      nakshatra: p.nakshatra,
      transitHouse,
    };
  }

  return { asOf: atDate, planets };
}

module.exports = { computeCurrentTransits };
