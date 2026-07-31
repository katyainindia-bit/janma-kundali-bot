// ============================================================
// calendar-events.js — «Астрологические события»: отдельная от
// движка мухурты сущность. Экраны (Сегодня/Календарь/Подбор даты)
// читают события отсюда, сама мухурта про них ничего не знает.
//
// Типы событий: Праздник, Затмение, Санкранти, Пурнима, Амавасья,
// Экадаши, Особый день.
//
// ЧТО РЕАЛЬНО СЧИТАЕТСЯ прямо сейчас:
// - Пурнима/Амавасья/Экадаши — из номера титхи (уже есть в движке)
// - Санкранти — сравнение сидерического знака Солнца день-к-дню
// - Затмения — НЕ вычисляются астрономически (это отдельный сложный
//   расчёт: узлы орбиты, Сарос и т.д.), а взяты статической таблицей
//   реальных дат из открытых астрономических источников (NASA/USNO)
//   на 2026-2027 год. Таблицу нужно будет продлевать на следующие
//   годы вручную — см. OPEN_QUESTIONS в конце файла.
//
// ЧТО ВЗЯТО СТАТИЧЕСКОЙ ТАБЛИЦЕЙ (та же логика, что и затмения):
// - Именованные ведические праздники на 2026 год (Гуру Пурнима, Дивали,
//   Джанмаштами, Маха Шиваратри и т.д.) — реальные даты из открытых
//   панчанг-источников. Не расчёт лунного месяца — просто список дат,
//   который нужно будет продлевать на 2027+ вручную. См. OPEN_QUESTIONS.
// ============================================================

const { jdFromDate, sunLongitude, lahiriAyanamsha } = require('./engine.js');

function pmod(x, y) { let r = x % y; if (r < 0) r += y; return r; }

const EVENT_TYPES = {
  FESTIVAL: 'Праздник',
  ECLIPSE_LUNAR: 'Затмение (лунное)',
  ECLIPSE_SOLAR: 'Затмение (солнечное)',
  SANKRANTI: 'Санкранти',
  PURNIMA: 'Пурнима',
  AMAVASYA: 'Амавасья',
  EKADASHI: 'Экадаши',
  SPECIAL: 'Особый день',
};

const EVENT_ICONS = {
  [EVENT_TYPES.FESTIVAL]: '🕉️',
  [EVENT_TYPES.ECLIPSE_LUNAR]: '🌘',
  [EVENT_TYPES.ECLIPSE_SOLAR]: '🌞',
  [EVENT_TYPES.SANKRANTI]: '🧭',
  [EVENT_TYPES.PURNIMA]: '🌕',
  [EVENT_TYPES.AMAVASYA]: '🌑',
  [EVENT_TYPES.EKADASHI]: '🌙',
  [EVENT_TYPES.SPECIAL]: '✨',
};

// Короткие описания под каждый тип события — черновик, ожидает правки
// под голос бренда (см. /preferences и /topics/voice-and-writing-style).
const EVENT_DESCRIPTIONS = {
  [EVENT_TYPES.EKADASHI]: 'Хороший день для практик и внутренней дисциплины. Новые начинания лучше отложить.',
  [EVENT_TYPES.PURNIMA]: 'Пик лунного месяца. Эмоции ощущаются острее — время для завершения дел и благодарности.',
  [EVENT_TYPES.AMAVASYA]: 'Новолуние. Энергия направлена внутрь — не лучшее время для активных стартов.',
  [EVENT_TYPES.SANKRANTI]: 'Солнце переходит в новый знак. День перехода — не самый устойчивый для важных решений.',
  [EVENT_TYPES.ECLIPSE_LUNAR]: 'Затмение снижает предсказуемость дня. Важные решения лучше перенести на несколько дней.',
  [EVENT_TYPES.ECLIPSE_SOLAR]: 'Затмение снижает предсказуемость дня. Важные решения лучше перенести на несколько дней.',
};

