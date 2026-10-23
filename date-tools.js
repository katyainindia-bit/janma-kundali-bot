// ============================================================
// date-tools.js — «Дни»: персональный календарь и поиск дат под цель.
// Использует уже существующие даши (dasha.js) и тара-балу (panchanga.js) —
// новой астрономии тут нет, только сборка уже готовых расчётов по дням.
// ============================================================

const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computePanchanga, computeTaraBala, computeDayNakshatraSegments, computeFactorBoundariesJD, computeTithiSpans, sunriseJD, jdToLocalDateTimeStr } = require('./panchanga.js');
const { computeCurrentTransits } = require('./transits.js');
const { ACTIONS, ACTION_RULES, evaluateAction } = require('./muhurta.js');
const { evaluateGoalPeriod } = require('./goal-period.js');
const { getEventsForDate } = require('./calendar-events.js');

/** Окно ведических суток для титхи-событий: [восход, следующий восход) по месту. */
function tithiWindow(year, month, day, lat, lon, utcOffset) {
  const startJD = sunriseJD(year, month, day, lat, lon, utcOffset);
  const nx = new Date(Date.UTC(year, month - 1, day) + 86400000);
  const endJD = sunriseJD(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate(), lat, lon, utcOffset);
  return { startJD, endJD, utcOffset, spans: computeTithiSpans(startJD, endJD) };
}
/** События дня для показа: Пурнима/Амавасья/Экадаши — с временем начала/конца внутри суток. */
function windowEventsForDate(year, month, day, lat, lon, utcOffset) {
  const win = tithiWindow(year, month, day, lat, lon, utcOffset);
  return getEventsForDate(year, month, day, null, win);
}
const { houseMeaningPhrase, computeDayTier } = require('./day-summary.js');

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


// Отрезок дня для клиента: накшатра/тара + Луна/Чандра-бала + общий тон (good/moderate/bad)
function segOut(sg) {
  return {
    nakshatra: sg.nakshatra, from: sg.from, to: sg.to, fromDate: sg.fromDate, toDate: sg.toDate, share: sg.share,
    taraName: sg.tara.name, taraQuality: sg.tara.quality,
    moonSign: sg.moonSign,
    chandraHouse: sg.chandra ? sg.chandra.house : null,
    chandraQuality: sg.chandra ? sg.chandra.quality : null,
    tone: sg.tone,
    paksha: sg.paksha,
  };
}
const natalMoonSignOf = (chart) => Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;

/**
 * Считает "качество дня" на конкретную дату: тара-бала + текущая цепочка даш.
 * Время внутри дня берём условно (полдень по месту) — здесь важен день,
 * а не конкретный час.
 */
function dayQuality(chart, natalMoonNakIdx, dateUTC, lat, lon, utcOffset) {
  const p = computePanchanga(
    dateUTC.getUTCFullYear(), dateUTC.getUTCMonth() + 1, dateUTC.getUTCDate(), 12, 0,
    lat, lon, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase
  );
  // Тара-бала дня — по накшатре на ВОСХОД; если в течение дня накшатра
  // меняется, остальные отрезки лежат в segments (единый расчёт для
  // календаря, «Сегодня» и деталей дня).
  const day = computeDayNakshatraSegments(
    dateUTC.getUTCFullYear(), dateUTC.getUTCMonth() + 1, dateUTC.getUTCDate(),
    lat, lon, utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, natalMoonSignOf(chart)
  );
  const first = day.segments[0];
  return { taraBala: first.tara, tithi: p.tithi, nakshatraOfDay: first.nakshatra, segments: day.segments, sunrise: day.sunrise };
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
      tone: q.segments[0].tone,
      segments: q.segments.map(segOut),
      tithi: q.tithi.name,
      dashaChange,
      vara: q.vara,
      events: windowEventsForDate(year, month, d, lat, lon, utcOffset),
    });
  }
  return days;
}

/**
 * Личные показатели отрезка (Тара + Чандра-бала от Джанма-раши) одним тоном —
 * тем же, каким окрашен календарь. Движок мухурты использует именно его.
 */
