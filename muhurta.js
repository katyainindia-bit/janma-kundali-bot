// ============================================================
// muhurta.js — движок мухурты: классические факторы + натальная
// персонализация → результат по конкретному действию.
//
// Структура ролей (Ограничение / Благоприятно / Контекст) и список
// действий взяты из согласованного архитектурного документа.
//
// ВАЖНО ПРО ИСТОЧНИКИ ВНУТРИ ЭТОГО ФАЙЛА:
// - TITHI_PANCHAKA и NAKSHATRA_GANA — общепринятая классическая
//   классификация (пять групп титхи; природа накшатр по Гане),
//   используется в большинстве мухурта-текстов без существенных
//   разночтений.
// - ACTIONS — роли факторов по действию взяты из уже согласованного
//   архитектурного документа. А вот КОНКРЕТНОЕ сопоставление
//   «какая природа накшатры считается благоприятной для этого
//   действия» — это уже МОЯ рабочая интерпретация для действий,
//   у которых нет одного канонического текста (устройство на работу,
//   договор, инвестиции и т.п. — современные категории). Для
//   классических самскар (свадьба, гриха-правеша, видьярамбха, ятра)
//   сопоставление опирается на устоявшуюся традицию. Список открытых
//   вопросов — в конце файла, в комментарии OPEN_QUESTIONS.
// ============================================================

const { computeTaraBala } = require('./panchanga.js');

// --- Панчака: пять групп титхи ---
// Нанда (1,6,11,16,21,26) — благоприятно, Пурна (5,10,15,20,25,30) — благоприятно,
// Рикта (4,9,14,19,24,29) — традиционно избегается для начинаний,
// Бхадра/Джая — нейтрально-смешанные, не дают самостоятельного сигнала.
const TITHI_PANCHAKA = {};
[1, 6, 11, 16, 21, 26].forEach(n => (TITHI_PANCHAKA[n] = 'Нанда'));
[2, 7, 12, 17, 22, 27].forEach(n => (TITHI_PANCHAKA[n] = 'Бхадра'));
[3, 8, 13, 18, 23, 28].forEach(n => (TITHI_PANCHAKA[n] = 'Джая'));
[4, 9, 14, 19, 24, 29].forEach(n => (TITHI_PANCHAKA[n] = 'Рикта'));
[5, 10, 15, 20, 25, 30].forEach(n => (TITHI_PANCHAKA[n] = 'Пурна'));

function tithiPanchaka(tithiNumber) {
  return TITHI_PANCHAKA[tithiNumber] || null;
}

// --- Особые дни, выводимые напрямую из номера титхи ---
// Экадаши = 11 и 26; Пурнима = 15; Амавасья = 30.
// Санкранти (смена знака Солнца) и затмения здесь НЕ считаются —
// это отдельные астрономические расчёты, которых пока нет (см. OPEN_QUESTIONS).
function specialDayFromTithi(tithiNumber) {
  if (tithiNumber === 11 || tithiNumber === 26) return 'Экадаши';
  if (tithiNumber === 15) return 'Пурнима';
  if (tithiNumber === 30) return 'Амавасья';
  return null;
}

