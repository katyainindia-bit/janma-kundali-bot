/**
 * Личные уведомления на новой логике: настройки пользователя, место «Где я сейчас»,
 * утреннее сообщение из «Энергии дня» (те же отрезки и оценки, что в приложении).
 */
const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computeDayNakshatraSegments, moonSignSpan } = require('./panchanga.js');
const { windowEventsForDate, computeActionDateSearch } = require('./date-tools.js');
const { buildDayEnergy, houseFromLagna, HOUSE_SHORT, reasonText, adviceFor, groupKey, cap } = require('./day-energy.js');
const { ACTION_RULES } = require('./muhurta-rules.js');
const { pickAffirmation } = require('./affirmations.js');

const SIGN_NAMES = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
const SLOW_PLANETS = ['Сатурн', 'Юпитер', 'Раху', 'Кету'];

const MAX_WATCH = 5;
const DEFAULT_PREFS = {
  morning: { enabled: true, time: '08:00', blocks: { events: true, period: true, transit: true, eclipse: true, affirmation: true } },
  // вечернее сообщение (по умолчанию выключено): завтрашний день + что скоро случится (horizon дней вперёд)
  evening: { enabled: false, time: '20:00', horizon: 3, blocks: { energy: true, events: true, period: true, transit: true, eclipse: true } },
  // «Моя неделя»: по умолчанию воскресенье вечером; weekday — 0..6 (0 — воскресенье)
  weekly: { enabled: true, weekday: 0, time: '19:00', blocks: { days: true, watch: true, events: true, period: true, transit: true, eclipse: true } },
  watch: [], // ключи дел, за которыми следим (до MAX_WATCH)
  // смена оценки внутри дня; lead — за сколько минут предупреждать (0 — в момент смены)
  intraday: { enabled: true, toBad: true, toGood: true, lead: 0, maxPerDay: 3 },
  // тихие часы: в это время смены внутри дня не отправляются (местное время)
  quiet: { enabled: true, from: '22:00', to: '06:00' },
  // предупреждение накануне о подходящем дне для дел из списка «Мои дела»
  watchAlert: { enabled: true, time: '18:00' },
};

function normalizeTime(t, fallback) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : fallback;
}

function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const m = r.morning && typeof r.morning === 'object' ? r.morning : {};
  const b = m.blocks && typeof m.blocks === 'object' ? m.blocks : {};
  const flag = (v, d) => (typeof v === 'boolean' ? v : d);
  const w = r.weekly && typeof r.weekly === 'object' ? r.weekly : {};
  const wb = w.blocks && typeof w.blocks === 'object' ? w.blocks : {};
  const wd = Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6 ? w.weekday : DEFAULT_PREFS.weekly.weekday;
  const watch = Array.isArray(r.watch) ? [...new Set(r.watch.filter((k) => typeof k === 'string' && ACTION_RULES[k] && ACTION_RULES[k].category !== 'pending'))].slice(0, MAX_WATCH) : [];
  const it = r.intraday && typeof r.intraday === 'object' ? r.intraday : {};
  const q = r.quiet && typeof r.quiet === 'object' ? r.quiet : {};
  const lead = [0, 15, 30].includes(it.lead) ? it.lead : 0;
  const maxPerDay = Number.isInteger(it.maxPerDay) && it.maxPerDay >= 1 && it.maxPerDay <= 10 ? it.maxPerDay : DEFAULT_PREFS.intraday.maxPerDay;
  const ev = r.evening && typeof r.evening === 'object' ? r.evening : {};
  const eb = ev.blocks && typeof ev.blocks === 'object' ? ev.blocks : {};
  const horizon = [1, 2, 3, 5, 7].includes(ev.horizon) ? ev.horizon : DEFAULT_PREFS.evening.horizon;
  const wa = r.watchAlert && typeof r.watchAlert === 'object' ? r.watchAlert : {};
  return {
    watchAlert: { enabled: flag(wa.enabled, true), time: normalizeTime(wa.time, '18:00') },
    evening: {
      enabled: flag(ev.enabled, false), time: normalizeTime(ev.time, '20:00'), horizon,
      blocks: { energy: flag(eb.energy, true), events: flag(eb.events, true), period: flag(eb.period, true), transit: flag(eb.transit, true), eclipse: flag(eb.eclipse, true) },
    },
    intraday: { enabled: flag(it.enabled, true), toBad: flag(it.toBad, true), toGood: flag(it.toGood, true), lead, maxPerDay },
    quiet: { enabled: flag(q.enabled, true), from: normalizeTime(q.from, '22:00'), to: normalizeTime(q.to, '06:00') },
    weekly: {
      enabled: flag(w.enabled, DEFAULT_PREFS.weekly.enabled),
      weekday: wd,
      time: normalizeTime(w.time, DEFAULT_PREFS.weekly.time),
      blocks: {
        days: flag(wb.days, true), watch: flag(wb.watch, true), events: flag(wb.events, true),
        period: flag(wb.period, true), transit: flag(wb.transit, true), eclipse: flag(wb.eclipse, true),
      },
    },
    watch,
    morning: {
      enabled: flag(m.enabled, DEFAULT_PREFS.morning.enabled),
      time: normalizeTime(m.time, DEFAULT_PREFS.morning.time),
      blocks: {
        events: flag(b.events, true), period: flag(b.period, true),
        transit: flag(b.transit, true), eclipse: flag(b.eclipse, true), affirmation: flag(b.affirmation, true),
      },
    },
  };
}

