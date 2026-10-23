// ============================================================
// muhurta.js — движок оценки мухурты.
//
// ВСЕ правила (списки накшатр, титхи, вар, исключения) лежат в
// muhurta-rules.js как данные. Здесь только логика:
//
//   1. Четыре уровня факторов: strict / main / additional / context.
//   2. Итог по делу — один из четырёх статусов:
//        'supported'     — есть основная поддержка, нет строгих ограничений
//        'restricted'    — есть строгое ограничение (лучше отложить)
//        'insufficient'  — «недостаточно оснований для рекомендации»
//        'rules_pending' — правила для дела ещё не утверждены
//   3. Никаких баллов с весами: статус выводится из уровней.
//   4. Личные показатели (Тара-бала + Чандра-бала) приходят одним готовым
//      тоном good/moderate/bad — тем же, каким окрашен календарь, чтобы
//      «Сегодня», «Дни» и «Поиск» не расходились. Плохой тон — минус
//      дополнительного уровня, а не запрет.
// ============================================================

const { SVABHAVA, GENERAL, ACTION_RULES, TITHI_PLUS_BASE } = require('./muhurta-rules.js');

// --- Панчака: пять групп титхи (используется для пояснений) ---
const TITHI_PANCHAKA = {};
[1, 6, 11, 16, 21, 26].forEach(n => (TITHI_PANCHAKA[n] = 'Нанда'));
[2, 7, 12, 17, 22, 27].forEach(n => (TITHI_PANCHAKA[n] = 'Бхадра'));
[3, 8, 13, 18, 23, 28].forEach(n => (TITHI_PANCHAKA[n] = 'Джая'));
[4, 9, 14, 19, 24, 29].forEach(n => (TITHI_PANCHAKA[n] = 'Рикта'));
[5, 10, 15, 20, 25, 30].forEach(n => (TITHI_PANCHAKA[n] = 'Пурна'));
const tithiPanchaka = (n) => TITHI_PANCHAKA[n] || null;

// Свабхава накшатры (Кшипра/Чара/Стхира/Мриду/Угра/Тикшна/Мишра)
const nakshatraSvabhava = (idx) => SVABHAVA[idx] || null;

const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function specialDayFromTithi(n) {
  if (n === 11 || n === 26) return 'Экадаши';
  if (n === 15) return 'Пурнима';
  if (n === 30) return 'Амавасья';
  return null;
}

// Дишашула: направление, которого избегают в этот день недели (0=вс … 6=сб)
const DISHASHULA_TABLE = ['Запад', 'Восток', 'Север', 'Север', 'Юг', 'Запад', 'Восток'];
const dishashulaDirection = (w) => DISHASHULA_TABLE[w];

const ACTIONS = ACTION_RULES;
const ACTION_ICONS = {};
Object.entries(ACTION_RULES).forEach(([k, a]) => { ACTION_ICONS[k] = a.icon; });
const NICHE_ACTION_KEYS = []; // оставлено для совместимости: приоритет теперь по rank

const inList = (list, v) => Array.isArray(list) && list.includes(v);
const ignores = (rule, what) => rule.ignoreGeneral === true || (Array.isArray(rule.ignoreGeneral) && rule.ignoreGeneral.includes(what));
const normTithi = (n) => ((n - 1) % 15) + 1; // 16–30 → 1–15

/**
 * Оценка одного дела на один момент/отрезок.
 * ctx: { tithiNumber, nakshatraIdx, nakshatraPada, weekdayIdx, yogaName, karanaName,
 *        personal:{tone,taraText,chandraText}, calendarEvents, travelDirection }
 */