// --- Гана: природа накшатр (индекс 0-26, порядок как в panchanga.js) ---
// Чара (подвижные) — благоприятны для движения/путешествий
// Стхира (фиксированные) — благоприятны для основания/устойчивых начинаний
// Угра (яростные) и Тикшна (острые) — традиционно избегаются для благоприятных начинаний
// Кшипра (лёгкие) — благоприятны для быстрых дел, медицины
// Мриду (мягкие) — благоприятны для тонких/творческих/гармоничных дел
// Мишра (смешанные) — не дают самостоятельного сигнала
const NAKSHATRA_GANA = [
  'Кшипра', // 0 Ашвини
  'Угра', // 1 Бхарани
  'Мишра', // 2 Криттика
  'Стхира', // 3 Рохини
  'Мриду', // 4 Мригашира
  'Мишра', // 5 Ардра
  'Чара', // 6 Пунарвасу
  'Кшипра', // 7 Пушья
  'Тикшна', // 8 Ашлеша
  'Угра', // 9 Магха
  'Угра', // 10 Пурва Пхалгуни
  'Стхира', // 11 Уттара Пхалгуни
  'Кшипра', // 12 Хаста
  'Мриду', // 13 Читра
  'Чара', // 14 Свати
  'Тикшна', // 15 Вишакха
  'Мриду', // 16 Анурадха
  'Тикшна', // 17 Джьештха
  'Тикшна', // 18 Мула
  'Угра', // 19 Пурва Ашадха
  'Стхира', // 20 Уттара Ашадха
  'Чара', // 21 Шравана
  'Чара', // 22 Дханишта
  'Чара', // 23 Шатабхиша
  'Угра', // 24 Пурва Бхадрапада
  'Стхира', // 25 Уттара Бхадрапада
  'Мриду', // 26 Ревати
];

function nakshatraGana(nakshatraIdx) {
  return NAKSHATRA_GANA[nakshatraIdx] || null;
}

// --- Общая (не привязанная к действию) классификация вара ---
// Пн/Ср/Чт/Пт — классически считаются более благоприятными для начинаний;
// Вт/Сб — более сложные; Вс — смешанный. Это ОБЩИЙ ориентир: то, в какую
// сторону (Ограничение или Благоприятно) он играет для КОНКРЕТНОГО
// действия, определяется ролью фактора «Вар» из ACTIONS ниже.
const VARA_GENERAL = ['Смешанный', 'Благоприятный', 'Сложный', 'Благоприятный', 'Благоприятный', 'Благоприятный', 'Сложный'];
// индекс = date.getUTCDay(): 0=Вс,1=Пн,2=Вт,3=Ср,4=Чт,5=Пт,6=Сб

function varaGeneral(weekdayIdx) {
  return VARA_GENERAL[weekdayIdx];
}

// ============================================================
// ACTIONS — конфигурация действий: роли факторов согласно
// архитектурному документу + рабочее сопоставление конкретных
// значений (природа накшатры), где это можно взять из классики
// без домысливания. Пустые массивы/null — сознательно не заполнены,
// см. OPEN_QUESTIONS.
// ============================================================

