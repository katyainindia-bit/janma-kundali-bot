// ============================================================
// muhurta-rules.js — ПРАВИЛА мухурты как данные (без логики).
//
// Всё, что астролог захочет изменить (списки накшатр, дни недели,
// титхи, исключения), правится ТОЛЬКО здесь. Движок оценки
// (muhurta.js) этот файл не меняет и в нём ничего не «зашито».
//
// Источник правил: классическая мухурта-традиция (Мухурта Чинтамани и
// родственные тексты) в рабочей редакции, утверждённой автором
// приложения. Точные ссылки на стихи не проверялись — списки помечены
// source: 'классика, рабочая редакция' и подлежат сверке автором.
//
// Четыре уровня факторов (из ТЗ):
//   strict     — строгое ограничение (время не рекомендуется)
//   main       — основной фактор (ключевой показатель мухурты)
//   additional — дополнительный (усиливает/ослабляет, не отменяет)
//   context    — контекст (сам по себе оценку не меняет)
// ============================================================

// --- Накшатры (индексы 0–26, порядок как в panchanga.js) ---
const NAKSHATRA_NAMES = [
  'Ашвини', 'Бхарани', 'Криттика', 'Рохини', 'Мригашира', 'Ардра', 'Пунарвасу', 'Пушья', 'Ашлеша',
  'Магха', 'Пурва Пхалгуни', 'Уттара Пхалгуни', 'Хаста', 'Читра', 'Свати', 'Вишакха', 'Анурадха', 'Джьештха',
  'Мула', 'Пурва Ашадха', 'Уттара Ашадха', 'Шравана', 'Дханишта', 'Шатабхиша', 'Пурва Бхадрапада', 'Уттара Бхадрапада', 'Ревати',
];
const nak = (...names) => names.map(n => {
  const i = NAKSHATRA_NAMES.indexOf(n);
  if (i < 0) throw new Error('muhurta-rules: неизвестная накшатра «' + n + '»');
  return i;
});