function personalFromSegment(sg) {
  return {
    tone: sg.tone,
    taraText: `Тара ${sg.tara.name} (${sg.tara.quality})`,
    chandraText: sg.chandra ? `Чандра-бала: Луна в ${sg.chandra.house}-м доме от Джанма-раши (${sg.chandra.quality})` : '',
  };
}

/**
 * Делит отрезки дня (накшатра/Луна/пакша) дополнительно в моменты смены Караны,
 * титхи и Нитья-йоги. Так «Вишти» ограничивает дело только на те часы, пока она
 * идёт, а не весь отрезок. Тон (личные показатели) у частей наследуется.
 */
function subdivideSegments(segments, utcOffset) {
  if (!segments.length) return segments;
  const cuts = computeFactorBoundariesJD(segments[0].fromJD, segments[segments.length - 1].toJD);
  const hhmm = (jd) => jdToLocalDateTimeStr(jd, utcOffset).slice(11);
  const dmy = (jd) => jdToLocalDateTimeStr(jd, utcOffset).slice(0, 10);
  const out = [];
  for (const sg of segments) {
    const inner = cuts.filter(j => j > sg.fromJD + 1e-4 && j < sg.toJD - 1e-4);
    const edges = [sg.fromJD, ...inner, sg.toJD];
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i], b = edges[i + 1];
      out.push(Object.assign({}, sg, {
        fromJD: a, toJD: b,
        from: i === 0 ? sg.from : hhmm(a), fromDate: i === 0 ? sg.fromDate : dmy(a),
        to: i === edges.length - 2 ? sg.to : hhmm(b), toDate: i === edges.length - 2 ? sg.toDate : dmy(b),
      }));
    }
  }
  return out;
}

// Аста (сожжение): Юпитер ближе 11° к Солнцу, Венера ближе 10°. Считаем раз в сутки (кэш).
const ASTA_ORB = { 'Юпитер': 11, 'Венера': 10 };
const astaCache = new Map();
function astaPlanetsAt(jdMid, chart) {
  const key = Math.floor(jdMid + 0.5) + ':' + (chart.ayanamshaType || '');
  if (astaCache.has(key)) return astaCache.get(key);
  const d = new Date((jdMid - 2440587.5) * 86400000);
  const c = calculateChart({
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: 0, utcOffset: 0, lat: 0, lon: 0,
    ayanamshaType: chart.ayanamshaType || 'lahiri', nodeType: chart.nodeType || 'mean',
    customAyanamshaBase: chart.customAyanamshaBase || null,
  });
  const sun = c.planets['Солнце'].siderealLon;
  const out = Object.keys(ASTA_ORB).filter((pl) => {
    const diff = Math.abs(((c.planets[pl].siderealLon - sun + 540) % 360) - 180);
    return (180 - diff) < ASTA_ORB[pl];
  });
  if (astaCache.size > 800) astaCache.clear();
  astaCache.set(key, out);
  return out;
}

/** Контекст мухурты для одного отрезка дня (панчанга берётся на середину отрезка). */
function buildSegmentCtx(chart, sg, year, month, day, lat, lon, utcOffset, events, extra) {
  const midMs = ((sg.fromJD + sg.toJD) / 2 - 2440587.5) * 86400000;
  const localMid = new Date(midMs + utcOffset * 3600000);
  const pMid = computePanchanga(
    localMid.getUTCFullYear(), localMid.getUTCMonth() + 1, localMid.getUTCDate(), localMid.getUTCHours(), localMid.getUTCMinutes(),
    lat, lon, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase
  );
  return Object.assign({
    tithiNumber: pMid.tithi.number,
    nakshatraIdx: sg.nakshatraIdx,
    nakshatraPada: pMid.nakshatraPada,
    weekdayIdx: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    yogaName: pMid.yoga.name,
    karanaName: pMid.karana.name,
    personal: personalFromSegment(sg),
    calendarEvents: events,
    astaPlanets: astaPlanetsAt((sg.fromJD + sg.toJD) / 2, chart),
  }, extra || {});
}

