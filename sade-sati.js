// ============================================================
// sade-sati.js — Саде Сати: транзит Сатурна через 12-й, 1-й (сама Луна)
// и 2-й дом от натальной Луны (классически ~7.5-9 лет с учётом ретроградности).
//
// Метод: Сатурн движется медленно (~2.5 года на знак), поэтому для поиска
// «через сколько дней начнётся/закончится» сканируем вперёд с шагом в
// несколько дней, а не по дням — точность до дня здесь не нужна и не имеет
// практического смысла для многолетнего цикла. Результат — приблизительный
// («около N дней»), это осознанное упрощение, не ошибка.
// ============================================================

const { calculateChart } = require('./engine.js');

const SCAN_STEP_DAYS = 10;
const SCAN_MAX_DAYS_END = 11 * 365; // если Саде Сати уже идёт — целиком укладывается в ~9 лет, 11 хватает с запасом
const SCAN_MAX_DAYS_START = 32 * 365; // если ещё не началась — разрыв между циклами может доходить до ~20-22 лет (цикл Сатурна ~29.5 лет), нужен полный цикл, чтобы гарантированно найти следующее начало

function saturnSignIndexAt(date, lat, lon, utcOffset) {
  const chart = calculateChart({
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: 0,
    lat, lon, utcOffset, ayanamshaType: 'lahiri',
  });
  return chart.planets['Сатурн'].sign.index;
}

function sadeSatiPhase(saturnSignIdx, moonSignIdx) {
  const diff = (saturnSignIdx - moonSignIdx + 12) % 12;
  if (diff === 11) return { phase: 'Восходящая (12-й дом от Луны)', part: 1 };
  if (diff === 0) return { phase: 'Пиковая (транзит по натальной Луне)', part: 2 };
  if (diff === 1) return { phase: 'Заходящая (2-й дом от Луны)', part: 3 };
  return null;
}

/**
 * Текущий статус Саде Сати + прогноз ближайшей границы (начала или окончания).
 */
function computeSadeSati(natalChart, now, lat, lon, utcOffset) {
  const moonSignIdx = natalChart.planets['Луна'].sign.index;
  const currentSaturnSign = saturnSignIndexAt(now, lat, lon, utcOffset);
  const currentPhase = sadeSatiPhase(currentSaturnSign, moonSignIdx);

  const dayMs = 24 * 3600 * 1000;
  let daysAheadToChange = null;
  let willBe = null; // 'start' | 'end'

  if (currentPhase) {
    // Ищем момент выхода из Саде Сати (когда Сатурн уйдёт из 12-1-2 дома от Луны)
    for (let d = SCAN_STEP_DAYS; d <= SCAN_MAX_DAYS_END; d += SCAN_STEP_DAYS) {
      const checkDate = new Date(now.getTime() + d * dayMs);
      const signAtCheck = saturnSignIndexAt(checkDate, lat, lon, utcOffset);
      if (!sadeSatiPhase(signAtCheck, moonSignIdx)) {
        daysAheadToChange = d;
        willBe = 'end';
        break;
      }
    }
  } else {
    // Ищем момент входа в Саде Сати (когда Сатурн войдёт в 12-й дом от Луны)
    for (let d = SCAN_STEP_DAYS; d <= SCAN_MAX_DAYS_START; d += SCAN_STEP_DAYS) {
      const checkDate = new Date(now.getTime() + d * dayMs);
      const signAtCheck = saturnSignIndexAt(checkDate, lat, lon, utcOffset);
      if (sadeSatiPhase(signAtCheck, moonSignIdx)) {
        daysAheadToChange = d;
        willBe = 'start';
        break;
      }
    }
  }

  return {
    active: !!currentPhase,
    phase: currentPhase ? currentPhase.phase : null,
    part: currentPhase ? currentPhase.part : null,
    daysAheadToChange, // приблизительно, шаг сканирования 10 дней
    willBe, // 'end' если Саде Сати сейчас идёт и скоро закончится, 'start' если ещё не началась
  };
}

module.exports = { computeSadeSati, sadeSatiPhase };