const ACTIONS = {
  education: {
    label: 'Начало обучения',
    roles: { tithi: 'Ограничение', nakshatra: 'Ограничение', vara: 'Благоприятно', tarabala: 'Благоприятно', dasha: 'Контекст', chandraBala: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Кшипра', 'Мриду'],
    restrictedNakGana: ['Угра', 'Тикшна'],
  },
  travel: {
    label: 'Путешествие',
    roles: { nakshatra: 'Благоприятно', tarabala: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Чара'],
    restrictedNakGana: ['Тикшна', 'Угра'],
    extraCheck: 'dishashula', // отдельный модуль, см. OPEN_QUESTIONS — пока не реализован
  },
  relocation: {
    label: 'Переезд',
    roles: { tithi: 'Ограничение', nakshatra: 'Ограничение', tarabala: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра', 'Тикшна'],
  },
  realestate: {
    label: 'Покупка недвижимости',
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра'],
  },
  construction: {
    label: 'Строительство',
    roles: { tithi: 'Ограничение', vara: 'Ограничение', nakshatra: 'Ограничение', tarabala: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    extraCheck: 'vastuOrientation', // отдельный модуль, не реализован, см. OPEN_QUESTIONS
  },
  wedding: {
    label: 'Свадьба',
    roles: { tithi: 'Ограничение', vara: 'Ограничение', nakshatra: 'Ограничение', tarabala: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира', 'Мриду'],
    restrictedNakGana: ['Угра', 'Тикшна'],
  },
  medicalProcedure: {
    label: 'Плановые медицинские процедуры',
    roles: { tithi: 'Ограничение', nakshatra: 'Ограничение', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: null, // не определено — см. OPEN_QUESTIONS
    restrictedNakGana: null, // не определено — см. OPEN_QUESTIONS
  },
  spiritualPractice: {
    label: 'Духовные практики',
    roles: { specialDay: 'Благоприятно', chandraBala: 'Благоприятно', tithi: 'Контекст', vara: 'Контекст', nakshatra: 'Контекст', dasha: 'Контекст' },
    favorableSpecialDays: ['Экадаши', 'Амавасья'],
    favorableChandraHouse: [12],
  },
  initiation: {
    label: 'Посвящения / духовные церемонии',
    roles: {}, // намеренно пусто — авторская традиция, см. OPEN_QUESTIONS
  },
  contract: {
    label: 'Подписание договора',
    roles: { tithi: 'Ограничение', vara: 'Благоприятно', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: null, // см. OPEN_QUESTIONS
  },
  business: {
    label: 'Начало бизнеса',
    roles: { tithi: 'Ограничение', vara: 'Благоприятно', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', dasha: 'Благоприятно', chandraBala: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Кшипра'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    goalKey: 'business', // соответствует GOALS.business в date-tools.js
  },
  project: {
    label: 'Запуск проекта',
    roles: { tithi: 'Ограничение', vara: 'Благоприятно', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', dasha: 'Контекст', chandraBala: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Кшипра'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    goalKey: 'project', // соответствует GOALS.project в date-tools.js
  },
  bigPurchase: {
    label: 'Крупные покупки',
    roles: { tithi: 'Ограничение', tarabala: 'Благоприятно', vara: 'Благоприятно', nakshatra: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: null,
  },
  investment: {
    label: 'Инвестиции',
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', vara: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра'],
  },
  // --- Добавлено по запросу: популярные бытовые «особые дни» как действия,
  // а не отдельные календарные метки — тогда учитывают и натальную карту.
  financialDay: {
    label: 'Финансовый день',
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', vara: 'Благоприятно', tarabala: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра'],
    // Гуру-Пушья-йога: Пушья + четверг — классически один из сильнейших
    // дней для денежных дел/золота. Обрабатывается отдельно в evaluateAction
    // (не через общую гану, т.к. это конкретно Пушья, а не вся группа Кшипра).
    specialCombo: 'guruPushya',
  },
  haircut: {
    label: 'Стрижка волос',
    roles: { vara: 'Ограничение', nakshatra: 'Благоприятно', tithi: 'Контекст', tarabala: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст' },
    favorableNakGana: ['Кшипра', 'Чара'],
    restrictedNakGana: null,
    restrictedVaraIdx: [2], // вторник — самое устойчивое общее правило про стрижку
    // Это действие — самое слабо обосновано классикой из всех: конкретные
    // правила по стрижке волос сильно расходятся между региональными
    // традициями и популярными панчангами гораздо больше, чем остальное
    // в этом файле. Взято по общей логике (Кшипра/Чара — быстрые/лёгкие
    // дела, вторник — общеизвестное избегание), а не по одному тексту.
  },
};

// ============================================================
// Оценка одного действия на конкретный день.
// dayCtx ожидает: { tithiNumber, nakshatraIdx, weekdayIdx, taraBala:
// {quality}, dashaChangeToday: {level, lord} | null, moonHouseFromLagna }
// ============================================================
function evaluateAction(actionKey, dayCtx) {
  const action = ACTIONS[actionKey];
  if (!action) throw new Error('Неизвестное действие: ' + actionKey);

  const restrictions = [];
  const favorable = [];
  const context = [];
  const roles = action.roles || {};

  const panchaka = dayCtx.tithiNumber != null ? tithiPanchaka(dayCtx.tithiNumber) : null;
  // Пакша (растущая/убывающая Луна) — выводится напрямую из номера титхи, если явно не передана
  const paksha = dayCtx.paksha != null ? dayCtx.paksha
    : dayCtx.tithiNumber != null ? (dayCtx.tithiNumber <= 15 ? 'Шукла (растущая)' : 'Кришна (убывающая)')
    : null;
  const gana = dayCtx.nakshatraIdx != null ? nakshatraGana(dayCtx.nakshatraIdx) : null;
  const varaGen = dayCtx.weekdayIdx != null ? varaGeneral(dayCtx.weekdayIdx) : null;
  const specialDay = dayCtx.tithiNumber != null ? specialDayFromTithi(dayCtx.tithiNumber) : null;

  // Титхи
  if (roles.tithi === 'Ограничение' && panchaka === 'Рикта') {
    restrictions.push('Титхи Рикта — традиционно не рекомендуется для начинаний такого рода.');
  } else if (roles.tithi === 'Благоприятно' && (panchaka === 'Пурна' || panchaka === 'Нанда')) {
    favorable.push(`Титхи группы ${panchaka} — благоприятна.`);
  } else if (roles.tithi === 'Контекст' && panchaka) {
    context.push(`Титхи группы ${panchaka}.`);
  }

  // Накшатра
  if (gana && (roles.nakshatra === 'Ограничение' || roles.nakshatra === 'Благоприятно')) {
    if (action.restrictedNakGana && action.restrictedNakGana.includes(gana)) {
      restrictions.push(`Накшатра дня относится к группе «${gana}» — требует осторожности для этого действия.`);
    } else if (action.favorableNakGana && action.favorableNakGana.includes(gana)) {
      favorable.push(`Накшатра дня относится к группе «${gana}» — благоприятна для этого действия.`);
    }
  } else if (roles.nakshatra === 'Контекст' && gana) {
    context.push(`Накшатра дня — природа «${gana}».`);
  }

  // Вар
  if (roles.vara === 'Ограничение' && action.restrictedVaraIdx) {
    // Точный день недели (не общая классификация) — например, вторник для стрижки
    if (dayCtx.weekdayIdx != null && action.restrictedVaraIdx.includes(dayCtx.weekdayIdx)) {
      restrictions.push('Этот день недели традиционно избегается для этого действия.');
    }
  } else if (roles.vara === 'Ограничение' && varaGen === 'Сложный') {
    restrictions.push('День недели классически считается более сложным для этого действия.');
  } else if (roles.vara === 'Благоприятно' && varaGen === 'Благоприятный') {
    favorable.push('День недели благоприятен.');
  } else if (roles.vara === 'Контекст' && varaGen) {
    context.push(`День недели: ${varaGen}.`);
  }

  // Гуру-Пушья-йога (только для действий с specialCombo === 'guruPushya'):
  // Пушья (индекс накшатры 7) — уже сильный сигнал сам по себе, а в четверг — особенно.
  if (action.specialCombo === 'guruPushya' && dayCtx.nakshatraIdx === 7) {
    if (dayCtx.weekdayIdx === 4) {
      favorable.push('Сегодня Гуру-Пушья-йога (накшатра Пушья + четверг) — один из самых благоприятных дней для этого действия.');
    } else {
      favorable.push('Накшатра Пушья — благоприятна для денежных дел.');
    }
  }

  // Тарабала
  const tq = dayCtx.taraBala && dayCtx.taraBala.quality;
  if (roles.tarabala === 'Благоприятно' && (tq === 'благоприятно' || tq === 'наиболее благоприятно')) {
    favorable.push('Тарабала дня благоприятна.');
  } else if (roles.tarabala && (tq === 'неблагоприятно' || tq === 'наименее благоприятно')) {
    restrictions.push('Тарабала дня неблагоприятна — стоит учитывать независимо от роли фактора для этого действия.');
  } else if (roles.tarabala === 'Контекст' && tq) {
    context.push(`Тарабала: ${tq}.`);
  }

  // Пакша — универсальный модификатор (Уровень 1), одинаково для всех действий
  if (paksha) {
    context.push(`Пакша: ${paksha}.`);
  }

  // Особые дни (для практик — благоприятно; для остального, если Ограничение — предупреждение)
  if (specialDay) {
    if (roles.specialDay === 'Благоприятно' && action.favorableSpecialDays && action.favorableSpecialDays.includes(specialDay)) {
      favorable.push(`Сегодня ${specialDay} — благоприятный день для этого действия.`);
    } else if (roles.specialDay === 'Ограничение') {
      restrictions.push(`Сегодня ${specialDay} — требует осторожности для этого действия.`);
    } else {
      context.push(`Сегодня ${specialDay}.`);
    }
  }

  // Даша (смена периода сегодня)
  if (dayCtx.dashaChangeToday) {
    const msg = `Сегодня начинается новый период даши (${dayCtx.dashaChangeToday.level}: ${dayCtx.dashaChangeToday.lord}).`;
    if (roles.dasha === 'Благоприятно') favorable.push(msg);
    else context.push(msg);
  }

  // Чандра-бала (Луна от Лагны)
  if (dayCtx.moonHouseFromLagna != null) {
    if (action.favorableChandraHouse && action.favorableChandraHouse.includes(dayCtx.moonHouseFromLagna) && roles.chandraBala === 'Благоприятно') {
      favorable.push(`Луна проходит ${dayCtx.moonHouseFromLagna} дом от Лагны — благоприятно для этого действия.`);
    } else if (roles.chandraBala === 'Контекст') {
      context.push(`Луна проходит ${dayCtx.moonHouseFromLagna} дом от Лагны.`);
    }
  }

  return {
    actionKey,
    label: action.label,
    restrictions,
    favorable,
    context,
    extraCheck: action.extraCheck || null, // напоминание, что для этого действия есть нереализованный доп.модуль
  };
}

module.exports = {
  ACTIONS,
  TITHI_PANCHAKA,
  NAKSHATRA_GANA,
  tithiPanchaka,
  nakshatraGana,
  varaGeneral,
  specialDayFromTithi,
  evaluateAction,
};

// ============================================================
// OPEN_QUESTIONS — то, что нужно от тебя, прежде чем это будет
// готовым продуктом, а не черновиком:
//
// 1. Плановые медицинские процедуры — favorableNakGana/restrictedNakGana
//    не заполнены совсем. Это чувствительная область, нужен твой взгляд.
// 2. Посвящения / духовные церемонии — roles вообще пустой объект.
//    Твоя личная традиция (Шри Видья) — не хочу додумывать общими
//    словами то, что у тебя наверняка есть конкретно.
// 3. Подписание договора / Крупные покупки — restrictedNakGana: null.
//    Сейчас накшатра только «включает благоприятность», но не может
//    предупредить — нормально ли это, или нужны и стоп-накшатры тоже?
// 4. Дишашула (модуль для Путешествия) — не реализован вообще, нужна
//    таблица «направление ↔ день недели», которую нужно закодировать
//    отдельно с нуля.
// 5. Ориентир участка / Васту (модуль для Строительства) — не
//    реализован, содержание модуля пока не определено вообще.
// 6. Санкранти и затмения как «особые дни» — сейчас НЕ считаются
//    (специальный день выводится только из номера титхи: Экадаши/
//    Пурнима/Амавасья). Санкранти технически несложно добавить
//    (смена знака Солнца день-к-дню), затмения сложнее (нужен
//    отдельный астрономический расчёт) — насколько это приоритетно?
// 7. Вар как «Ограничение»/«Благоприятно» сейчас использует ОДНУ общую
//    классификацию дней недели на все действия (Пн/Ср/Чт/Пт — общий
//    плюс, Вт/Сб — общий минус). Устраивает ли это как база, или нужны
//    для каких-то действий свои собственные исключения по вару (не
//    просто общая благоприятность/сложность)?
// ============================================================
