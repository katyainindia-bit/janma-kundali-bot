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

// Иконка на каждое действие — для чипов «поддержано / лучше отложить»
const ACTION_ICONS = {
  education: '🎓',
  travel: '✈️',
  relocation: '🚚',
  realestate: '🏠',
  construction: '🏗️',
  wedding: '💍',
  medicalCheckup: '🩺',
  surgery: '⚕️',
  spiritualPractice: '🧘',
  initiation: '🕉️',
  contract: '📝',
  business: '💼',
  project: '🚀',
  bigPurchase: '🛍️',
  investment: '💰',
  financialDay: '💰',
  haircut: '💇',
  jobHunt: '🧑‍💼',
  jobQuit: '🚪',
  conception: '🌱',
};

// Нишевые действия — не должны вытеснять повседневные категории (работа/учёба/
// практики и т.п.) из блока «поддержано», если только сами не особенно сильны в этот день
const NICHE_ACTION_KEYS = ['medicalCheckup', 'surgery', 'initiation', 'haircut', 'financialDay'];

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
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение', marsBala: 'Благоприятно' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра'],
    // Марс — главный сигнификатор земли/недвижимости в Джйотиш; его транзит
    // именно через 4-й дом (дом жилья) классически считается активирующим
    // для сделок с недвижимостью — это благоприятный сигнал, в отличие от
    // операции, где Марс в трудных домах наоборот избегается.
    favorableMarsHouse: [4],
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
  medicalCheckup: {
    label: 'Осмотр / диагностика',
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение' },
    // Для обычного лечения/осмотра классически хороши "мягкие", "лёгкие" накшатры —
    // та же логика, что уже была общей для медицины.
    favorableNakGana: ['Кшипра', 'Мриду'],
    restrictedNakGana: ['Угра', 'Тикшна'],
  },
  surgery: {
    label: 'Операция',
    roles: { tithi: 'Ограничение', nakshatra: 'Благоприятно', vara: 'Контекст', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение', marsBala: 'Ограничение' },
    // ВАЖНЫЙ НЮАНС (обсуждали отдельно): для операции — наоборот, классически
    // предпочитают "острые"/"яростные" накшатры (резать = острая энергия),
    // а не мягкие, как для обычного лечения. Это не ошибка, а другая логика.
    favorableNakGana: ['Тикшна', 'Угра'],
    restrictedNakGana: ['Кшипра'],
    // Транзитный Марс в 8 или 12 доме от Лагны — классически не подходит для
    // плановой операции (Марс управляет хирургией, но должен быть силён,
    // а не ослаблен положением в трудных домах).
    restrictedMarsHouse: [8, 12],
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
    restrictedNakGana: ['Угра', 'Тикшна'], // тот же паттерн, что уже используется в файле для всех действий, где благоприятна Стхира
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
    roles: { tithi: 'Ограничение', tarabala: 'Благоприятно', vara: 'Благоприятно', nakshatra: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст', specialDay: 'Ограничение', venusBala: 'Благоприятно' },
    favorableNakGana: ['Стхира'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    // Венера — сигнификатор денег на удовольствия и материальные блага;
    // 2-й (накопленное богатство) и 11-й (доходы/приобретения) — классическая
    // "ось богатства". Транзит Венеры через них — благоприятный сигнал
    // именно для трат на комфорт/удовольствие, не для вложений вообще.
    favorableVenusHouse: [2, 11],
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
  jobHunt: {
    label: 'Устройство на работу',
    roles: { tithi: 'Ограничение', vara: 'Благоприятно', nakshatra: 'Благоприятно', tarabala: 'Благоприятно', dasha: 'Контекст', chandraBala: 'Контекст', specialDay: 'Ограничение' },
    favorableNakGana: ['Стхира', 'Кшипра'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    // По аналогии с "Подписанием договора"/"Начало бизнеса" — тот же общий каркас
    // начинаний. Отдельной классической традиции именно под "трудоустройство"
    // (современное понятие) нет, это перенос общих правил начинаний.
  },
  jobQuit: {
    label: 'Увольнение с работы',
    roles: { tarabala: 'Благоприятно', specialDay: 'Ограничение', tithi: 'Контекст', vara: 'Ограничение', nakshatra: 'Контекст', dasha: 'Контекст' },
    favorableNakGana: null,
    restrictedNakGana: null,
    // «Увольнение» — не классическое понятие само по себе (это современная
    // ситуация), поэтому здесь не дословное древнее правило, а рассуждение
    // по значениям планет-управителей дней недели (стандартный приём в
    // мухурте, но применённый к новой теме, а не взятый готовым из текста):
    // Суббота (Сатурн — карака завершений/кармы) и Пятница (Венера — мягкий,
    // дипломатичный уход) — благоприятны. Вторник (Марс — уход через
    // конфликт) и Понедельник (Луна — эмоциональная импульсивность) — хуже.
    favorableVaraIdx: [5, 6], // пятница, суббота
    restrictedVaraIdx: [1, 2], // понедельник, вторник
  },
  conception: {
    label: 'Зачатие (планирование)',
    roles: { tithi: 'Ограничение', nakshatra: 'Ограничение', specialDay: 'Ограничение', tarabala: 'Благоприятно', vara: 'Благоприятно', chandraBala: 'Контекст', dasha: 'Контекст' },
    favorableNakGana: ['Стхира', 'Мриду'],
    restrictedNakGana: ['Угра', 'Тикшна'],
    // Проверено против конкретных источников по Гарбхадхана-мухурте:
    // понедельник/среда/четверг/пятница благоприятны, вторник/суббота — нет —
    // это СОВПАДАЕТ с нашей общей классификацией вара, поэтому теперь честно
    // включила её (было "Контекст"). Титхи — Рикта (4,9,14) уже исключены
    // общим титхи-ограничением, Амавасья/Пурнима — уже общим specialDay,
    // это тоже совпадает с классическими источниками по этой теме отдельно.
    // Оговорка остаётся: точный список благоприятных накшатр по Гарбхадхане
    // специфичнее (называются, например, Рохини, Мригашира отдельно) — здесь
    // по-прежнему общее приближение через Стхира/Мриду, не точный список.
  },
};

// ============================================================
// Оценка одного действия на конкретный день.
// dayCtx ожидает: { tithiNumber, nakshatraIdx, weekdayIdx, taraBala:
// {quality}, dashaChangeToday: {level, lord} | null, moonHouseFromLagna }
// ============================================================
// --- Дишашула — направление, которого традиционно избегают для начала
// поездки в этот день недели. Таблица устойчиво повторяется во всех
// проверенных источниках (не привязана к одному конкретному классическому
// тексту, но это стандартная, повсеместно используемая панчанга-конвенция).
// Индекс — как у JS Date.getUTCDay(): 0=воскресенье...6=суббота.
const DISHASHULA_TABLE = ['Запад', 'Восток', 'Север', 'Север', 'Юг', 'Запад', 'Восток'];
function dishashulaDirection(weekdayIdx) {
  return DISHASHULA_TABLE[weekdayIdx];
}

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
  // Особый день: берём из полного списка календарных событий (Экадаши/Пурнима/Амавасья/
  // Санкранти/затмения — всё, что уже посчитано в calendar-events.js), а не только из титхи —
  // иначе Санкранти и затмения вообще не участвуют в оценке действий (реальный пробел, был найден
  // и закрыт). Если передан только tithiNumber без dayCtx.calendarEvents — используем старый способ.
  const SPECIAL_DAY_TYPES = ['Затмение (лунное)', 'Затмение (солнечное)', 'Санкранти', 'Экадаши', 'Пурнима', 'Амавасья'];
  let specialDay = null;
  if (dayCtx.calendarEvents && dayCtx.calendarEvents.length > 0) {
    // Затмение — самый значимый сигнал, если есть — берём его; иначе первое подходящее
    const eclipse = dayCtx.calendarEvents.find(ev => ev.type === 'Затмение (лунное)' || ev.type === 'Затмение (солнечное)');
    const other = dayCtx.calendarEvents.find(ev => SPECIAL_DAY_TYPES.includes(ev.type));
    specialDay = (eclipse || other) ? (eclipse || other).label : null;
  } else if (dayCtx.tithiNumber != null) {
    specialDay = specialDayFromTithi(dayCtx.tithiNumber);
  }

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

  // Вар — если у действия задан свой собственный список дней (не общая
  // классификация Пн/Ср/Чт/Пт-хорошо, Вт/Сб-сложно), используем его.
  if (action.favorableVaraIdx && dayCtx.weekdayIdx != null && action.favorableVaraIdx.includes(dayCtx.weekdayIdx)) {
    favorable.push('Этот день недели классически хорош именно для этого действия.');
  } else if (roles.vara === 'Ограничение' && action.restrictedVaraIdx) {
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

  // Транзитный Марс от Лагны — для операции 8/12 дом ограничение (Марс
  // ослаблен трудным домом), для недвижимости 4-й дом наоборот благоприятен
  // (Марс — сигнификатор земли, активирует тему жилья).
  if (dayCtx.marsHouseFromLagna != null) {
    if (roles.marsBala === 'Ограничение' && action.restrictedMarsHouse && action.restrictedMarsHouse.includes(dayCtx.marsHouseFromLagna)) {
      restrictions.push(`Марс транзитом в ${dayCtx.marsHouseFromLagna} доме от Лагны — не лучшее время для операции.`);
    } else if (roles.marsBala === 'Благоприятно' && action.favorableMarsHouse && action.favorableMarsHouse.includes(dayCtx.marsHouseFromLagna)) {
      favorable.push(`Марс транзитом в ${dayCtx.marsHouseFromLagna} доме от Лагны — активирует тему недвижимости.`);
    }
  }

  // Транзитная Венера от Лагны — благоприятна для крупных покупок, когда
  // проходит по оси богатства (2-й и 11-й дома).
  if (dayCtx.venusHouseFromLagna != null && roles.venusBala === 'Благоприятно') {
    if (action.favorableVenusHouse && action.favorableVenusHouse.includes(dayCtx.venusHouseFromLagna)) {
      favorable.push(`Венера транзитом в ${dayCtx.venusHouseFromLagna} доме от Лагны — благоприятно для трат на комфорт и удовольствие.`);
    }
  }

  // Дишашула — направление, неблагоприятное для начала поездки в этот день
  // недели. Работает только если явно передано направление поездки —
  // без него просто не участвует в оценке (не выдаём предупреждение "на
  // всякий случай" без данных).
  if (action.extraCheck === 'dishashula' && dayCtx.travelDirection && dayCtx.weekdayIdx != null) {
    const badDirection = dishashulaDirection(dayCtx.weekdayIdx);
    if (dayCtx.travelDirection === badDirection) {
      restrictions.push(`Дишашула: направление «${badDirection}» традиционно не рекомендуется для начала поездки в этот день недели.`);
    } else {
      favorable.push(`Направление поездки не совпадает с Дишашулой этого дня (избегается «${badDirection}»).`);
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
  ACTION_ICONS,
  NICHE_ACTION_KEYS,
  TITHI_PANCHAKA,
  NAKSHATRA_GANA,
  tithiPanchaka,
  nakshatraGana,
  varaGeneral,
  specialDayFromTithi,
  dishashulaDirection,
  evaluateAction,
};

// ============================================================
// OPEN_QUESTIONS — то, что нужно от тебя, прежде чем это будет
// готовым продуктом, а не черновиком:
//
// 1. Вар как «Ограничение»/«Благоприятно» сейчас использует ОДНУ общую
//    классификацию дней недели на все действия (Пн/Ср/Чт/Пт — общий
//    плюс, Вт/Сб — общий минус). Устраивает ли это как база, или нужны
//    для каких-то действий свои собственные исключения по вару (не
//    просто общая благоприятность/сложность)?
// 2. Натальная сила Марса для операции (не только транзитный дом) —
//    обсуждали, отложили как отдельную, более сложную задачу.
// ============================================================