function chartFromRow(chartRow, userSettings) {
  const params = {
    day: chartRow.day, month: chartRow.month, year: chartRow.year, hour: chartRow.hour, minute: chartRow.minute,
    lat: chartRow.lat, lon: chartRow.lon, utcOffset: chartRow.utc_offset, second: 0,
  };
  const ayanamshaType = (userSettings && userSettings.zodiac_type !== 'tropical') ? ((userSettings && userSettings.ayanamsha_variant) || 'lahiri') : 'lahiri';
  const nodeType = (userSettings && userSettings.node_type === 'true') ? 'true' : 'mean';
  const customAyanamshaBase = userSettings ? userSettings.custom_ayanamsha_base : null;
  const chart = calculateChart({ ...params, ayanamshaType, nodeType, customAyanamshaBase });
  // как у карты из приложения: транзиты и отрезки дня считаются теми же настройками
  chart.ayanamshaType = ayanamshaType;
  chart.nodeType = nodeType;
  chart.customAyanamshaBase = customAyanamshaBase;
  const birthDateUTC = new Date(Date.UTC(chartRow.year, chartRow.month - 1, chartRow.day, chartRow.hour, chartRow.minute, 0) - chartRow.utc_offset * 3600000);
  return { chart, birthDateUTC };
}

function effectivePlace(chartRow, place) {
  if (place && typeof place.lat === 'number' && typeof place.lon === 'number' && typeof place.utcOffset === 'number') return place;
  return { lat: chartRow.lat, lon: chartRow.lon, utcOffset: chartRow.utc_offset, name: chartRow.place_label || '' };
}

function localDateParts(now, utcOffset) {
  const l = new Date(now.getTime() + utcOffset * 3600000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), hh: l.getUTCHours(), mm: l.getUTCMinutes() };
}

function ddmm(date, utcOffset) {
  const l = new Date(date.getTime() + utcOffset * 3600000);
  return `${String(l.getUTCDate()).padStart(2, '0')}.${String(l.getUTCMonth() + 1).padStart(2, '0')}.${l.getUTCFullYear()}`;
}

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function dayLabel(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}

/**
 * «Моя неделя»: сводка на ближайшие 7 дней (начиная с завтрашнего местного дня).
 * Разделы без содержимого не выводятся.
 */