const whyOf = (r) => ({
  strict: r.strict,
  plus: [...r.mainPlus, ...r.addPlus],
  minus: [...r.mainMinus, ...r.addMinus],
  context: r.context,
});

/**
 * Оценка дел на одном отрезке/моменте:
 *  - simple: «Благоприятно» (до 4, только со статусом supported) и «Лучше отложить»
 *    (только строгие ограничения, до 4) — для «Сегодня» и «Дней»;
 *  - major: крупные дела (и «правила требуют уточнения») — только для «Дней».
 * Дела без основания (insufficient) в списки НЕ попадают: «недостаточно оснований»
 * не равно «хорошо» и не равно «плохо».
 */
function evaluateMuhurtaLists(ctx) {
  const all = Object.keys(ACTION_RULES).map(k => evaluateAction(k, ctx));
  const simple = all.filter(r => r.category === 'simple');
  const supportedAll = simple.filter(r => r.status === 'supported').sort((a, b) => b.rank - a.rank);
  const chip = (r) => ({ key: r.actionKey, label: r.label, icon: r.icon, why: whyOf(r) });
  const supported = supportedAll.slice(0, 4).map(chip);
  const postpone = simple.filter(r => r.status === 'restricted').slice(0, 4).map(chip);
  const major = all.filter(r => r.category === 'major' || r.category === 'pending').map(r => ({
    key: r.actionKey, label: r.label, icon: r.icon, status: r.status,
    preliminary: !!r.preliminary, needsFullMuhurta: !!r.needsFullMuhurta, needsVastu: !!r.needsVastu,
    note: r.note || null, why: whyOf(r),
  }));
  return { supported, postpone, major, strictSupportedCount: supportedAll.length };
}

/**
 * Полная детализация одного дня: панчанга целиком (то, что раньше показывала
 * отдельная вкладка «Панчанга») + даши на эту дату + движок мухурты
 * (что поддержано / что лучше отложить) + астрологические события дня.
 */