function evaluateAction(actionKey, ctx) {
  const rule = ACTION_RULES[actionKey];
  if (!rule) throw new Error('Неизвестное действие: ' + actionKey);

  const base = { actionKey, label: rule.label, icon: rule.icon, category: rule.category };

  if (rule.category === 'pending') {
    return { ...base, status: 'rules_pending', rank: -1, strict: [], mainPlus: [], mainMinus: [], addPlus: [], addMinus: [], context: [], restrictions: [], favorable: [], note: rule.note };
  }

  const strict = [];
  const mainPlus = [], mainMinus = [], addPlus = [], addMinus = [], context = [];

  const gana = ctx.nakshatraIdx != null ? nakshatraSvabhava(ctx.nakshatraIdx) : null;
  const events = ctx.calendarEvents || [];
  const eventTypes = events.map(e => e.type);
  const wd = ctx.weekdayIdx;
  const tn = ctx.tithiNumber;

  // ---------- СТРОГИЕ ОГРАНИЧЕНИЯ ----------
  if (tn != null && !ignores(rule, 'tithi') && GENERAL.tithiStrict.includes(tn)) {
    strict.push(tn === 30 ? 'Амавасья — для начинаний не рекомендуется.' : 'Титхи Рикта — для начинаний традиционно не рекомендуется.');
  }
  if (ctx.karanaName && !ignores(rule, 'karana') && GENERAL.karanaStrict.includes(ctx.karanaName)) {
    strict.push(`Карана ${ctx.karanaName} (Бхадра) — не рекомендуется для начинаний.`);
  }
  if (ctx.yogaName && !ignores(rule, 'yoga') && GENERAL.yogaStrict.includes(ctx.yogaName)) {
    strict.push(`Нитья-йога ${ctx.yogaName} — неблагоприятная для начинаний.`);
  }
  if (GENERAL.eclipseStrict && !ignores(rule, 'eclipse') && events.some(e => (e.type === 'Затмение (лунное)' || e.type === 'Затмение (солнечное)') && !e.penumbral)) {
    strict.push('День затмения — для начинаний не рекомендуется.');
  }
  if (rule.gandantaPada && ctx.nakshatraIdx != null && ctx.nakshatraPada != null) {
    const hit = rule.gandantaPada.find(g => g.nak === ctx.nakshatraIdx && g.pada === ctx.nakshatraPada);
    if (hit) strict.push(`Пада ${ctx.nakshatraPada} этой накшатры стоит на стыке знаков (гандаанта) — для этого дела не подходит.`);
  }
  if (rule.astaCheck && Array.isArray(ctx.astaPlanets)) {
    for (const pl of rule.astaCheck) {
      if (ctx.astaPlanets.includes(pl)) strict.push(`${pl} в асте (близко к Солнцу) — для этого дела не рекомендуется.`);
    }
  }
  if (rule.dishashula && ctx.travelDirection && wd != null) {
    const bad = dishashulaDirection(wd);
    if (ctx.travelDirection === bad) strict.push(`Дишашула: направление «${bad}» в этот день недели не рекомендуется для начала поездки.`);
    else addPlus.push(`Направление поездки не совпадает с Дишашулой дня (избегается «${bad}»).`);
  }

  // ---------- ОСНОВНЫЕ ФАКТОРЫ ----------
  // Накшатра
  if (ctx.nakshatraIdx != null) {
    const explicit = inList(rule.nakshatraPlus, ctx.nakshatraIdx);
    const byGroup = gana && inList(rule.groupsPlus, gana);
    const hasList = (rule.nakshatraPlus && rule.nakshatraPlus.length) || (rule.groupsPlus && rule.groupsPlus.length);
    if (explicit || byGroup) {
      mainPlus.push(explicit
        ? 'Накшатра дня входит в список подходящих для этого дела.'
        : `Накшатра дня («${gana}») подходит для этого дела.`);
    } else if (gana && inList(rule.groupsMinus, gana)) {
      mainMinus.push(`Накшатра дня относится к группе «${gana}» — для этого дела не поддерживает.`);
    } else if (hasList) {
      context.push(`Накшатра дня («${gana || '—'}») не входит в список подходящих для этого дела.`);
    }
  }
  // Особые дни (по типу события)
  if (rule.specialDayPlus) {
    const hit = events.find(e => rule.specialDayPlus.includes(e.type));
    const fromTithi = !events.length && tn != null ? specialDayFromTithi(tn) : null;
    if (hit) mainPlus.push(`Сегодня ${hit.label || hit.type} — благоприятный день для этого дела.`);
    else if (fromTithi && rule.specialDayPlus.includes(fromTithi)) mainPlus.push(`Сегодня ${fromTithi} — благоприятный день для этого дела.`);
  }
  // Комбо: Гуру-Пушья
  if (rule.combo === 'guruPushya' && ctx.nakshatraIdx === 7) {
    if (wd === 4) mainPlus.push('Гуру-Пушья-йога (Пушья + четверг) — один из сильнейших дней для денежных дел.');
    else mainPlus.push('Накшатра Пушья — поддерживает денежные дела.');
  }

  // ---------- ДОПОЛНИТЕЛЬНЫЕ ----------
  if (wd != null) {
    if (inList(rule.varaPlus, wd)) addPlus.push(`День недели (${WEEKDAY_NAMES[wd]}) поддерживает это дело.`);
    else if (inList(rule.varaMinus, wd)) addMinus.push(`День недели (${WEEKDAY_NAMES[wd]}) для этого дела традиционно слабее.`);
  }
  if (tn != null && rule.tithiPlus && rule.tithiPlus.includes(normTithi(tn)) && !GENERAL.tithiStrict.includes(tn)) {
    addPlus.push(`Титхи ${normTithi(tn)}-я в пакше — из подходящих для этого дела.`);
  }
  // Личные показатели (Тара + Чандра-бала): тот же тон, что в календаре
  const pers = ctx.personal;
  if (pers) {
    const text = `Личные показатели: ${pers.taraText || ''}${pers.taraText && pers.chandraText ? '; ' : ''}${pers.chandraText || ''}`.trim();
    if (rule.personal === 'additional') {
      if (pers.tone === 'good') addPlus.push(text + ' — благоприятно.');
      else if (pers.tone === 'bad') addMinus.push(text + ' — неблагоприятно.');
      else context.push(text + ' — умеренно.');
    } else {
      context.push(text + '.');
    }
  }

  // ---------- КОНТЕКСТ ----------
  if (ctx.yogaName) context.push(`Нитья-йога: ${ctx.yogaName}.`);
  if (ctx.karanaName) context.push(`Карана: ${ctx.karanaName}.`);
  if (tn != null) context.push(`Титхи группы ${tithiPanchaka(tn)}.`);
  events.forEach(e => { if (e.type === 'Экадаши' || e.type === 'Пурнима' || e.type === 'Санкранти') context.push(`Сегодня ${e.label || e.type}.`); });

  // ---------- ИТОГ ----------
  let status;
  let strictOut = strict;
  const cautions = [];
  if (strict.length && rule.neverPostpone) {
    // Для медицины/практик строгие ограничения не выводятся как «отложить»
    strict.forEach(s => cautions.push(s));
    strictOut = [];
  }
  if (strictOut.length) {
    status = 'restricted';
  } else if (mainPlus.length > 0 && mainMinus.length === 0 && addPlus.length - addMinus.length >= 0) {
    status = 'supported';
  } else {
    status = 'insufficient';
  }
  const rank = mainPlus.length * 3 + addPlus.length - addMinus.length * 2 - mainMinus.length * 3;

  return {
    ...base,
    status,
    preliminary: !!rule.needsFullMuhurta,
    needsFullMuhurta: !!rule.needsFullMuhurta,
    needsVastu: !!rule.needsVastu,
    rank,
    strict: strictOut,
    mainPlus, mainMinus, addPlus, addMinus, context, cautions,
    // совместимость со старым форматом потребителей
    restrictions: strictOut,
    favorable: [...mainPlus, ...addPlus],
  };
}

module.exports = {
  ACTIONS,
  ACTION_RULES,
  ACTION_ICONS,
  NICHE_ACTION_KEYS,
  TITHI_PANCHAKA,
  tithiPanchaka,
  nakshatraSvabhava,
  nakshatraGana: nakshatraSvabhava, // старое имя
  specialDayFromTithi,
  dishashulaDirection,
  evaluateAction,
};