function buildWeeklyMessage(chartRow, userSettings, place, prefs, now = new Date()) {
  const pl = effectivePlace(chartRow, place);
  const { chart, birthDateUTC } = chartFromRow(chartRow, userSettings);
  const base = localDateParts(now, pl.utcOffset);
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    days.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  }
  const first = days[0], last = days[6];
  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const natalMoonSignIdx = Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;
  const wb = prefs.weekly.blocks;
  const sections = [];

  const dayWords = [];
  if (wb.days) {
    const lines = days.map((dd) => {
      const dn = computeDayNakshatraSegments(dd.y, dd.m, dd.d, pl.lat, pl.lon, pl.utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, natalMoonSignIdx);
      const segs = dn.segments;
      const share = { good: 0, moderate: 0, bad: 0 };
      segs.forEach((s) => { if (s.tone) share[s.tone] += s.share; });
      let word = 'разный';
      if (share.good >= 0.6) word = 'благоприятный';
      else if (share.bad >= 0.6) word = 'неблагоприятный';
      const houseAt0 = houseFromLagna(segs[0].moonSign, chart.ascendant.sign.index);
      dayWords.push({ label: dayLabel(dd.y, dd.m, dd.d), word });
      return `${dayLabel(dd.y, dd.m, dd.d)} — ${word}, Луна в ${houseAt0}-м доме (${HOUSE_SHORT[houseAt0]})`;
    });
    const goodDays = dayWords.filter((x) => x.word === 'благоприятный').map((x) => x.label);
    const badDays = dayWords.filter((x) => x.word === 'неблагоприятный').map((x) => x.label);
    let overview;
    if (goodDays.length && badDays.length) overview = `Больше всего поддержки: ${goodDays.join(', ')}. Осторожнее будь: ${badDays.join(', ')}.`;
    else if (goodDays.length) overview = `Неделя мягкая, опорные дни: ${goodDays.join(', ')}.`;
    else if (badDays.length) overview = `Неделя требует бережности, особенно ${badDays.join(', ')}.`;
    else overview = 'Неделя ровная, без резких дней.';
    sections.push(overview + '\n\n' + lines.map((l) => `• ${l}`).join('\n'));
  }

  if (wb.watch && prefs.watch.length) {
    const lines = [];
    const from = new Date(Date.UTC(first.y, first.m - 1, first.d));
    const to = new Date(Date.UTC(last.y, last.m - 1, last.d));
    for (const key of prefs.watch) {
      const rule = ACTION_RULES[key];
      if (!rule) continue;
      try {
        const res = computeActionDateSearch(chart, birthDateUTC, pl.lat, pl.lon, pl.utcOffset, key, from, to, undefined, null);
        // подходящим считаем день, когда поддержка есть днём (с 6:00 до 22:00), а не только ночью
        const t = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
        const daytime = (x) => {
          const iso = x.date.split('-').reverse().join('.');
          return x.segments.some((sg) => {
            if (sg.status !== 'supported') return false;
            const a = (sg.fromDate === iso ? 0 : 1440) + t(sg.from);
            const b = a + (sg.toDate !== sg.fromDate ? 1440 : 0) + t(sg.to) - t(sg.from);
            return Math.min(b, 1320) - Math.max(a, 360) >= 30;
          });
        };
        const good = res.days.filter((x) => x.quality === 'good' && daytime(x));
        if (!good.length) { lines.push(`${rule.label}: на этой неделе подходящих дней нет`); continue; }
        const parts = good.slice(0, 5).map((x) => {
          const dt = new Date(x.date + 'T00:00:00Z');
          return dayLabel(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        });
        lines.push(`${rule.label}: ${parts.join(', ')}`);
      } catch (err) { /* дело пропускаем, остальное отправляем */ }
    }
    if (lines.length) sections.push('Твои дела:\n' + lines.map((l) => `• ${l}`).join('\n'));
  }

  const events = [];
  const eclipses = [];
  if (wb.events || wb.eclipse) {
    for (const dd of days) {
      const evs = windowEventsForDate(dd.y, dd.m, dd.d, pl.lat, pl.lon, pl.utcOffset) || [];
      for (const ev of evs) {
        const txt = `${dayLabel(dd.y, dd.m, dd.d)}: ${ev.label}${ev.timing ? ' — ' + ev.timing : ''}`;
        if (typeof ev.type === 'string' && ev.type.startsWith('Затмение')) { if (!ev.penumbral) eclipses.push(txt); }
        else events.push(txt);
      }
    }
  }
  if (wb.events && events.length) sections.push('Праздники и особые дни:\n' + events.map((l) => `• ${l}`).join('\n'));
  if (wb.eclipse && eclipses.length) sections.push('Затмения:\n' + eclipses.map((l) => `• ${l}`).join('\n'));

  if (wb.period) {
    const mahas = computeVimshottariDasha(chart, birthDateUTC);
    const lines = [];
    let prev = findCurrentDashaChain(mahas, new Date(Date.UTC(first.y, first.m - 1, first.d - 1, 12) - pl.utcOffset * 3600000));
    for (const dd of days) {
      const ch = findCurrentDashaChain(mahas, new Date(Date.UTC(dd.y, dd.m - 1, dd.d, 12) - pl.utcOffset * 3600000));
      if (ch && prev) {
        const lab = dayLabel(dd.y, dd.m, dd.d);
        if (ch.mahadasha.lord !== prev.mahadasha.lord) lines.push(`${lab}: начинается новый большой период жизни — ${ch.mahadasha.lord}`);
        else if (ch.antardasha && prev.antardasha && ch.antardasha.lord !== prev.antardasha.lord) lines.push(`${lab}: начинается новый период — ${ch.antardasha.lord}`);
        else if (ch.pratyantardasha && prev.pratyantardasha && ch.pratyantardasha.lord !== prev.pratyantardasha.lord) lines.push(`${lab}: начинается короткий период — ${ch.pratyantardasha.lord}`);
      }
      prev = ch;
    }
    if (lines.length) sections.push('Что меняется в твоих периодах:\n' + lines.map((l) => `• ${l}`).join('\n'));
  }

  if (wb.transit) {
    const lines = [];
    let prevT = computeCurrentTransits(chart, new Date(Date.UTC(first.y, first.m - 1, first.d) - pl.utcOffset * 3600000));
    for (const dd of days) {
      const endOfDay = new Date(Date.UTC(dd.y, dd.m - 1, dd.d + 1) - pl.utcOffset * 3600000);
      const t = computeCurrentTransits(chart, endOfDay);
      for (const name of SLOW_PLANETS) {
        if (prevT.planets[name] && t.planets[name] && prevT.planets[name].sign.index !== t.planets[name].sign.index) {
          lines.push(`${dayLabel(dd.y, dd.m, dd.d)}: ${name} переходит в знак ${SIGN_NAMES[t.planets[name].sign.index]} — в твой ${t.planets[name].transitHouse}-й дом (${HOUSE_SHORT[t.planets[name].transitHouse]})`);
        }
      }
      prevT = t;
    }
    if (lines.length) sections.push('Движение планет:\n' + lines.map((l) => `• ${l}`).join('\n'));
  }

  const head = `Посмотрим, что ждёт тебя на неделе с ${dayLabel(first.y, first.m, first.d)} по ${dayLabel(last.y, last.m, last.d)}.`;
  if (!sections.length) return null;
  return { text: head + '\n\n' + sections.join('\n\n') + '\n\nПодробности по каждому дню — в приложении.' };
}

