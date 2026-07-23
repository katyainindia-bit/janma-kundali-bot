// ============================================================
// date-tools.js — «Дни»: персональный календарь и поиск дат под цель.
// Использует уже существующие даши (dasha.js) и тара-балу (panchanga.js) —
// новой астрономии тут нет, только сборка уже готовых расчётов по дням.
// ============================================================

const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computePanchanga, computeTaraBala } = require('./panchanga.js');

const SIGN_LORDS = ['Марс','Венера','Меркурий','Луна','Солнце','Меркурий','Венера','Марс','Юпитер','Сатурн','Сатурн','Юпитер'];

const GOOD_TARA_QUALITIES = ['благоприятно', 'наиболее благоприятно'];
const BAD_TARA_QUALITIES = ['неблагоприятно', 'наименее благоприятно'];

// Классические значения домов/карак по типам целей — начальный, обобщённый
// набор (не заменяет персональные правила автора школы, если появятся свои).
const GOALS = {
  business:    { label: 'Открытие бизнеса',   houses: [10, 2, 11], karakas: ['Меркурий', 'Юпитер'] },
  realestate:  { label: 'Покупка недвижимости', houses: [4],        karakas: ['Марс', 'Венера'] },
  relocation:  { label: 'Переезд',            houses: [4, 12],      karakas: ['Луна'] },
  travel:      { label: 'Путешествие',        houses: [3, 9],       karakas: ['Юпитер'] },
  wedding:     { label: 'Свадьба',            houses: [7],          karakas: ['Венера', 'Юпитер'] },
  education:   { label: 'Начало обучения',    houses: [4, 5, 9],    karakas: ['Юпитер', 'Меркурий'] },
  project:     { label: 'Открытие проекта',   houses: [10, 11],     karakas: ['Солнце', 'Меркурий'] },
  bigpurchase: { label: 'Крупная покупка',    houses: [2, 11],      karakas: ['Юпитер', 'Венера'] },
};

function houseLord(chart, houseNum) {
  const h = chart.houses.find(x => x.house === houseNum);
  if (!h) return null;
  return SIGN_LORDS[h.signIndex];
}

function relevantLords(chart, goalKey) {
  const goal = GOALS[goalKey];
  if (!goal) return [];
  const lords = new Set(goal.karakas);
  for (const h of goal.houses) {
    const lord = houseLord(chart, h);
    if (lord) lords.add(lord);
  }
  return [...lords];
}

/**
 * Считает "качество дня" на конкретную дату: тара-бала + текущая цепочка даш.
 * Время внутри дня берём условно (полдень по месту) — здесь важен день,
 * а не конкретный час.
 */
function dayQuality(chart, natalMoonNakIdx, dateUTC, lat, lon, utcOffset) {
  const p = computePanchanga(
    dateUTC.getUTCFullYear(), dateUTC.getUTCMonth() + 1, dateUTC.getUTCDate(), 12, 0,
    lat, lon, utcOffset
  );
  const taraBala = computeTaraBala(natalMoonNakIdx, p.nakshatraOfDayIdx);
  return { taraBala, tithi: p.tithi, nakshatraOfDay: p.nakshatraOfDay };
}

/**
 * Календарь на месяц: для каждого дня — тара-бала и признак смены
 * подпериода даши (антардаша/пратьянтардаша начались именно в этот день).
 */
function computeCalendarMonth(chart, birthDateUTC, year, month, lat, lon, utcOffset) {
  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const mahadashas = computeVimshottariDasha(chart, birthDateUTC);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const days = [];
  let prevChain = null;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateAtNoonUTC = new Date(Date.UTC(year, month - 1, d, 12, 0, 0) - utcOffset * 3600000);
    const q = dayQuality(chart, natalMoonNakIdx, dateAtNoonUTC, lat, lon, utcOffset);
    const chain = findCurrentDashaChain(mahadashas, dateAtNoonUTC);

    let dashaChange = null;
    if (chain && prevChain) {
      if (chain.mahadasha.lord !== prevChain.mahadasha.lord) {
        dashaChange = { level: 'махадаша', lord: chain.mahadasha.lord };
      } else if (chain.antardasha && (!prevChain.antardasha || chain.antardasha.lord !== prevChain.antardasha.lord)) {
        dashaChange = { level: 'антардаша', lord: chain.antardasha.lord };
      } else if (chain.pratyantardasha && (!prevChain.pratyantardasha || chain.pratyantardasha.lord !== prevChain.pratyantardasha.lord)) {
        dashaChange = { level: 'пратьянтардаша', lord: chain.pratyantardasha.lord };
      }
    }
    prevChain = chain;

    days.push({
      day: d,
      taraName: q.taraBala.name,
      taraQuality: q.taraBala.quality,
      tithi: q.tithi.name,
      dashaChange,
    });
  }
  return days;
}