// --- События, выводимые из номера титхи (1-30) ---
function tithiEvents(tithiNumber) {
  const events = [];
  if (tithiNumber === 15) events.push({ type: EVENT_TYPES.PURNIMA, label: 'Пурнима' });
  if (tithiNumber === 30) events.push({ type: EVENT_TYPES.AMAVASYA, label: 'Амавасья' });
  if (tithiNumber === 11 || tithiNumber === 26) events.push({ type: EVENT_TYPES.EKADASHI, label: 'Экадаши' });
  return events;
}

// --- Санкранти: сидерический знак Солнца сегодня отличается от вчерашнего ---
const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];

function sunSiderealSignIdx(year, month, day) {
  const jd = jdFromDate(year, month, day, 12, 0, 0, 0);
  const sidLon = pmod(sunLongitude(jd) - lahiriAyanamsha(jd), 360);
  return Math.floor(sidLon / 30);
}

function sankrantiEvent(year, month, day) {
  const todayIdx = sunSiderealSignIdx(year, month, day);
  const y = new Date(Date.UTC(year, month - 1, day) - 86400000);
  const yestIdx = sunSiderealSignIdx(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate());
  if (todayIdx !== yestIdx) {
    return { type: EVENT_TYPES.SANKRANTI, label: `Санкранти — Солнце входит в ${SIGN_NAMES[todayIdx]}` };
  }
  return null;
}

// --- Затмения: статическая таблица реальных дат (источник: NASA/USNO), 2026-2027 ---
// Даты по UTC. Нужно продлевать вручную по мере необходимости — см. OPEN_QUESTIONS.
const ECLIPSES = [
  { date: '2026-02-17', type: EVENT_TYPES.ECLIPSE_SOLAR, label: 'Солнечное затмение (кольцеобразное)' },
  { date: '2026-03-03', type: EVENT_TYPES.ECLIPSE_LUNAR, label: 'Лунное затмение (полное)' },
  { date: '2026-08-12', type: EVENT_TYPES.ECLIPSE_SOLAR, label: 'Солнечное затмение (полное)' },
  { date: '2026-08-28', type: EVENT_TYPES.ECLIPSE_LUNAR, label: 'Лунное затмение (частное)' },
  { date: '2027-02-06', type: EVENT_TYPES.ECLIPSE_SOLAR, label: 'Солнечное затмение (кольцеобразное)' },
  { date: '2027-02-20', type: EVENT_TYPES.ECLIPSE_LUNAR, label: 'Лунное затмение (полутеневое)' },
  { date: '2027-07-18', type: EVENT_TYPES.ECLIPSE_LUNAR, label: 'Лунное затмение (полутеневое)' },
  { date: '2027-08-02', type: EVENT_TYPES.ECLIPSE_SOLAR, label: 'Солнечное затмение (полное)' },
];

function eclipseEventForDate(dateISO) {
  return ECLIPSES.find(e => e.date === dateISO) || null;
}

// --- Именованные праздники: статическая таблица на 2026 год ---
// Реальные даты из открытых панчанг-источников. Нужно продлевать на 2027+
// вручную — как и с затмениями. Джанмаштами: указана дата по Смарта-традиции
// (4 сентября) — ISKCON и большинство вайшнавских храмов отмечают на день
// позже (5 сентября), это расхождение стоит иметь в виду.
const NAMED_FESTIVALS = [
  { date: '2026-01-14', label: 'Макара Санкранти' },
  { date: '2026-02-15', label: 'Маха Шиваратри' },
  { date: '2026-03-03', label: 'Холика Дахан' },
  { date: '2026-03-04', label: 'Холи' },
  { date: '2026-03-19', label: 'Начало Чайтра Навратри' },
  { date: '2026-03-27', label: 'Рама Навами' },
  { date: '2026-04-02', label: 'Хануман Джаянти' },
  { date: '2026-04-20', label: 'Акшая Тритья' },
  { date: '2026-05-01', label: 'Будда Пурнима' },
  { date: '2026-07-29', label: 'Гуру Пурнима' },
  { date: '2026-08-28', label: 'Ракша Бандхан' },
  { date: '2026-09-04', label: 'Джанмаштами' },
  { date: '2026-09-14', label: 'Ганеша Чатуртхи' },
  { date: '2026-10-11', label: 'Начало Шарад Навратри' },
  { date: '2026-10-20', label: 'Дуссехра (Виджаядашами)' },
  { date: '2026-11-06', label: 'Дхантерас' },
  { date: '2026-11-08', label: 'Дивали' },
  { date: '2026-11-10', label: 'Говардхан Пуджа' },
  { date: '2026-11-11', label: 'Бхаи Дудж' },
];