/** Строит утреннее сообщение на локальную дату пользователя. Возвращает { text } или null. */
function buildMorningMessage(chartRow, userSettings, place, prefs, now = new Date()) {
  const pl = effectivePlace(chartRow, place);
  const { chart, birthDateUTC } = chartFromRow(chartRow, userSettings);
  const { y, m, d } = localDateParts(now, pl.utcOffset);
  const nakSpan = 360 / 27;
  const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
  const natalMoonSignIdx = Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;
  const dayNak = computeDayNakshatraSegments(y, m, d, pl.lat, pl.lon, pl.utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, natalMoonSignIdx);
  const span = moonSignSpan(dayNak.startJD + 1e-4, pl.utcOffset, chart.ayanamshaType, chart.customAyanamshaBase);
  const energy = buildDayEnergy(dayNak.segments, chart.ascendant.sign.index, span);
  if (!energy) return null;

  const also = [];
  const events = windowEventsForDate(y, m, d, pl.lat, pl.lon, pl.utcOffset) || [];
  const isEclipse = (ev) => typeof ev.type === 'string' && ev.type.startsWith('Затмение');
  if (prefs.morning.blocks.events) {
    for (const ev of events.filter((e) => !isEclipse(e))) {
      also.push(`${ev.label}${ev.timing ? ' — ' + ev.timing : ''}`);
    }
  }
  if (prefs.morning.blocks.eclipse) {
    for (const ev of events.filter(isEclipse)) {
      if (ev.penumbral) continue;
      also.push(`${ev.label}${ev.timing ? ' — ' + ev.timing : ''}`);
    }
  }

  if (prefs.morning.blocks.period) {
    const chain = findCurrentDashaChain(computeVimshottariDasha(chart, birthDateUTC), now);
    if (chain) {
      const sameDay = (dt) => {
        const p = localDateParts(new Date(dt), pl.utcOffset);
        return p.y === y && p.m === m && p.d === d;
      };
      if (chain.mahadasha && sameDay(chain.mahadasha.start)) also.push(`Начинается махадаша ${chain.mahadasha.lord}`);
      else if (chain.antardasha && sameDay(chain.antardasha.start)) also.push(`Начинается антардаша ${chain.antardasha.lord} (в махадаше ${chain.mahadasha.lord}), до ${ddmm(chain.antardasha.end, pl.utcOffset)}`);
      else if (chain.pratyantardasha && sameDay(chain.pratyantardasha.start)) also.push(`Начинается пратьянтардаша ${chain.pratyantardasha.lord}, до ${ddmm(chain.pratyantardasha.end, pl.utcOffset)}`);
    }
  }

  if (prefs.morning.blocks.transit) {
    const start = new Date(Date.UTC(y, m - 1, d) - pl.utcOffset * 3600000);
    const end = new Date(start.getTime() + 24 * 3600000);
    const t0 = computeCurrentTransits(chart, start);
    const t1 = computeCurrentTransits(chart, end);
    for (const name of SLOW_PLANETS) {
      if (!t0.planets[name] || !t1.planets[name]) continue;
      if (t0.planets[name].sign.index !== t1.planets[name].sign.index) {
        const signName = SIGN_NAMES[t1.planets[name].sign.index];
        also.push(`${name} переходит в знак ${signName}, это твой ${t1.planets[name].transitHouse}-й дом`);
      }
    }
  }

  let text = `${energy.title}\n\n${energy.text}`;
  if (also.length) text += `\n\nСегодня ещё:\n` + also.map((s) => `• ${s}`).join('\n');
  if (prefs.watchAlert && prefs.watchAlert.enabled && prefs.watch.length) {
    const wl = watchLinesFor(chart, birthDateUTC, pl, prefs, new Date(Date.UTC(y, m - 1, d)));
    if (wl.length) text += `\n\nСегодня хороший день для дел из твоего списка:\n${wl.join('\n')}`;
  }
  if (prefs.morning.blocks.affirmation) {
    const share = { good: 0, moderate: 0, bad: 0 };
    dayNak.segments.forEach((s) => { if (s.tone) share[s.tone] += s.share; });
    const tone = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
    const house = houseFromLagna(dayNak.segments[0].moonSign, chart.ascendant.sign.index);
    const aff = pickAffirmation(house, tone, Math.floor(Date.UTC(y, m - 1, d) / 86400000));
    if (aff) text += `\n\nАффирмация дня: «${aff}»`;
  }
  return { text };
}