// --- Свабхава накшатр (природа). НЕ путать с Ганой (Дева/Манушья/Ракшаса). ---
// Классическая классификация:
//   Кшипра (быстрые): Ашвини, Пушья, Хаста (+ Абхиджит)
//   Чара (подвижные): Пунарвасу, Свати, Шравана, Дханишта, Шатабхиша
//   Стхира (устойчивые): Рохини, Уттара Пхалгуни, Уттара Ашадха, Уттара Бхадрапада
//   Мриду (мягкие): Мригашира, Читра, Анурадха, Ревати
//   Угра (суровые): Бхарани, Магха, Пурва Пхалгуни, Пурва Ашадха, Пурва Бхадрапада
//   Тикшна (острые): Ардра, Ашлеша, Джьештха, Мула
//   Мишра (смешанные): Криттика, Вишакха
const SVABHAVA = new Array(27);
[['Кшипра', nak('Ашвини', 'Пушья', 'Хаста')],
 ['Чара', nak('Пунарвасу', 'Свати', 'Шравана', 'Дханишта', 'Шатабхиша')],
 ['Стхира', nak('Рохини', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада')],
 ['Мриду', nak('Мригашира', 'Читра', 'Анурадха', 'Ревати')],
 ['Угра', nak('Бхарани', 'Магха', 'Пурва Пхалгуни', 'Пурва Ашадха', 'Пурва Бхадрапада')],
 ['Тикшна', nak('Ардра', 'Ашлеша', 'Джьештха', 'Мула')],
 ['Мишра', nak('Криттика', 'Вишакха')],
].forEach(([name, list]) => list.forEach(i => { SVABHAVA[i] = name; }));

// --- Общие строгие ограничения (для ВСЕХ действий, кроме тех, где указано исключение) ---
const GENERAL = {
  // Рикта (4, 9, 14 в обеих пакшах) и Амавасья (30)
  tithiStrict: [4, 9, 14, 19, 24, 29, 30],
  tithiStrictNames: { 30: 'Амавасья' },
  // Вишти (Бхадра) карана
  karanaStrict: ['Вишти'],
  // Вьятипата и Вайдхрити — махапата-йоги
  yogaStrict: ['Вьятипата', 'Вайдхрити'],
  // Затмения — день затмения для начинаний не рекомендуется
  eclipseStrict: true,
};

// Базовый (мягкий) список благоприятных титхи в пакше (1–15): Бхадра, Джая, Пурна, Нанда-11
const TITHI_PLUS_BASE = [2, 3, 5, 7, 10, 11, 12, 13];

const GOOD_WEEKDAYS_COMMON = [1, 3, 4, 5]; // пн, ср, чт, пт — как ПОДДЕРЖИВАЮЩИЙ фактор, не как условие
const HARSH = ['Угра', 'Тикшна'];

// ============================================================
// ПРОСТЫЕ ДЕЛА — «Сегодня» и «Дни». Панчанга + личные показатели.
// ============================================================
// Поля действия:
//   category        'simple' | 'major' | 'pending'
//   nakshatraPlus   явный список накшатр (индексы) — основной плюс
//   groupsPlus      группы Свабхавы — основной плюс
//   groupsMinus     группы Свабхавы — основной минус (не красный, просто «не поддержано»)
//   tithiPlus       титхи в пакше (1–15) — дополнительный плюс
//   varaPlus/Minus  дни недели (0=вс … 6=сб) — дополнительный плюс/минус
//   specialDayPlus  особые дни (по типу события) — основной плюс
//   ignoreGeneral   true — не применять общие строгие ограничения;
//                   или массив: 'tithi' | 'karana' | 'yoga' | 'eclipse'
//   neverPostpone   true — строгие ограничения не выводятся как «отложить»
//   personal        'additional' (Тара/Чандра-бала влияют) | 'context'
//   combo           'guruPushya'
//   dishashula      true — проверка направления поездки
//   needsFullMuhurta  true — требуется полноценная мухурта (лагна и т.д.)
//   gandantaPada    true — строгое ограничение на пады стыков знаков
//   period          данные для оценки периода (даша + гочара), только major
const ACTION_RULES = {
  // ---------------- ПРОСТЫЕ ----------------
  haircut: {
    label: 'Стрижка волос', icon: '💇', category: 'simple',
    groupsPlus: ['Кшипра', 'Мриду', 'Чара'], groupsMinus: HARSH,
    varaPlus: [1, 3, 4, 5], varaMinus: [0, 2, 6],
    personal: 'additional',
  },
  medicalCheckup: {
    label: 'Осмотр / диагностика', icon: '🩺', category: 'simple',
    groupsPlus: ['Кшипра', 'Мриду', 'Чара'],
    varaPlus: [1, 3, 4, 5],
    // Медицину не откладываем по панчанге: строгие ограничения не применяются.
    ignoreGeneral: true, neverPostpone: true,
    personal: 'additional',
  },
  travel: {
    label: 'Путешествие', icon: '✈️', category: 'simple',
    nakshatraPlus: nak('Ашвини', 'Мригашира', 'Пунарвасу', 'Пушья', 'Хаста', 'Анурадха', 'Шравана', 'Дханишта', 'Ревати'),
    groupsMinus: HARSH,
    varaPlus: [1, 3, 4, 5],
    dishashula: true,
    personal: 'additional',
  },
  education: {
    label: 'Начало обучения', icon: '🎓', category: 'simple',
    groupsPlus: ['Кшипра', 'Мриду'], nakshatraPlus: nak('Шравана'), groupsMinus: HARSH,
    varaPlus: [3, 4],
    tithiPlus: TITHI_PLUS_BASE,
    personal: 'additional',
  },
  spiritualPractice: {
    label: 'Духовные практики', icon: '🧘', category: 'simple',
    nakshatraPlus: nak('Пушья', 'Анурадха', 'Шравана'), groupsPlus: ['Стхира'],
    specialDayPlus: ['Экадаши', 'Пурнима', 'Амавасья'],
    varaPlus: [4, 1],
    // Универсальных ограничений нет (ни по Угра/Тикшна, ни по Таре, ни по Рикте).
    ignoreGeneral: true, neverPostpone: true,
    personal: 'context',
  },
  contract: {
    label: 'Подписание договора', icon: '📝', category: 'simple',
    groupsPlus: ['Стхира', 'Кшипра'], groupsMinus: HARSH,
    varaPlus: [3, 4, 5],
    tithiPlus: TITHI_PLUS_BASE,
    personal: 'additional',
  },
  bigPurchase: {
    label: 'Крупные покупки', icon: '🛍️', category: 'simple',
    groupsPlus: ['Мриду', 'Кшипра'], groupsMinus: HARSH,
    varaPlus: [1, 3, 5],
    tithiPlus: TITHI_PLUS_BASE,
    personal: 'additional',
  },
  financialAffairs: {
    label: 'Финансовые дела', icon: '💰', category: 'simple',
    groupsPlus: ['Кшипра', 'Чара'], groupsMinus: HARSH,
    varaPlus: [3, 4, 5],
    combo: 'guruPushya',
    personal: 'additional',
  },
  jobHunt: {
    label: 'Устройство на работу', icon: '🧑‍💼', category: 'simple',
    groupsPlus: ['Стхира', 'Кшипра'], groupsMinus: HARSH,
    varaPlus: [3, 4, 1],
    tithiPlus: TITHI_PLUS_BASE,
    personal: 'additional',
  },
  negotiations: {
    label: 'Переговоры', icon: '🤝', category: 'simple',
    groupsPlus: ['Кшипра', 'Мриду', 'Чара'], groupsMinus: HARSH,
    varaPlus: [3, 4],
    personal: 'additional',
  },
  dating: {
    label: 'Знакомство, свидание', icon: '💞', category: 'simple',
    groupsPlus: ['Мриду'], nakshatraPlus: nak('Рохини', 'Пушья'), groupsMinus: HARSH,
    varaPlus: [1, 5],
    personal: 'additional',
  },
  interview: {
    label: 'Собеседование, выступление', icon: '🎤', category: 'simple',
    groupsPlus: ['Кшипра', 'Стхира'], groupsMinus: HARSH,
    varaPlus: [3, 4, 1],
    personal: 'additional',
  },
  dietStart: {
    label: 'Начало диеты, очищения', icon: '🥗', category: 'simple',
    groupsPlus: ['Кшипра', 'Мриду'],
    varaPlus: [1, 4],
    ignoreGeneral: ['tithi'],
    personal: 'additional',
  },
  fasting: {
    label: 'Пост (Экадаши)', icon: '🌙', category: 'simple',
    specialDayPlus: ['Экадаши'],
    ignoreGeneral: true, neverPostpone: true,
    personal: 'context',
  },
  documents: {
    label: 'Документы, визы, официальные дела', icon: '📄', category: 'simple',
    groupsPlus: ['Кшипра', 'Стхира'], groupsMinus: HARSH,
    varaPlus: [3, 4],
    tithiPlus: TITHI_PLUS_BASE,
    personal: 'additional',
  },

  // ---------------- КРУПНЫЕ (полная формула: мухурта + даша + гочара) ----------------
  wedding: {
    label: 'Свадьба', icon: '💍', category: 'major',
    nakshatraPlus: nak('Рохини', 'Мригашира', 'Магха', 'Уттара Пхалгуни', 'Хаста', 'Свати', 'Анурадха', 'Мула', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Ревати'),
    tithiPlus: [2, 3, 5, 7, 10, 11, 13],
    varaPlus: [1, 3, 4, 5],
    // Стыки знаков (гандаанта): 1-я пада Магхи, 1-я пада Мулы, 4-я пада Ревати
    gandantaPada: [{ nak: 9, pada: 1 }, { nak: 18, pada: 1 }, { nak: 26, pada: 4 }],
    astaCheck: ['Юпитер', 'Венера'],
    needsFullMuhurta: true,
    personal: 'additional',
    period: {
      dashaHouses: [7, 2, 11], dashaKarakas: ['Венера', 'Юпитер'],
      gocharaHouses: [7], gocharaPlanets: ['Юпитер', 'Сатурн', 'Венера'],
    },
  },
  realestate: {
    label: 'Покупка недвижимости', icon: '🏠', category: 'major',
    nakshatraPlus: nak('Рохини', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Мригашира', 'Читра', 'Анурадха', 'Ревати'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [1, 3, 4, 5],
    needsFullMuhurta: true,
    personal: 'additional',
    period: {
      dashaHouses: [4, 2, 11], dashaKarakas: ['Марс', 'Венера'],
      gocharaHouses: [4], gocharaPlanets: ['Юпитер', 'Сатурн', 'Марс'],
    },
  },
  construction: {
    label: 'Начало строительства', icon: '🏗️', category: 'major',
    nakshatraPlus: nak('Рохини', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Пушья', 'Шравана', 'Дханишта', 'Шатабхиша'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [1, 3, 4, 5],
    needsFullMuhurta: true, needsVastu: true,
    personal: 'additional',
    period: {
      dashaHouses: [4, 9, 11], dashaKarakas: ['Марс', 'Сатурн'],
      gocharaHouses: [4], gocharaPlanets: ['Юпитер', 'Сатурн', 'Марс'],
    },
  },
  relocation: {
    label: 'Переезд / Гриха-правеша', icon: '🚚', category: 'major',
    nakshatraPlus: nak('Рохини', 'Мригашира', 'Уттара Пхалгуни', 'Читра', 'Анурадха', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Ревати'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [1, 3, 4, 5],
    personal: 'additional',
    period: {
      dashaHouses: [4, 3, 12], dashaKarakas: ['Луна'],
      gocharaHouses: [4, 12], gocharaPlanets: ['Юпитер', 'Сатурн', 'Раху'],
    },
  },
  business: {
    label: 'Начало бизнеса', icon: '💼', category: 'major',
    nakshatraPlus: nak('Ашвини', 'Пушья', 'Хаста', 'Рохини', 'Мригашира', 'Читра', 'Анурадха', 'Ревати', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [3, 4, 5],
    personal: 'additional',
    period: {
      dashaHouses: [7, 10, 2, 11], dashaKarakas: ['Меркурий', 'Юпитер'],
      gocharaHouses: [7, 10, 11], gocharaPlanets: ['Юпитер', 'Сатурн', 'Меркурий'],
    },
  },
  project: {
    label: 'Запуск проекта', icon: '🚀', category: 'major',
    nakshatraPlus: nak('Ашвини', 'Пушья', 'Хаста', 'Рохини', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Мригашира', 'Читра', 'Анурадха', 'Ревати'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [3, 4, 5],
    personal: 'additional',
    period: {
      dashaHouses: [3, 5, 10, 11], dashaKarakas: ['Солнце', 'Меркурий'],
      gocharaHouses: [3, 10, 11], gocharaPlanets: ['Юпитер', 'Сатурн', 'Меркурий'],
    },
  },
  investment: {
    label: 'Инвестиции', icon: '📈', category: 'major',
    nakshatraPlus: nak('Рохини', 'Уттара Пхалгуни', 'Уттара Ашадха', 'Уттара Бхадрапада', 'Пушья', 'Хаста', 'Мригашира', 'Анурадха', 'Ревати'),
    tithiPlus: TITHI_PLUS_BASE,
    varaPlus: [3, 4, 5],
    personal: 'additional',
    period: {
      dashaHouses: [2, 5, 8, 11], dashaKarakas: ['Юпитер', 'Венера', 'Меркурий'],
      gocharaHouses: [2, 5, 8, 11], gocharaPlanets: ['Юпитер', 'Сатурн', 'Меркурий'],
    },
  },
  jobQuit: {
    label: 'Увольнение с работы', icon: '🚪', category: 'major',
    // Накшатры, титхи и дни недели не утверждены намеренно: решает период.
    // Мухурта только отсеивает общие строгие ограничения.
    personal: 'additional',
    period: {
      dashaHouses: [6, 10, 8, 12], dashaKarakas: [],
      gocharaHouses: [6, 10, 12], gocharaPlanets: ['Сатурн', 'Юпитер', 'Кету'],
    },
  },

  // ---------------- ПРАВИЛА ТРЕБУЮТ УТОЧНЕНИЯ ----------------
  conception: { label: 'Зачатие (планирование)', icon: '🌱', category: 'pending', note: 'Правила требуют уточнения.' },
  surgery: { label: 'Операция', icon: '⚕️', category: 'pending', note: 'Правила требуют уточнения.' },
  initiation: { label: 'Посвящения / духовные церемонии', icon: '🕉️', category: 'pending', note: 'Правила будут добавлены отдельно (авторская традиция).' },
};

module.exports = { NAKSHATRA_NAMES, SVABHAVA, GENERAL, TITHI_PLUS_BASE, ACTION_RULES, GOOD_WEEKDAYS_COMMON, nak };