function computeDayDetail(chart, birthDateUTC, year, month, day, lat, lon, utcOffset) {
  const dateAtNoonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0) - utcOffset * 3600000);

  const panchanga = computePanchanga(year, month, day, 12, 0, lat, lon, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase);

  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  // Тара дня — по накшатре на восход (как в календаре); все отрезки дня — в daySegments
  const dayNak = computeDayNakshatraSegments(year, month, day, lat, lon, utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, natalMoonSignOf(chart));
  const taraBala = dayNak.segments[0].tara;

  const mahadashas = computeVimshottariDasha(chart, birthDateUTC);
  const chain = findCurrentDashaChain(mahadashas, dateAtNoonUTC);

  function isSameUTCDate(d1, d2) {
    return d1.getUTCFullYear() === d2.getUTCFullYear() && d1.getUTCMonth() === d2.getUTCMonth() && d1.getUTCDate() === d2.getUTCDate();
  }
  let dashaChangeToday = null;
  if (chain) {
    if (chain.pratyantardasha && isSameUTCDate(new Date(chain.pratyantardasha.start), dateAtNoonUTC)) {
      dashaChangeToday = { level: 'пратьянтардаша', lord: chain.pratyantardasha.lord };
    } else if (chain.antardasha && isSameUTCDate(new Date(chain.antardasha.start), dateAtNoonUTC)) {
      dashaChangeToday = { level: 'антардаша', lord: chain.antardasha.lord };
    } else if (isSameUTCDate(new Date(chain.mahadasha.start), dateAtNoonUTC)) {
      dashaChangeToday = { level: 'махадаша', lord: chain.mahadasha.lord };
    }
  }

  const transits = computeCurrentTransits(chart, dateAtNoonUTC);
  const moonTransitHouse = transits.planets['Луна'].transitHouse;

  const events = getEventsForDate(year, month, day, panchanga.tithi.number);

  // Оценка дел по каждому отрезку дня: накшатра/тара/титхи/йога/карана/Луна — на середину отрезка.
  // Отрезки дополнительно режутся в моменты смены Караны/титхи/йоги; соседние части с одинаковым
  // результатом склеиваются обратно, чтобы список был коротким.
  const evalParts = subdivideSegments(dayNak.segments, utcOffset).map((sg) => {
    const ctx = buildSegmentCtx(chart, sg, year, month, day, lat, lon, utcOffset, events);
    const r = evaluateMuhurtaLists(ctx);
    return { from: sg.from, to: sg.to, fromDate: sg.fromDate, toDate: sg.toDate, tone: sg.tone, supported: r.supported, postpone: r.postpone, major: r.major, strictSupportedCount: r.strictSupportedCount };
  });
  const sigOf = (m) => JSON.stringify([m.tone, m.supported.map(x => x.key), m.postpone.map(x => x.key), m.major.map(x => x.key + ':' + x.status)]);
  const muhurtaBySegment = [];
  evalParts.forEach((m) => {
    const last = muhurtaBySegment[muhurtaBySegment.length - 1];
    if (last && sigOf(last) === sigOf(m)) { last.to = m.to; last.toDate = m.toDate; }
    else muhurtaBySegment.push(m);
  });
  const first = muhurtaBySegment[0];
  const supported = first.supported, postpone = first.postpone, strictSupportedCount = first.strictSupportedCount;

  // Период (даша + гочара) под крупные цели — один раз на день, медленные факторы
  const majorPeriod = {};
  for (const [key, rule] of Object.entries(ACTION_RULES)) {
    if (rule.category !== 'major') continue;
    const per = evaluateGoalPeriod(chart, birthDateUTC, key, dateAtNoonUTC);
    if (per) majorPeriod[key] = per;
  }

  const hasEclipse = events.some(ev => ev.type === 'Затмение (лунное)' || ev.type === 'Затмение (солнечное)');
  const dayTier = computeDayTier({
    dateISO: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    hasEclipse,
    tithiName: panchanga.tithi.name,
    dashaChangeToday,
    supportedCount: strictSupportedCount,
    postponeCount: postpone.length,
  });
  const moonHouseMeaning = houseMeaningPhrase(moonTransitHouse);

  return {
    date: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
    panchanga,
    taraBala,
    daySegments: dayNak.segments.map(segOut),
    muhurtaBySegment,
    majorPeriod,
    dayTone: dayNak.segments[0].tone,
    sunrise: dayNak.sunrise,
    nextSunrise: dayNak.nextSunrise,
    chain,
    dashaChangeToday,
    moonTransitHouse,
    moonHouseMeaning,
    supported,
    postpone,
    events: windowEventsForDate(year, month, day, lat, lon, utcOffset),
    daySummary: dayTier.headline,
    dayEnergy: { emoji: dayTier.emoji, label: dayTier.energyLabel },
    energyDescriptor: dayTier.energyDescriptor,
  };
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
  // Раньше при toDateUTC < fromDateUTC totalDays получался <= 0, цикл просто
  // не выполнялся ни разу, и вызывающая сторона получала пустой результат —
  // неотличимый от "в этом диапазоне подходящих дней не нашлось". Явная
  // ошибка честнее и не скрывает перепутанные местами даты.
  if (!(toDateUTC instanceof Date) || !(fromDateUTC instanceof Date) || isNaN(toDateUTC) || isNaN(fromDateUTC) || toDateUTC < fromDateUTC) {
    throw new Error('Некорректный диапазон дат: конечная дата раньше начальной');
  }
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

module.exports = {
  tithiWindow, windowEventsForDate, GOALS, computeCalendarMonth, computeDateSearch, computeDayDetail, computeActionDateSearch, evaluateMuhurtaLists, buildSegmentCtx, personalFromSegment };

/**
 * «Поиск по цели»: тот же расчёт, что в «Сегодня» и «Днях» (отрезки дня от
 * восхода до восхода, тот же движок мухурты), но для ОДНОГО выбранного дела
 * по диапазону дат. Для крупных целей к мухурте добавляется оценка периода
 * (даша + гочара). Оценки хранятся раздельно, в один балл не сливаются.
 */