/**
 * Вечернее сообщение: «Завтра» (Энергия дня на следующие сутки) и «Скоро» — события в ближайшие
 * horizon дней, о которых ещё не писали. Возвращает { text, keys } — keys надо пометить отправленными.
 */
function buildEveningMessage(chartRow, userSettings, place, prefs, now, isAnnounced) {
  const pl = effectivePlace(chartRow, place);
  const { chart, birthDateUTC } = chartFromRow(chartRow, userSettings);
  const base = localDateParts(now, pl.utcOffset);
  const mk = (i) => { const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + i)); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), i }; };
  const days = [];
  for (let i = 1; i <= prefs.evening.horizon; i++) days.push(mk(i));
  const tomorrow = days[0];
  const eb = prefs.evening.blocks;
  const parts = [];

  if (eb.energy) {
    const nakSpan = 360 / 27;
    const nMoonNak = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
    const nMoonSign = Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;
    const dn = computeDayNakshatraSegments(tomorrow.y, tomorrow.m, tomorrow.d, pl.lat, pl.lon, pl.utcOffset, nMoonNak, chart.ayanamshaType, chart.customAyanamshaBase, nMoonSign);
    const span = moonSignSpan(dn.startJD + 1e-4, pl.utcOffset, chart.ayanamshaType, chart.customAyanamshaBase);
    const en = buildDayEnergy(dn.segments, chart.ascendant.sign.index, span);
    if (en) parts.push(`Завтра, ${dayLabel(tomorrow.y, tomorrow.m, tomorrow.d)}. ${en.title}\n\n${en.text}`);
  }

  const items = []; // { key, i, text }
  const when = (i, dd) => (i === 1 ? 'Завтра' : i === 2 ? 'Послезавтра' : `Через ${i} дн. (${dayLabel(dd.y, dd.m, dd.d)})`);
  for (const dd of days) {
    const evs = windowEventsForDate(dd.y, dd.m, dd.d, pl.lat, pl.lon, pl.utcOffset) || [];
    for (const ev of evs) {
      const isE = typeof ev.type === 'string' && ev.type.startsWith('Затмение');
      if (isE && (ev.penumbral || !eb.eclipse)) continue;
      if (!isE && !eb.events) continue;
      items.push({ key: `ev|${dd.y}-${dd.m}-${dd.d}|${ev.label}`, i: dd.i, text: `${when(dd.i, dd)}: ${ev.label}${ev.timing ? ' — ' + ev.timing : ''}` });
    }
  }
  if (eb.period) {
    const mahas = computeVimshottariDasha(chart, birthDateUTC);
    let prev = findCurrentDashaChain(mahas, new Date(Date.UTC(tomorrow.y, tomorrow.m - 1, tomorrow.d - 1, 12) - pl.utcOffset * 3600000));
    for (const dd of days) {
      const ch = findCurrentDashaChain(mahas, new Date(Date.UTC(dd.y, dd.m - 1, dd.d, 12) - pl.utcOffset * 3600000));
      if (ch && prev) {
        let t = null;
        if (ch.mahadasha.lord !== prev.mahadasha.lord) t = `начинается новый большой период жизни — ${ch.mahadasha.lord}`;
        else if (ch.antardasha && prev.antardasha && ch.antardasha.lord !== prev.antardasha.lord) t = `начинается новый период — ${ch.antardasha.lord}`;
        else if (ch.pratyantardasha && prev.pratyantardasha && ch.pratyantardasha.lord !== prev.pratyantardasha.lord) t = `начинается короткий период — ${ch.pratyantardasha.lord}`;
        if (t) items.push({ key: `per|${dd.y}-${dd.m}-${dd.d}|${t}`, i: dd.i, text: `${when(dd.i, dd)}: ${t}` });
      }
      prev = ch;
    }
  }
  if (eb.transit) {
    let prevT = computeCurrentTransits(chart, new Date(Date.UTC(tomorrow.y, tomorrow.m - 1, tomorrow.d) - pl.utcOffset * 3600000));
    for (const dd of days) {
      const t = computeCurrentTransits(chart, new Date(Date.UTC(dd.y, dd.m - 1, dd.d + 1) - pl.utcOffset * 3600000));
      for (const name of SLOW_PLANETS) {
        if (prevT.planets[name] && t.planets[name] && prevT.planets[name].sign.index !== t.planets[name].sign.index) {
          const si = t.planets[name].sign.index, h = t.planets[name].transitHouse;
          items.push({ key: `tr|${dd.y}-${dd.m}-${dd.d}|${name}|${si}`, i: dd.i, text: `${when(dd.i, dd)}: ${name} переходит в знак ${SIGN_NAMES[si]} — в твой ${h}-й дом (${HOUSE_SHORT[h]})` });
        }
      }
      prevT = t;
    }
  }
  // о том, что уже объявляли, повторно не пишем (кроме «завтра» — оно нужно как напоминание в канун)
  const fresh = items.filter((it) => it.i === 1 || !isAnnounced || !isAnnounced(it.key));
  if (fresh.length) parts.push('Скоро:\n' + fresh.sort((a, b) => a.i - b.i).map((it) => `• ${it.text}`).join('\n'));
  if (!parts.length) return null;
  return { text: parts.join('\n\n'), keys: fresh.map((it) => it.key) };
}