function festivalEventForDate(dateISO) {
  const f = NAMED_FESTIVALS.find(f => f.date === dateISO);
  return f ? { ...f, type: EVENT_TYPES.FESTIVAL } : null;
}

// --- Все события на конкретную календарную дату ---
function getEventsForDate(year, month, day, tithiNumber) {
  const dateISO = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const events = [];
  events.push(...tithiEvents(tithiNumber));
  const sankranti = sankrantiEvent(year, month, day);
  if (sankranti) events.push(sankranti);
  const eclipse = eclipseEventForDate(dateISO);
  if (eclipse) events.push(eclipse);
  const festival = festivalEventForDate(dateISO);
  if (festival) events.push(festival);
  return events.map(ev => ({ ...ev, description: EVENT_DESCRIPTIONS[ev.type] || null }));
}

// --- Ближайшие события: сканирует вперёд от даты, ищет первое
// вхождение каждого типа события, возвращает с числом дней «через N».
// tithiNumberForDate(date) — функция, которую вызывающий код должен
// передать (обычно через computePanchanga), чтобы не тащить сюда
// зависимость от панчанги напрямую.
function findUpcomingEvents(fromDate, daysAhead, tithiNumberForDate) {
  const found = {};
  const dayMs = 24 * 3600 * 1000;
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(fromDate.getTime() + i * dayMs);
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
    const tithiNumber = tithiNumberForDate(d);
    const events = getEventsForDate(year, month, day, tithiNumber);
    for (const ev of events) {
      const key = ev.type + ':' + ev.label;
      if (!found[key]) found[key] = { ...ev, daysAhead: i, date: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` };
    }
  }
  return Object.values(found).sort((a, b) => a.daysAhead - b.daysAhead);
}

module.exports = {
  EVENT_TYPES,
  EVENT_ICONS,
  tithiEvents,
  sankrantiEvent,
  eclipseEventForDate,
  festivalEventForDate,
  getEventsForDate,
  findUpcomingEvents,
  ECLIPSES,
};

// ============================================================
// OPEN_QUESTIONS
//
// 1. Именованные праздники — сделан вариант (б): статическая таблица на
//    2026 год (реальные даты из открытых источников). Нужно продлевать на
//    2027+ вручную. Джанмаштами дана по Смарта-традиции (4 сентября),
//    ISKCON/вайшнавы отмечают на день позже — если для тебя актуальна
//    именно вторая дата, скажи, поменяю.
//    Вариант (а) — расчёт лунного месяца (масы) для точного вычисления
//    вместо таблицы — по-прежнему не сделан, если понадобится в будущем.
//
// 2. Таблица затмений (ECLIPSES) сейчас захардкожена на 2026-2027 —
//    реальные даты из открытых источников. Её нужно будет продлевать
//    на 2028+ вручную по мере необходимости — окей ли такой подход,
//    или нужен способ считать это точнее внутри движка?
//
// 3. «Особый день» (EVENT_TYPES.SPECIAL) — тип существует в архитектуре,
//    но пока ничего в него не попадает. Что должно им считаться —
//    что-то из натальной персонализации (не общий календарь), или это
//    просто резерв под будущее?
// ============================================================
