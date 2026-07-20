// ============================================================
// Vimshottari Dasha calculator — три уровня периодов:
// Махадаша → Антардаша → Пратьянтардаша.
// Стандартный 120-летний цикл, начало от накшатры Луны на момент рождения.
// ============================================================

const FULL_YEARS = {
  'Кету': 7, 'Венера': 20, 'Солнце': 6, 'Луна': 10, 'Марс': 7,
  'Раху': 18, 'Юпитер': 16, 'Сатурн': 19, 'Меркурий': 17
};
const CYCLE_ORDER = ['Кету', 'Венера', 'Солнце', 'Луна', 'Марс', 'Раху', 'Юпитер', 'Сатурн', 'Меркурий'];
const TOTAL_CYCLE_YEARS = 120;
const DAYS_PER_YEAR = 365.25; // стандартное допущение, принятое в большинстве джйотиш-калькуляторов

const SANSKRIT_TO_RUSSIAN = {
  'Кету': 'Кету', 'Шукра': 'Венера', 'Сурья': 'Солнце', 'Чандра': 'Луна',
  'Мангал': 'Марс', 'Раху': 'Раху', 'Гуру': 'Юпитер', 'Шани': 'Сатурн', 'Буддха': 'Меркурий'
};

// Та же последовательность владык накшатр, что и в engine.js (27 накшатр, цикл по 9)
const NAKSHATRA_LORDS_SANSKRIT = [
  'Кету','Шукра','Сурья','Чандра','Мангал','Раху','Гуру','Шани','Буддха',
  'Кету','Шукра','Сурья','Чандра','Мангал','Раху','Гуру','Шани','Буддха',
  'Кету','Шукра','Сурья','Чандра','Мангал','Раху','Гуру','Шани','Буддха'
];

function addYears(date, years) {
  return new Date(date.getTime() + years * DAYS_PER_YEAR * 24 * 3600 * 1000);
}

// Делит родительский период на 9 под-периодов в фиксированном цикличном порядке,
// начиная с планеты-владыки самого родительского периода.
// virtualStart может быть раньше actualStart (для первого, "балансового" периода жизни) —
// это стандартный приём: под-периоды считаются от теоретического начала всего цикла,
// а видимое окно обрезается по actualStart/actualEnd.
function computeSubPeriods(parentLord, parentFullYears, virtualStart, actualStart, actualEnd) {
  const startIdx = CYCLE_ORDER.indexOf(parentLord);
  let cursor = virtualStart;
  const results = [];
  for (let i = 0; i < 9; i++) {
    const lord = CYCLE_ORDER[(startIdx + i) % 9];
    const durYears = (FULL_YEARS[lord] * parentFullYears) / TOTAL_CYCLE_YEARS;
    const fullStart = cursor;
    const fullEnd = addYears(cursor, durYears);
    if (fullEnd > actualStart && fullStart < actualEnd) {
      results.push({
        lord,
        fullStart, fullEnd,
        start: fullStart < actualStart ? actualStart : fullStart,
        end: fullEnd > actualEnd ? actualEnd : fullEnd,
        fullYears: durYears
      });
    }
    cursor = fullEnd;
  }
  return results;
}

/**
 * Считает полную структуру Вимшоттари даши по натальной карте.
 * @param {object} chart - результат calculateChart() из engine.js
 * @param {Date} birthDateUTC - дата/время рождения в UTC
 * @param {number} yearsToShow - на сколько лет вперёд считать (по умолчанию 120 — весь цикл)
 */
function computeVimshottariDasha(chart, birthDateUTC, yearsToShow = 120) {
  const nakSpan = 360 / 27;
  const moonLon = chart.planets['Луна'].siderealLon;
  const moonNakshatraIdx = Math.floor(moonLon / nakSpan);
  const startLordSanskrit = NAKSHATRA_LORDS_SANSKRIT[moonNakshatraIdx];
  const startLord = SANSKRIT_TO_RUSSIAN[startLordSanskrit];

  const posInNak = moonLon - moonNakshatraIdx * nakSpan;
  const elapsedFraction = posInNak / nakSpan;

  const virtualStart = new Date(
    birthDateUTC.getTime() - elapsedFraction * FULL_YEARS[startLord] * DAYS_PER_YEAR * 24 * 3600 * 1000
  );
  const actualEnd = addYears(birthDateUTC, yearsToShow);

  const mahadashas = computeSubPeriods(startLord, TOTAL_CYCLE_YEARS, virtualStart, birthDateUTC, actualEnd);

  for (const md of mahadashas) {
    md.antardashas = computeSubPeriods(md.lord, FULL_YEARS[md.lord], md.fullStart, md.start, md.end);
    for (const ad of md.antardashas) {
      ad.pratyantardashas = computeSubPeriods(ad.lord, ad.fullYears, ad.fullStart, ad.start, ad.end);
    }
  }

  return mahadashas;
}

function findCurrentPeriod(periods, date) {
  return periods.find(p => date >= p.start && date < p.end);
}

// Находит текущий действующий период на всех трёх уровнях одновременно.
function findCurrentDashaChain(mahadashas, date) {
  const md = findCurrentPeriod(mahadashas, date);
  if (!md) return null;
  const ad = findCurrentPeriod(md.antardashas, date);
  if (!ad) return { mahadasha: md, antardasha: null, pratyantardasha: null };
  const pd = findCurrentPeriod(ad.pratyantardashas, date);
  return { mahadasha: md, antardasha: ad, pratyantardasha: pd || null };
}

module.exports = {
  computeVimshottariDasha,
  findCurrentPeriod,
  findCurrentDashaChain,
  FULL_YEARS,
  CYCLE_ORDER,
};