/** Окна поддержки дела в течение суток, обрезанные до дня (06:00–22:00). Возвращает ['08:15–17:12', ...] */
function daytimeWindows(dayRes) {
  const t = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  const iso = dayRes.date.split('-').reverse().join('.');
  const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const out = [];
  for (const sg of dayRes.segments) {
    if (sg.status !== 'supported') continue;
    const a = (sg.fromDate === iso ? 0 : 1440) + t(sg.from);
    const b = a + (sg.toDate !== sg.fromDate ? 1440 : 0) + t(sg.to) - t(sg.from);
    const lo = Math.max(a, 360), hi = Math.min(b, 1320);
    if (hi - lo >= 30) out.push(`${fmt(lo)}–${fmt(hi)}`);
  }
  return out;
}

/** Строки «Дело — окна» для дел из списка на указанную локальную дату (UTC-дата tm). */
function watchLinesFor(chart, birthDateUTC, pl, prefs, tm) {
  const lines = [];
  for (const key of prefs.watch) {
    const rule = ACTION_RULES[key];
    if (!rule) continue;
    try {
      const res = computeActionDateSearch(chart, birthDateUTC, pl.lat, pl.lon, pl.utcOffset, key, tm, tm, undefined, null);
      const day = res.days[0];
      if (!day || day.quality !== 'good') continue;
      const wins = daytimeWindows(day).slice(0, 2);
      if (!wins.length) continue;
      lines.push(`• ${rule.label} — ${wins.join(', ')}`);
    } catch (err) { /* пропускаем дело */ }
  }
  return lines;
}