function computeActionDateSearch(chart, birthDateUTC, lat, lon, utcOffset, actionKey, fromDateUTC, toDateUTC, travelDirection) {
  const rule = ACTION_RULES[actionKey];
  if (!rule) throw new Error('Неизвестное действие: ' + actionKey);
  if (!(toDateUTC instanceof Date) || !(fromDateUTC instanceof Date) || isNaN(toDateUTC) || isNaN(fromDateUTC) || toDateUTC < fromDateUTC) {
    throw new Error('Некорректный диапазон дат: конечная дата раньше начальной');
  }
  if (rule.category === 'pending') {
    return { actionLabel: rule.label, category: 'pending', rulesPending: true, note: rule.note, days: [], best: [] };
  }

  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const moonSign = natalMoonSignOf(chart);
  const maxDays = 200;
  const dayMs = 24 * 3600 * 1000;
  const totalDays = Math.min(maxDays, Math.round((toDateUTC - fromDateUTC) / dayMs) + 1);
  const isMajor = rule.category === 'major';

  const LV = { supports: 2, partial: 1, neutral: 0, not: 0, load: -1, nodata: 0 };
  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const dateUTC = new Date(fromDateUTC.getTime() + i * dayMs);
    const y = dateUTC.getUTCFullYear(), m = dateUTC.getUTCMonth() + 1, d = dateUTC.getUTCDate();
    const dayNak = computeDayNakshatraSegments(y, m, d, lat, lon, utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, moonSign);
    const pNoon = computePanchanga(y, m, d, 12, 0, lat, lon, utcOffset, chart.ayanamshaType, chart.customAyanamshaBase);
    const events = getEventsForDate(y, m, d, pNoon.tithi.number);

    const segs = subdivideSegments(dayNak.segments, utcOffset).map(sg => {
      const ctx = buildSegmentCtx(chart, sg, y, m, d, lat, lon, utcOffset, events, { travelDirection });
      const r = evaluateAction(actionKey, ctx);
      return { sg, r };
    });
    // Склеиваем соседние отрезки с одинаковым статусом
    const merged = [];
    segs.forEach(({ sg, r }) => {
      const last = merged[merged.length - 1];
      if (last && last.status === r.status) { last.to = sg.to; last.toDate = sg.toDate; }
      else merged.push({ from: sg.from, to: sg.to, fromDate: sg.fromDate, toDate: sg.toDate, status: r.status });
    });
    const best = segs.slice().sort((a, b) => {
      const order = { supported: 3, insufficient: 2, restricted: 1 };
      return (order[b.r.status] || 0) - (order[a.r.status] || 0) || b.r.rank - a.r.rank;
    })[0].r;
    const anySupported = segs.some(x => x.r.status === 'supported');
    const allRestricted = segs.every(x => x.r.status === 'restricted');
    const quality = anySupported ? 'good' : allRestricted ? 'bad' : 'neutral';

    const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) - utcOffset * 3600000);
    let period = null;
    if (isMajor) {
      const per = evaluateGoalPeriod(chart, birthDateUTC, actionKey, noon);
      if (per) period = { summary: per.summary, dasha: per.dasha.label, gochara: per.gochara.label, dashaLines: per.dasha.lines, gocharaLines: per.gochara.lines, score: (LV[per.dasha.status] || 0) + (LV[per.gochara.status] || 0) };
    }
    days.push({
      date: dateUTC.toISOString().slice(0, 10),
      quality,
      segments: merged,
      rank: best.rank,
      restrictions: best.strict,
      favorable: [...best.mainPlus, ...best.addPlus],
      cautions: [...best.mainMinus, ...best.addMinus],
      context: best.context,
      period,
      score: best.rank + (period ? period.score : 0),
    });
  }

  const bestDays = days.filter(x => x.quality === 'good').sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, 5)
    .map(x => ({ date: x.date, segments: x.segments.filter(sg => sg.status === 'supported'), period: x.period ? x.period.summary : null }));

  return {
    actionLabel: rule.label,
    category: rule.category,
    preliminary: !!rule.needsFullMuhurta,
    needsVastu: !!rule.needsVastu,
    periodNow: days[0] && days[0].period ? days[0].period : null,
    best: bestDays,
    days,
  };
}
