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

function saturnAt(date, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase) {
  const chart = calculateChart({
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: 0,
    lat, lon, utcOffset, ayanamshaType: ayanamshaType || 'lahiri', customAyanamshaBase,
  });
  return chart.planets['Сатурн'];
}
function saturnSignIndexAt(date, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase) {
  return saturnAt(date, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase).sign.index;
}

function sadeSatiPhase(saturnSignIdx, moonSignIdx) {
  const diff = (saturnSignIdx - moonSignIdx + 12) % 12;
  if (diff === 11) return { phase: 'Восходящая (12-й дом от Луны)', part: 1 };
  if (diff === 0) return { phase: 'Пиковая (транзит по натальной Луне)', part: 2 };
  if (diff === 1) return { phase: 'Заходящая (2-й дом от Луны)', part: 3 };
  return null;
}

// Режим «45°»: Сатурн в пределах 45° от натальной Луны (по долготе, в обе стороны).
// Фазы делим по 30°-дугам: до Луны (−45…−15°) — восходящая, около Луны (−15…+15°) — пиковая,
// после Луны (+15…+45°) — заходящая.
function sadeSatiPhaseDeg(saturnLon, moonLon) {
  let d = ((saturnLon - moonLon + 540) % 360) - 180; // −180…180
  if (d < -45 || d > 45) return null;
  if (d < -15) return { phase: 'Восходящая (Сатурн до Луны, в пределах 45°)', part: 1 };
  if (d <= 15) return { phase: 'Пиковая (Сатурн рядом с Луной)', part: 2 };
  return { phase: 'Заходящая (Сатурн после Луны, в пределах 45°)', part: 3 };
}

/**
 * Текущий статус Саде Сати + прогноз ближайшей границы (начала или окончания).
 */
function computeSadeSati(natalChart, now, lat, lon, utcOffset, mode) {
  const moonSignIdx = natalChart.planets['Луна'].sign.index;
  // Аянамшу и кастомную базу берём с натальной карты, а не захардкоженный
  // Лахири — иначе для пользователей с другими настройками транзитный
  // Сатурн и натальная Луна оказываются в разных системах отсчёта.
  const ayanamshaType = natalChart.ayanamshaType || 'lahiri';
  const customAyanamshaBase = natalChart.customAyanamshaBase || null;
  const deg45 = mode === 'deg45';
  const moonLon = natalChart.planets['Луна'].siderealLon;
  const phaseAt = (date) => {
    const sat = saturnAt(date, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase);
    return deg45 ? sadeSatiPhaseDeg(sat.siderealLon, moonLon) : sadeSatiPhase(sat.sign.index, moonSignIdx);
  };
  const currentPhase = phaseAt(now);

  const dayMs = 24 * 3600 * 1000;
  let daysAheadToChange = null;
  let willBe = null; // 'start' | 'end'

  if (currentPhase) {
    // Ищем момент выхода из Саде Сати (когда Сатурн уйдёт из 12-1-2 дома от Луны)
    for (let d = SCAN_STEP_DAYS; d <= SCAN_MAX_DAYS_END; d += SCAN_STEP_DAYS) {
      const checkDate = new Date(now.getTime() + d * dayMs);
      if (!phaseAt(checkDate)) {
        daysAheadToChange = d;
        willBe = 'end';
        break;
      }
    }
  } else {
    // Ищем момент входа в Саде Сати (когда Сатурн войдёт в 12-й дом от Луны)
    for (let d = SCAN_STEP_DAYS; d <= SCAN_MAX_DAYS_START; d += SCAN_STEP_DAYS) {
      const checkDate = new Date(now.getTime() + d * dayMs);
      if (phaseAt(checkDate)) {
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