/** Предупреждение накануне: завтра подходящий день для дел из списка. Возвращает { text } или null. */
function buildWatchAlertMessage(chartRow, userSettings, place, prefs, now = new Date()) {
  if (!prefs.watch.length) return null;
  const pl = effectivePlace(chartRow, place);
  const { chart, birthDateUTC } = chartFromRow(chartRow, userSettings);
  const base = localDateParts(now, pl.utcOffset);
  const tm = new Date(Date.UTC(base.y, base.m - 1, base.d + 1));
  const lines = watchLinesFor(chart, birthDateUTC, pl, prefs, tm);
  if (!lines.length) return null;
  const lab = dayLabel(tm.getUTCFullYear(), tm.getUTCMonth() + 1, tm.getUTCDate());
  return { text: `Завтра, ${lab}, хороший день для дел из твоего списка:\n${lines.join('\n')}` };
}

/** Событие дня для бесплатного лунного календаря: по местной дате пользователя (или Москвы, если место неизвестно). */
function buildRitualMessage(place, now = new Date()) {
  const pl = place && typeof place.lat === 'number' && typeof place.lon === 'number' && typeof place.utcOffset === 'number'
    ? place : { lat: 55.75, lon: 37.6, utcOffset: 3 };
  const { y, m, d } = localDateParts(now, pl.utcOffset);
  const evs = (windowEventsForDate(y, m, d, pl.lat, pl.lon, pl.utcOffset) || []).filter((ev) => !ev.penumbral);
  if (!evs.length) return null;
  return { text: evs.map((ev) => `🔔 ${ev.label}${ev.timing ? ' — ' + ev.timing : ''}${ev.description ? '\n' + ev.description : ''}`).join('\n\n'), place: pl };
}

