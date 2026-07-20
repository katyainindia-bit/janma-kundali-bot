// ============================================================
// world-geocoding.js — поиск координат города по названию (весь мир,
// через открытый сервис OpenStreetMap/Nominatim) и определение
// исторически верного часового пояса на дату через встроенную в Node
// базу IANA/tz (та же, что использует большинство операционных систем
// и браузеров — включает историю переходов на летнее время всех стран).
// ============================================================

const tzlookup = require('tz-lookup');

const USER_AGENT = 'JanmaKundaliBot/1.0 (https://t.me/janma_kundali_bot)';

/**
 * Ищет город по названию через Nominatim (OpenStreetMap).
 * Возвращает { lat, lon, displayName } либо null, если не нашлось.
 */
async function geocodeCity(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ru`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const place = data[0];
    return {
      lat: parseFloat(place.lat),
      lon: parseFloat(place.lon),
      displayName: place.display_name,
    };
  } catch (e) {
    console.error('Ошибка геокодирования:', e.message);
    return null;
  }
}

/**
 * Смещение UTC (в часах) для IANA-таймзоны на конкретную дату —
 * через встроенный в Node/ICU механизм Intl, который уже содержит
 * полную историю переходов на летнее время для всех стран.
 */
function getOffsetHours(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUTC - date.getTime()) / 3600000;
}

/**
 * Полный поиск: город (любая страна) → координаты + исторически верный
 * часовой пояс на заданную дату.
 * @param {string} cityName
 * @param {Date} approxDateUTC - примерная дата (для определения сезона/DST)
 */
async function resolveWorldCity(cityName, approxDateUTC) {
  const geo = await geocodeCity(cityName);
  if (!geo) return null;
  const timezone = tzlookup(geo.lat, geo.lon);
  const utcOffset = getOffsetHours(timezone, approxDateUTC);
  return {
    city: geo.displayName,
    lat: geo.lat,
    lon: geo.lon,
    utcOffset,
    timezone,
  };
}

module.exports = { geocodeCity, getOffsetHours, resolveWorldCity };
