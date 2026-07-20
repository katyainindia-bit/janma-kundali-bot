// ============================================================
// ru-timezone.js — историческая база часовых поясов городов России
// (по таблице пользователя) + геокодинг по названию города.
//
// ВАЖНО: для периодов до 1981 года точные даты переходов не всегда
// известны — используется 1 января года начала периода как граница.
// Для периодов 1981–2011 годов (сезонные переводы) используется
// точное правило перехода, действовавшее в конкретном году.
// ============================================================

// --- Правила перехода на летнее/зимнее время по эрам ---
function lastSunday(year, month) {
  // month: 1-12. Возвращает Date (UTC) последнего воскресенья этого месяца.
  const d = new Date(Date.UTC(year, month, 0)); // последний день месяца
  const dow = d.getUTCDay(); // 0=воскресенье
  d.setUTCDate(d.getUTCDate() - dow);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dstTransitions(year) {
  // Возвращает { springForward, fallBack } — даты перехода на летнее/зимнее время в этом году.
  if (year >= 1981 && year <= 1983) {
    return { springForward: new Date(Date.UTC(year, 3, 1)), fallBack: new Date(Date.UTC(year, 9, 1)) };
  }
  if (year === 1984) {
    return { springForward: new Date(Date.UTC(year, 3, 1)), fallBack: lastSunday(year, 9) };
  }
  if (year >= 1985 && year <= 1995) {
    return { springForward: lastSunday(year, 3), fallBack: lastSunday(year, 9) };
  }
  if (year >= 1996 && year <= 2010) {
    return { springForward: lastSunday(year, 3), fallBack: lastSunday(year, 10) };
  }
  // За пределами известных сезонных диапазонов — не используется (для fixed-периодов)
  return null;
}

function isSummerTime(date) {
  const year = date.getUTCFullYear();
  const t = dstTransitions(year);
  if (!t) return null;
  return date >= t.springForward && date < t.fallBack;
}

// --- Разрешение смещения для одного периода ---
function resolveOffsetForPeriod(period, date) {
  if (!period.split) return period.offset;
  const summer = isSummerTime(date);
  if (summer === null) {
    // На всякий случай, если год вне известных правил DST — берём зимнее (более безопасное) смещение
    return period.winterOffset;
  }
  return summer ? period.summerOffset : period.winterOffset;
}

function parseBound(str) {
  if (!str) return null;
  return new Date(str + 'T00:00:00Z');
}

/**
 * Находит исторически верное смещение UTC для города (по группе) на заданную дату.
 * @param {object} group - запись из CITY_GROUPS
 * @param {Date} date - дата (UTC) на момент рождения
 * @returns {number|null} смещение в часах, либо null если дата вне известного диапазона
 */
function resolveOffset(group, date) {
  for (const period of group.periods) {
    const from = parseBound(period.from);
    const to = parseBound(period.to); // null = "по настоящее время"
    if (date >= from && (to === null || date < to)) {
      return resolveOffsetForPeriod(period, date);
    }
  }
  return null;
}

// ============================================================
// CITY_GROUPS — исторические периоды по группам городов
// (сгруппированы по общей истории часового пояса)
// ============================================================
const CITY_GROUPS = [
  {
    cities: ['Калининград'],
    coords: { 'Калининград': [54.7104, 20.4522] },
    periods: [
      { from: '1946-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1989-01-01', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1989-01-01', to: '1991-09-29', split: true, summerOffset: 3, winterOffset: 2 },
      { from: '1991-09-29', to: '1992-01-19', offset: 1 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 3, winterOffset: 2 },
      { from: '2011-03-27', to: '2014-10-26', offset: 3 },
      { from: '2014-10-26', to: null, offset: 2 },
    ],
  },
  {
    cities: ['Москва','Санкт-Петербург','Псков','Великий Новгород','Смоленск','Мурманск','Петрозаводск','Брянск','Тверь','Орёл','Курск','Калуга','Белгород','Тула'],
    coords: {
      'Москва': [55.7558, 37.6173], 'Санкт-Петербург': [59.9311, 30.3609], 'Псков': [57.8194, 28.3319],
      'Великий Новгород': [58.5215, 31.2755], 'Смоленск': [54.7826, 32.0453], 'Мурманск': [68.9585, 33.0827],
      'Петрозаводск': [61.7849, 34.3469], 'Брянск': [53.2434, 34.3636], 'Тверь': [56.8587, 35.9176],
      'Орёл': [52.9703, 36.0635], 'Курск': [51.7373, 36.1874], 'Калуга': [54.5293, 36.2754],
      'Белгород': [50.5977, 36.5858], 'Тула': [54.1961, 37.6182],
    },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Воронеж','Липецк','Рязань','Ростов-на-Дону','Владимир','Кострома','Иваново'],
    coords: {
      'Воронеж': [51.6720, 39.1843], 'Липецк': [52.6031, 39.5708], 'Рязань': [54.6269, 39.6916],
      'Ростов-на-Дону': [47.2357, 39.7015], 'Владимир': [56.1366, 40.3966], 'Кострома': [57.7665, 40.9269],
      'Иваново': [57.0004, 40.9739],
    },
    periods: [
      { from: '1937-01-01', to: '1946-01-01', offset: 4 },
      { from: '1946-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Краснодар','Майкоп','Тамбов','Ставрополь','Черкесск'],
    coords: {
      'Краснодар': [45.0355, 38.9753], 'Майкоп': [44.6098, 40.1006], 'Тамбов': [52.7213, 41.4523],
      'Ставрополь': [45.0428, 41.9734], 'Черкесск': [44.2269, 42.0570],
    },
    periods: [
      { from: '1931-01-01', to: '1946-01-01', offset: 4 },
      { from: '1946-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Севастополь','Симферополь'],
    coords: { 'Севастополь': [44.6054, 33.5220], 'Симферополь': [44.9521, 34.1024] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-01-01', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-01-01', to: '1994-01-01', split: true, summerOffset: 3, winterOffset: 2 },
      { from: '1994-01-01', to: '1996-01-01', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1996-01-01', to: '2014-03-30', split: true, summerOffset: 3, winterOffset: 2 },
      { from: '2014-03-30', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Ярославль'],
    coords: { 'Ярославль': [57.6261, 39.8845] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Вологда','Архангельск'],
    coords: { 'Вологда': [59.2181, 39.8886], 'Архангельск': [64.5401, 40.5433] },
    periods: [
      { from: '1931-01-01', to: '1946-01-01', offset: 3 },
      { from: '1946-01-01', to: '1961-01-01', offset: 4 },
      { from: '1961-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Нальчик','Владикавказ','Пенза','Йошкар-Ола'],
    coords: {
      'Нальчик': [43.4849, 43.6132], 'Владикавказ': [43.0241, 44.6819],
      'Пенза': [53.2273, 45.0048], 'Йошкар-Ола': [56.6344, 47.8999],
    },
    periods: [
      { from: '1931-01-01', to: '1961-01-01', offset: 4 },
      { from: '1961-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Нижний Новгород','Элиста','Магас','Саранск','Махачкала'],
    coords: {
      'Нижний Новгород': [56.2965, 43.9361], 'Элиста': [46.3155, 44.2560], 'Магас': [43.1652, 44.8109],
      'Саранск': [54.1838, 45.1749], 'Махачкала': [42.9849, 47.5047],
    },
    periods: [
      { from: '1931-01-01', to: '1968-01-01', offset: 4 },
      { from: '1968-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Волгоград'],
    coords: { 'Волгоград': [48.7080, 44.5133] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1988-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1988-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Саратов'],
    coords: { 'Саратов': [51.5924, 46.0348] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1988-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1988-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: '2016-12-04', offset: 3 },
      { from: '2016-12-04', to: null, offset: 4 },
    ],
  },
  {
    cities: ['Грозный'],
    coords: { 'Грозный': [43.3178, 45.6949] },
    periods: [
      { from: '1931-01-01', to: '1968-01-01', offset: 4 },
      { from: '1968-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Астрахань','Ульяновск'],
    coords: { 'Астрахань': [46.3497, 48.0408], 'Ульяновск': [54.3142, 48.4031] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1989-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1989-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: '2016-12-04', offset: 3 },
      { from: '2016-12-04', to: null, offset: 4 },
    ],
  },
  {
    cities: ['Казань'],
    coords: { 'Казань': [55.7887, 49.1221] },
    periods: [
      { from: '1931-01-01', to: '1961-01-01', offset: 4 },
      { from: '1961-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Киров'],
    coords: { 'Киров': [58.6035, 49.6679] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1989-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1989-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Самара'],
    coords: { 'Самара': [53.2001, 50.1500] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1989-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1989-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2010-03-28', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '2010-03-28', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: null, offset: 4 },
    ],
  },
  {
    cities: ['Сыктывкар'],
    coords: { 'Сыктывкар': [61.6685, 50.8365] },
    periods: [
      { from: '1931-01-01', to: '1977-01-01', offset: 4 },
      { from: '1977-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1984-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1984-01-01', to: '1991-09-29', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '1991-09-29', to: '1992-01-19', offset: 2 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Нарьян-Мар'],
    coords: { 'Нарьян-Мар': [67.6387, 53.0068] },
    periods: [
      { from: '1931-01-01', to: '1961-01-01', offset: 5 },
      { from: '1961-01-01', to: '1968-01-01', offset: 3 },
      { from: '1968-01-01', to: '1977-01-01', offset: 4 },
      { from: '1977-01-01', to: '1981-01-01', offset: 3 },
      { from: '1981-01-01', to: '1984-01-01', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1984-01-01', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: '2014-10-26', offset: 4 },
      { from: '2014-10-26', to: null, offset: 3 },
    ],
  },
  {
    cities: ['Ижевск'],
    coords: { 'Ижевск': [56.8526, 53.2045] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 4 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '1991-09-29', to: '1992-01-19', offset: 3 },
      { from: '1992-01-19', to: '2010-03-28', split: true, summerOffset: 5, winterOffset: 4 },
      { from: '2010-03-28', to: '2011-03-27', split: true, summerOffset: 4, winterOffset: 3 },
      { from: '2011-03-27', to: null, offset: 4 },
    ],
  },
  {
    cities: ['Оренбург','Уфа','Пермь','Екатеринбург','Челябинск','Курган'],
    coords: {
      'Оренбург': [51.7727, 55.0988], 'Уфа': [54.7388, 55.9721], 'Пермь': [58.0105, 56.2502],
      'Екатеринбург': [56.8389, 60.6057], 'Челябинск': [55.1644, 61.4368], 'Курган': [55.4500, 65.3333],
    },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 5 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '1991-09-29', to: '1992-01-19', offset: 4 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '2011-03-27', to: '2014-10-26', offset: 6 },
      { from: '2014-10-26', to: null, offset: 5 },
    ],
  },
  {
    cities: ['Тюмень'],
    coords: { 'Тюмень': [57.1522, 65.5272] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 5 },
      { from: '1981-01-01', to: '1982-01-01', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '1982-01-01', to: '1991-09-29', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '1991-09-29', to: '1992-01-19', offset: 4 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '2011-03-27', to: '2014-10-26', offset: 6 },
      { from: '2014-10-26', to: null, offset: 5 },
    ],
  },
  {
    cities: ['Салехард','Ханты-Мансийск'],
    coords: { 'Салехард': [66.5299, 66.6019], 'Ханты-Мансийск': [61.0042, 69.0019] },
    periods: [
      { from: '1931-01-01', to: '1961-01-01', offset: 6 },
      { from: '1961-01-01', to: '1981-01-01', offset: 5 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '1991-09-29', to: '1992-01-19', offset: 4 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 6, winterOffset: 5 },
      { from: '2011-03-27', to: '2014-10-26', offset: 6 },
      { from: '2014-10-26', to: null, offset: 5 },
    ],
  },
  {
    cities: ['Омск'],
    coords: { 'Омск': [54.9885, 73.3242] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 6 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '1991-09-29', to: '1992-01-19', offset: 5 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '2011-03-27', to: '2014-10-26', offset: 7 },
      { from: '2014-10-26', to: null, offset: 6 },
    ],
  },
  {
    cities: ['Новосибирск'],
    coords: { 'Новосибирск': [55.0084, 82.9357] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 7 },
      { from: '1981-01-01', to: '1993-05-23', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '1993-05-23', to: '2011-03-27', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '2011-03-27', to: '2014-10-26', offset: 7 },
      { from: '2014-10-26', to: '2016-07-24', offset: 6 },
      { from: '2016-07-24', to: null, offset: 7 },
    ],
  },
  {
    cities: ['Барнаул','Горно-Алтайск'],
    coords: { 'Барнаул': [53.3606, 83.7636], 'Горно-Алтайск': [51.9581, 85.9603] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 7 },
      { from: '1981-01-01', to: '1995-05-28', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '1995-05-28', to: '2011-03-27', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '2011-03-27', to: '2014-10-26', offset: 7 },
      { from: '2014-10-26', to: '2016-07-24', offset: 6 },
      { from: '2016-07-24', to: null, offset: 7 },
    ],
  },
  {
    cities: ['Томск'],
    coords: { 'Томск': [56.4977, 84.9744] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 7 },
      { from: '1981-01-01', to: '2002-05-01', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '2002-05-01', to: '2011-03-27', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '2011-03-27', to: '2014-10-26', offset: 7 },
      { from: '2014-10-26', to: '2016-07-24', offset: 6 },
      { from: '2016-07-24', to: null, offset: 7 },
    ],
  },
  {
    cities: ['Кемерово'],
    coords: { 'Кемерово': [55.3331, 86.0833] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 7 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '1991-09-29', to: '1992-01-19', offset: 6 },
      { from: '1992-01-19', to: '2010-03-28', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '2010-03-28', to: '2011-03-27', split: true, summerOffset: 7, winterOffset: 6 },
      { from: '2011-03-27', to: null, offset: 7 },
    ],
  },
  {
    cities: ['Кызыл'],
    coords: { 'Кызыл': [51.7191, 94.4378] },
    periods: [
      { from: '1944-01-01', to: '1981-01-01', offset: 7 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '1991-09-29', to: '1992-01-19', offset: 6 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 8, winterOffset: 7 },
      { from: '2011-03-27', to: '2014-10-26', offset: 8 },
      { from: '2014-10-26', to: null, offset: 7 },
    ],
  },
  {
    cities: ['Иркутск','Улан-Удэ'],
    coords: { 'Иркутск': [52.2871, 104.3050], 'Улан-Удэ': [51.8335, 107.5843] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 8 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 9, winterOffset: 8 },
      { from: '1991-09-29', to: '1992-01-19', offset: 7 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 9, winterOffset: 8 },
      { from: '2011-03-27', to: '2014-10-26', offset: 9 },
      { from: '2014-10-26', to: null, offset: 8 },
    ],
  },
  {
    cities: ['Чита'],
    coords: { 'Чита': [52.0340, 113.4994] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 9 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '1991-09-29', to: '1992-01-19', offset: 8 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '2011-03-27', to: '2014-10-26', offset: 10 },
      { from: '2014-10-26', to: '2016-07-24', offset: 8 },
      { from: '2016-07-24', to: null, offset: 9 },
    ],
  },
  {
    cities: ['Благовещенск'],
    coords: { 'Благовещенск': [50.2907, 127.5272] },
    periods: [
      { from: '1931-01-01', to: '1946-01-01', offset: 10 },
      { from: '1946-01-01', to: '1981-01-01', offset: 9 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '1991-09-29', to: '1992-01-19', offset: 8 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '2011-03-27', to: '2014-10-26', offset: 10 },
      { from: '2014-10-26', to: null, offset: 9 },
    ],
  },
  {
    cities: ['Якутск'],
    coords: { 'Якутск': [62.0281, 129.7325] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 9 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '1991-09-29', to: '1992-01-19', offset: 8 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 10, winterOffset: 9 },
      { from: '2011-03-27', to: '2014-10-26', offset: 10 },
      { from: '2014-10-26', to: null, offset: 9 },
    ],
  },
  {
    cities: ['Владивосток','Биробиджан','Хабаровск'],
    coords: { 'Владивосток': [43.1155, 131.8855], 'Биробиджан': [48.7946, 132.9254], 'Хабаровск': [48.4827, 135.0838] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 10 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 11, winterOffset: 10 },
      { from: '1991-09-29', to: '1992-01-19', offset: 9 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 11, winterOffset: 10 },
      { from: '2011-03-27', to: '2014-10-26', offset: 11 },
      { from: '2014-10-26', to: null, offset: 10 },
    ],
  },
  {
    cities: ['Южно-Сахалинск'],
    coords: { 'Южно-Сахалинск': [46.9591, 142.7381] },
    periods: [
      { from: '1946-01-01', to: '1981-01-01', offset: 11 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '1991-09-29', to: '1992-01-19', offset: 10 },
      { from: '1992-01-19', to: '1997-01-01', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '1997-01-01', to: '2011-03-27', split: true, summerOffset: 11, winterOffset: 10 },
      { from: '2011-03-27', to: '2014-10-26', offset: 11 },
      { from: '2014-10-26', to: '2016-07-24', offset: 10 },
      { from: '2016-07-24', to: null, offset: 11 },
    ],
  },
  {
    cities: ['Магадан'],
    coords: { 'Магадан': [59.5638, 150.8039] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 11 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '1991-09-29', to: '1992-01-19', offset: 10 },
      { from: '1992-01-19', to: '2011-03-27', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '2011-03-27', to: '2014-10-26', offset: 12 },
      { from: '2014-10-26', to: '2016-07-24', offset: 10 },
      { from: '2016-07-24', to: null, offset: 11 },
    ],
  },
  {
    cities: ['Петропавловск-Камчатский'],
    coords: { 'Петропавловск-Камчатский': [53.0195, 158.6486] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 12 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 13, winterOffset: 12 },
      { from: '1991-09-29', to: '1992-01-19', offset: 11 },
      { from: '1992-01-19', to: '2010-03-28', split: true, summerOffset: 13, winterOffset: 12 },
      { from: '2010-03-28', to: '2011-03-27', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '2011-03-27', to: null, offset: 12 },
    ],
  },
  {
    cities: ['Анадырь'],
    coords: { 'Анадырь': [64.7337, 177.5089] },
    periods: [
      { from: '1931-01-01', to: '1981-01-01', offset: 13 },
      { from: '1981-01-01', to: '1991-09-29', split: true, summerOffset: 13, winterOffset: 12 },
      { from: '1991-09-29', to: '1992-01-19', offset: 11 },
      { from: '1992-01-19', to: '2010-03-28', split: true, summerOffset: 13, winterOffset: 12 },
      { from: '2010-03-28', to: '2011-03-27', split: true, summerOffset: 12, winterOffset: 11 },
      { from: '2011-03-27', to: null, offset: 12 },
    ],
  },
];

// --- Геокодинг: поиск города по названию (точное совпадение, регистронезависимое) ---
function normalizeCity(s) {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

function findCity(query) {
  const q = normalizeCity(query);
  for (const group of CITY_GROUPS) {
    for (const city of group.cities) {
      if (normalizeCity(city) === q) {
        return { city, group, coords: group.coords[city] };
      }
    }
  }
  return null;
}

/**
 * Главная функция: найти город и вернуть координаты + исторически верный часовой пояс на дату.
 * @param {string} cityName
 * @param {Date} dateUTC - дата рождения в UTC (для разрешения часового пояса)
 */
function resolveCity(cityName, dateUTC) {
  const found = findCity(cityName);
  if (!found) return null;
  const offset = resolveOffset(found.group, dateUTC);
  return {
    city: found.city,
    lat: found.coords[0],
    lon: found.coords[1],
    utcOffset: offset,
  };
}

module.exports = { CITY_GROUPS, findCity, resolveCity, resolveOffset };