function inQuiet(quiet, hh, mm) {
  if (!quiet || !quiet.enabled) return false;
  const t = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const now = hh * 60 + mm, from = t(quiet.from), to = t(quiet.to);
  if (from === to) return false;
  return from < to ? (now >= from && now < to) : (now >= from || now < to);
}

// Кэш расчёта смен на ведический день: пересчитывать каждую минуту дорого
const transCache = new Map();

/**
 * Смены оценки внутри текущего ведического дня (от восхода до восхода).
 * Возвращает [{ atJD, tone, prevTone, text, until }]. Смена — это переход
 * к другой оценке (отрезки склеены по оценке и причине, как в «Энергии дня»).
 */
function intradayTransitions(userId, chartRow, userSettings, place, now) {
  const pl = effectivePlace(chartRow, place);
  const { y, m, d } = localDateParts(now, pl.utcOffset);
  const key = [userId, y, m, d, pl.lat, pl.lon, pl.utcOffset].join('|');
  let entry = transCache.get(key);
  if (!entry) {
    const { chart } = chartFromRow(chartRow, userSettings);
    const nakSpan = 360 / 27;
    const natalMoonNakIdx = Math.floor(chart.planets['Луна'].siderealLon / nakSpan);
    const natalMoonSignIdx = Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;
    const days = [];
    for (const off of [-1, 0]) {
      const dt = new Date(Date.UTC(y, m - 1, d + off));
      days.push(computeDayNakshatraSegments(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), pl.lat, pl.lon, pl.utcOffset, natalMoonNakIdx, chart.ayanamshaType, chart.customAyanamshaBase, natalMoonSignIdx));
    }
    const lagna = chart.ascendant.sign.index;
    const out = [];
    for (const dn of days) {
      const groups = [];
      for (const sg of dn.segments) {
        if (!sg.tone) continue;
        const k = groupKey(sg);
        const last = groups[groups.length - 1];
        if (last && last.key === k) { last.to = sg.to; last.toDate = sg.toDate; last.toJD = sg.toJD; }
        else groups.push({ key: k, tone: sg.tone, sg, from: sg.from, fromDate: sg.fromDate, to: sg.to, toDate: sg.toDate, fromJD: sg.fromJD, toJD: sg.toJD });
      }
      groups.forEach((g, i) => {
        if (i === 0 || g.tone === groups[i - 1].tone) return;
        const house = houseFromLagna(g.sg.moonSign, lagna);
        const until = i === groups.length - 1 ? 'до следующего восхода' : `до ${g.to}${g.toDate !== g.fromDate ? ' следующего дня' : ''}`;
        out.push({
          atJD: g.fromJD, tone: g.tone, prevTone: groups[i - 1].tone, from: g.from,
          body: `${cap(reasonText(g.sg))}. ${adviceFor(g.tone, house)}`, until,
        });
      });
    }
    entry = out;
    if (transCache.size > 2000) transCache.clear();
    transCache.set(key, entry);
  }
  return entry;
}

function intradayText(t, leadMin) {
  const verb = t.tone === 'good' ? 'становится благоприятным' : t.tone === 'bad' ? 'становится неблагоприятным' : 'становится нейтральным';
  const head = leadMin > 0 ? `Через ${leadMin} минут (в ${t.from}) день ${verb}.` : `С ${t.from} день ${verb}.`;
  return `${head}\n${t.body}\nДействует ${t.until}.`;
}

module.exports = { buildWatchAlertMessage, buildRitualMessage, buildEveningMessage, inQuiet, intradayTransitions, intradayText, MAX_WATCH, DEFAULT_PREFS, normalizePrefs, buildMorningMessage, buildWeeklyMessage, effectivePlace, localDateParts };
