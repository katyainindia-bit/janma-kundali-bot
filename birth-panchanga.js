// Панчанга момента рождения. Вара считается по восходу: до восхода идёт вара предыдущих суток.
const { computePanchanga, sunriseSunsetMinutesUTC } = require('./panchanga.js');
const { jdFromDate } = require('./engine.js');

const VARA = ['Равивара (воскресенье, Солнце)', 'Сомавара (понедельник, Луна)', 'Мангалавара (вторник, Марс)', 'Будхавара (среда, Меркурий)', 'Гурувара (четверг, Юпитер)', 'Шукравара (пятница, Венера)', 'Шанивара (суббота, Сатурн)'];
const SUN_ALT = { upper: -0.8333, center: 0, lower: 0.2667 };

function birthPanchanga(year, month, day, hour, minute, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase, opts) {
  const p = computePanchanga(year, month, day, hour, minute, lat, lon, utcOffset, ayanamshaType, customAyanamshaBase);
  let dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  let beforeSunrise = false;
  try {
    const alt = (opts && SUN_ALT[opts.sunrise] != null) ? SUN_ALT[opts.sunrise] : SUN_ALT.upper;
    const t = sunriseSunsetMinutesUTC(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)), lat, lon, alt);
    if (t.sunriseUTC != null) {
      const jdEvent = jdFromDate(year, month, day, hour, minute, 0, utcOffset);
      const jdRise = jdFromDate(year, month, day, 0, 0, 0, 0) + t.sunriseUTC / 1440;
      if (jdEvent < jdRise) { dow = (dow + 6) % 7; beforeSunrise = true; }
    }
  } catch (e) {}
  return {
    vara: VARA[dow], beforeSunrise,
    tithi: p.tithi, yoga: p.yoga, karana: p.karana,
    nakshatra: p.nakshatra && p.nakshatra.name, nakshatraPada: p.nakshatraPada,
    sunrise: p.sunrise, sunset: p.sunset,
  };
}
module.exports = { birthPanchanga };