/**
 * Поиск благоприятных окон под конкретную цель в заданном диапазоне дат.
 * Оценка дня (эвристика по умолчанию, можно уточнить под свою методику):
 *  +2  — лорд текущей антардаши совпадает с показателем цели (дом/карака)
 *  +1  — то же для пратьянтардаши
 *  +1  — благоприятная тара-бала дня
 *  -2  — неблагоприятная тара-бала дня
 * Дни с итоговым баллом >= 2 считаются благоприятными и группируются
 * в непрерывные окна.
 */
function computeDateSearch(chart, birthDateUTC, lat, lon, utcOffset, goalKey, fromDateUTC, toDateUTC) {
  const goal = GOALS[goalKey];
  if (!goal) throw new Error('Неизвестная цель поиска');
  const lords = relevantLords(chart, goalKey);

  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const mahadashas = computeVimshottariDasha(chart, birthDateUTC);

  const maxDays = 200; // защита от слишком широкого диапазона
  const dayMs = 24 * 3600 * 1000;
  const totalDays = Math.min(maxDays, Math.round((toDateUTC - fromDateUTC) / dayMs) + 1);

  const scored = [];
  for (let i = 0; i < totalDays; i++) {
    const dateUTC = new Date(fromDateUTC.getTime() + i * dayMs);
    const chain = findCurrentDashaChain(mahadashas, dateUTC);
    const q = dayQuality(chart, natalMoonNakIdx, dateUTC, lat, lon, utcOffset);

    let score = 0;
    if (chain && chain.antardasha && lords.includes(chain.antardasha.lord)) score += 2;
    if (chain && chain.pratyantardasha && lords.includes(chain.pratyantardasha.lord)) score += 1;
    if (GOOD_TARA_QUALITIES.includes(q.taraBala.quality)) score += 1;
    if (BAD_TARA_QUALITIES.includes(q.taraBala.quality)) score -= 2;

    scored.push({ date: dateUTC.toISOString().slice(0, 10), score, taraQuality: q.taraBala.quality });
  }

  // Группируем последовательные благоприятные дни (score >= 2) в окна
  const windows = [];
  let current = null;
  for (const s of scored) {
    if (s.score >= 2) {
      if (!current) current = { start: s.date, end: s.date, maxScore: s.score };
      else { current.end = s.date; current.maxScore = Math.max(current.maxScore, s.score); }
    } else if (current) {
      windows.push(current);
      current = null;
    }
  }
  if (current) windows.push(current);
  // Соседние окна, разделённые парой неблагоприятных по таре дней внутри
  // того же благоприятного периода даши, объединяем — иначе результат
  // рассыпается на россыпь однодневных промежутков и читать его неудобно.
  const MERGE_GAP_DAYS = 2;
  const merged = [];
  for (const w of windows.sort((a, b) => a.start.localeCompare(b.start))) {
    const last = merged[merged.length - 1];
    if (last) {
      const gapDays = Math.round((new Date(w.start) - new Date(last.end)) / dayMs);
      if (gapDays <= MERGE_GAP_DAYS) {
        last.end = w.end;
        last.maxScore = Math.max(last.maxScore, w.maxScore);
        continue;
      }
    }
    merged.push({ ...w });
  }
  merged.sort((a, b) => b.maxScore - a.maxScore);

  return {
    goalLabel: goal.label,
    relevantLords: lords,
    windows: merged.slice(0, 10),
  };
}

module.exports = { GOALS, computeCalendarMonth, computeDateSearch };
