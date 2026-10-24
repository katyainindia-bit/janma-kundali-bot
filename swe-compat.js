// ============================================================
// swe-compat.js — переходник: пакет "sweph" (Swiss Ephemeris, готовые бинарные
// сборки, не требует компиляции на сервере) под тот интерфейс, который
// использует engine.js (как у старого пакета "swisseph").
// ============================================================
const sweph = require('sweph');
const C = sweph.constants;

function check(r, what) {
  if (!r || (typeof r.flag === 'number' && r.flag < 0)) {
    throw new Error('Swiss Ephemeris: ' + what + ' — ' + (r && r.error ? r.error : 'ошибка'));
  }
  return r;
}

module.exports = {
  SEFLG_MOSEPH: C.SEFLG_MOSEPH, SEFLG_SIDEREAL: C.SEFLG_SIDEREAL, SEFLG_SPEED: C.SEFLG_SPEED,
  SE_SUN: C.SE_SUN, SE_MOON: C.SE_MOON, SE_MERCURY: C.SE_MERCURY, SE_VENUS: C.SE_VENUS,
  SE_MARS: C.SE_MARS, SE_JUPITER: C.SE_JUPITER, SE_SATURN: C.SE_SATURN, SE_MEAN_NODE: C.SE_MEAN_NODE,
  SE_SIDM_LAHIRI: C.SE_SIDM_LAHIRI, SE_SIDM_RAMAN: C.SE_SIDM_RAMAN,
  SE_SIDM_KRISHNAMURTI: C.SE_SIDM_KRISHNAMURTI, SE_SIDM_USER: C.SE_SIDM_USER,

  swe_calc_ut(jd, body, flag) {
    const r = check(sweph.calc_ut(jd, body, flag), 'calc_ut');
    return { longitude: r.data[0], latitude: r.data[1], distance: r.data[2], longitudeSpeed: r.data[3] };
  },
  swe_set_sid_mode(mode, t0, ayanT0) { sweph.set_sid_mode(mode, t0, ayanT0); },
  swe_get_ayanamsa_ut(jd) { return sweph.get_ayanamsa_ut(jd); },
  swe_houses_ex(jd, flag, lat, lon, hsys) {
    const r = check(sweph.houses_ex(jd, flag, lat, lon, hsys), 'houses_ex');
    return { house: r.data.houses, ascendant: r.data.points[0], mc: r.data.points[1] };
  },
};
