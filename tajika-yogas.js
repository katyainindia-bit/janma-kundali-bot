// ============================================================
// tajika-yogas.js — йоги годовой карты (Таджика) по «Таджика Нилаканthi».
// Йоги считаются между Лагнешем (управитель Варша-лагны) и Карьешем (управитель дома,
// о котором вопрос). Раху и Кету не участвуют (кроме Иккавала / Индувара — по всем грахам).
// Орб итхасалы — дипт-амши быстрой планеты (книга, стр. 43). Аспекты: оси 1/7, 4/10, 3/11, 5/9;
// 2/6/8/12 — нет аспекта.
// Не считаем (в книге не прочитаны/неоднозначны): Кутта, Дурупха, «будущая» итхасала (бхавишьят).
// ============================================================
const pmod = (x, y) => ((x % y) + y) % y;
const SPEED = ['Луна', 'Меркурий', 'Венера', 'Солнце', 'Марс', 'Юпитер', 'Сатурн']; // от быстрой к медленной
const DIPT = { Луна: 12, Солнце: 15, Меркурий: 7, Марс: 8, Юпитер: 9, Венера: 7, Сатурн: 9 };
const COMBUST = { Луна: 12, Марс: 17, Меркурий: 14, Юпитер: 11, Венера: 10, Сатурн: 15 };
const ASPECT = [1, 3, 4, 5, 7, 9, 10, 11];
const SHATRU = [1, 4, 7, 10]; // «тулья дришти» — враждебные оси и один знак
const HOUSE_THEME = { 2: 'деньги', 3: 'братья и сёстры, инициатива', 4: 'дом, покой, счастье', 5: 'дети, творчество', 6: 'здоровье, болезни, враги', 7: 'партнёрство, брак', 8: 'кризисы, потери', 9: 'удача, судьба', 10: 'карьера, положение', 11: 'прибыль, исполнение желаний', 12: 'расходы, больницы, заточение' };
const KARYA_HOUSES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const TEXT = {
  ikkavala: ['Иккавала', 'Все грахи в кендрах и панапхарах, ни одной в апоклимах', 'Царское положение, счастье; гасит аришта-йоги'],
  induvara: ['Индувара', 'Все грахи в апоклимах (3, 6, 9, 12), ни одной в кендрах и панапхарах', 'Нежелательный результат'],
  vartama: ['Итхасала', 'Быстрый граха позади медленного, между ними есть аспект, они в орбе (дипт-амши быстрого)', 'Дело сбывается'],
  purna: ['Пурна итхасала', 'Быстрый и медленный граха на одном градусе, различие в минутах', 'Полный результат'],
  rashyanta: ['Рашьянта', 'Быстрый граха на 29° и из следующего знака даёт итхасалу медленному', 'Дело сбывается, чуть позже'],
  ishrafa: ['Ишрафа', 'Быстрый граха ушёл вперёд медленного (не менее чем на 1°)', 'Дело разрушается, или результат уже прошёл'],
  nakta: ['Накта', 'У Лагнеша и Карьеша нет аспекта. Третий граха быстрее обоих аспектирует их, берёт силу у заднего и передаёт переднему', 'Дело сбывается через постороннего человека'],
  yamaya: ['Ямайя', 'У Лагнеша и Карьеша нет аспекта. Третий граха медленнее обоих аспектирует их и передаёт силу от быстрого к медленному', 'Дело сбывается через постороннего, медленнее и тяжелее'],
  manau: ['Манау', 'Есть итхасала, а рядом с одним из грах (в его дипт-амши) стоит Марс или Сатурн в враждебном аспекте или в том же знаке', 'Итхасала разрушается, дело срывается'],
  kamboola: ['Камбула', 'Есть итхасала Лагнеша и Карьеша, и Луна даёт итхасалу одному из них или обоим', 'Усиление результата. Качество зависит от достоинства Луны и грах'],
  gairi: ['Гаири-камбула', 'Луна «пустая» (нет достоинства и аспекта), на последнем градусе знака; при входе в следующий знак даёт итхасалу сильной планете (в своём знаке или экзальтации)', 'Результат через помощь другого человека'],
  khallasara: ['Кхалласара', 'Луна «пустая» и не связана итхасалой или соединением с Лагнешем и Карьешем', 'Разрушает результат Камбулы, неблагоприятно'],
  rudda: ['Рудда', 'Итхасала, где одна из планет сожжена, в падении, в знаке врага или ретроградна', 'Итхасала не даёт результата: слабая планета не может ни взять, ни отдать силу'],
  duphalli: ['Дупхалли-кутта', 'Медленный граха в достоинстве (свой знак, экзальтация, своя хадда, дрекана, навамша), быстрый без достоинства', 'Дело сбывается с трудом'],
  duttotta: ['Дутхотта-вира', 'Лагнеш и Карьеш слабы, но есть итхасала, и быстрый соединён с сильной третьей планетой', 'Дело сбывается через помощь другого'],
  tambira: ['Тамбира', 'Итхасалы нет, одна из планет на 29° и в следующем знаке стоит сильная планета в орбе, связанная с другой планетой пары', 'Дело сбывается'],
};

function makeAnalyzer(chart, H) {
  const sunLon = chart.planets['Солнце'].siderealLon;
  const lagnaSign = chart.ascendant.sign.index;
  const P = {};
  for (const n of SPEED) {
    const p = chart.planets[n];
    const lon = p.siderealLon, sign = Math.floor(lon / 30), deg = lon % 30;
    const signLord = H.LORD[sign];
    const uttama = signLord === n || H.EXALT[n][0] === sign;
    const madhyama = H.haddaRuler(lon) === n || H.drekkanaRuler(lon) === n || H.navamshaLord(lon) === n;
    const debilSign = (H.EXALT[n][0] + 6) % 12;
    const enemySign = H.FRIENDS[n].e.includes(signLord);
    const dignity = uttama ? 'высшее' : madhyama ? 'среднее' : (sign === debilSign || enemySign) ? 'низшее' : 'нет';
    const sep = Math.min(pmod(lon - sunLon, 360), pmod(sunLon - lon, 360));
    const combust = n !== 'Солнце' && sep <= COMBUST[n];
    const weakFlags = [];
    if (combust) weakFlags.push('сожжена');
    if (sign === debilSign) weakFlags.push('в падении');
    else if (enemySign) weakFlags.push('в знаке врага');
    if (p.retrograde) weakFlags.push('ретроградна');
    P[n] = { name: n, sign, deg, lon, house: p.house, retro: !!p.retrograde, dignity, hasDignity: uttama || madhyama, uttama, weakFlags, weak: weakFlags.length > 0 };
  }
  return { P, lagnaSign };
}

const dist = (a, b) => pmod(b.sign - a.sign, 12) + 1;
const hasDrishti = (a, b) => ASPECT.includes(dist(a, b)) && ASPECT.includes(dist(b, a));
const axisKind = (a, b) => { const d = dist(a, b); return [3, 5, 9, 11].includes(d) ? 'митра' : [4, 7, 10].includes(d) ? 'шатру' : 'один знак'; };
const fastFirst = (a, b) => (SPEED.indexOf(a.name) <= SPEED.indexOf(b.name) ? [a, b] : [b, a]);

/** Итхасала/ишрафа между быстрым f и медленным s. Возвращает null или {type, diff}. */
function pairState(f, s) {
  if (!hasDrishti(f, s)) return null;
  const orb = DIPT[f.name];
  const delta = f.retro ? f.deg - s.deg : s.deg - f.deg; // >0: быстрый позади (идёт к медленному)
  const diff = Math.abs(f.deg - s.deg);
  if (diff < 1 && diff <= orb) return { type: 'purna', diff, kind: axisKind(f, s) };
  if (diff > orb) return null;
  return { type: delta > 0 ? 'vartama' : 'ishrafa', diff, kind: axisKind(f, s) };
}

function computeTajikaYogas(chart, pvbMap, H) {
  if (!H) return [];
  const { P, lagnaSign } = makeAnalyzer(chart, H);
  const out = [];
  const add = (key, planets, extra) => out.push({ key, name: TEXT[key][0], how: TEXT[key][1], result: TEXT[key][2], planets, ...(extra || {}) });
  const lagnesh = H.LORD[lagnaSign];
  const L = P[lagnesh];

  // Иккавала / Индувара — по всем грахам
  const houses = SPEED.map(n => P[n].house);
  const kp = [1, 2, 4, 5, 7, 8, 10, 11], ap = [3, 6, 9, 12];
  if (houses.every(h => kp.includes(h))) add('ikkavala', []);
  else if (houses.every(h => ap.includes(h))) add('induvara', []);

  // Карьеши: по домам
  const byPair = {}; // 'Лагнеш|Карьеш' -> {K, houses[]}
  for (const h of KARYA_HOUSES) {
    const kn = H.LORD[(lagnaSign + h - 1) % 12];
    if (kn === lagnesh) continue;
    (byPair[kn] = byPair[kn] || { K: P[kn], houses: [] }).houses.push(h);
  }

  const moon = P['Луна'];
  const moonVoid = () => !moon.hasDignity && moon.dignity !== 'низшее' &&
    !SPEED.some(n => n !== 'Луна' && hasDrishti(P[n], moon) && Math.abs(P[n].deg - moon.deg) <= DIPT['Луна']);
  const enemyAspect = (m, x) => SHATRU.includes(dist(m, x)) && Math.abs(m.deg - x.deg) <= DIPT[x.name];

  for (const { K, houses: hs } of Object.values(byPair)) {
    const [f, s] = fastFirst(L, K);
    const label = 'Лагнеш ' + lagnesh + ' и Карьеш ' + K.name + ' (' + hs.map(h => h + '-й дом').join(', ') + ')';
    const themes = hs.map(h => h + '-й: ' + HOUSE_THEME[h]).join('; ');
    const ctx = { label, houses: hs, themes };
    const st = pairState(f, s);
    let ith = null;

    if (st && (st.type === 'vartama' || st.type === 'purna')) {
      ith = st;
      add(st.type, [f.name, s.name], { ...ctx, diff: st.diff, kind: st.kind });
    } else if (st && st.type === 'ishrafa') {
      add('ishrafa', [f.name, s.name], { ...ctx, diff: st.diff, kind: st.kind });
    }

    // Рашьянта: быстрый на 29°+ идёт в следующий знак и там даёт итхасалу
    let rashyanta = false;
    if (!ith && !st && f.deg >= 29 && !f.retro) {
      const nextSign = (f.sign + 1) % 12;
      const d1 = pmod(s.sign - nextSign, 12) + 1, d2 = pmod(nextSign - s.sign, 12) + 1;
      if (ASPECT.includes(d1) && ASPECT.includes(d2) && s.deg <= DIPT[f.name]) {
        rashyanta = true;
        add('rashyanta', [f.name, s.name], { ...ctx, diff: s.deg + (30 - f.deg) });
      }
    }

    // Накта / Ямайя: аспекта между Лагнешем и Карьешем нет, но по градусам они бы сошлись
    if (!hasDrishti(f, s) && (f.retro ? f.deg > s.deg : f.deg < s.deg) && Math.abs(s.deg - f.deg) <= DIPT[f.name]) {
      for (const tn of SPEED) {
        if (tn === f.name || tn === s.name) continue;
        const T = P[tn];
        if (!hasDrishti(T, f) || !hasDrishti(T, s)) continue;
        const ti = SPEED.indexOf(tn);
        if (ti < SPEED.indexOf(f.name) && T.deg < f.deg && (s.deg - T.deg) <= DIPT[tn]) add('nakta', [f.name, s.name, tn], { ...ctx, diff: s.deg - f.deg });
        else if (ti > SPEED.indexOf(s.name) && Math.abs(T.deg - f.deg) <= DIPT[tn] && Math.abs(T.deg - s.deg) <= DIPT[tn]) add('yamaya', [f.name, s.name, tn], { ...ctx, diff: s.deg - f.deg });
      }
    }

    if (ith) {
      // Манау: Марс или Сатурн рядом (в дипт-амши) с одним из двух, в враждебном аспекте или в том же знаке
      for (const mn of ['Марс', 'Сатурн']) {
        if (mn === f.name || mn === s.name) continue;
        const M = P[mn];
        if (enemyAspect(M, f) || enemyAspect(M, s)) add('manau', [f.name, s.name, mn], ctx);
      }
      // Камбула: Луна в итхасале с одним или обоими
      if (f.name !== 'Луна' && s.name !== 'Луна') {
        const withF = pairState(moon, f), withS = pairState(moon, s);
        const ok = [withF, withS].filter(x => x && (x.type === 'vartama' || x.type === 'purna'));
        if (ok.length) {
          add('kamboola', [f.name, s.name, 'Луна'], { ...ctx, moonDignity: moon.dignity, both: ok.length === 2, flags: ['Луна: достоинство ' + moon.dignity + (ok.length === 2 ? ', итхасала с обоими' : '')] });
        } else if (moonVoid() && moon.deg >= 29 && !moon.retro) {
          // Гаири-камбула: Луна идёт в следующий знак к сильной планете и даёт ей итхасалу
          const ns = (moon.sign + 1) % 12;
          for (const qn of SPEED) {
            const Q = P[qn];
            if (qn === 'Луна' || Q.sign !== ns || !Q.uttama || Q.deg > DIPT['Луна']) continue;
            add('gairi', [f.name, s.name, 'Луна', qn], ctx);
          }
        }
      }
      // Рудда: итхасала, где слабая планета
      const wk = [f, s].filter(X => X.weak).map(X => X.name + ': ' + X.weakFlags.join(', '));
      if (wk.length) add('rudda', [f.name, s.name], { ...ctx, flags: wk });
      // Дупхалли-кутта: медленный в достоинстве, быстрый без достоинства
      if (s.hasDignity && !f.hasDignity) add('duphalli', [f.name, s.name], { ...ctx, flags: [s.name + ': достоинство ' + s.dignity] });
      // Дутхотта-вира: оба слабы, быстрый соединён с сильной медленной третьей
      if (f.weak && s.weak) {
        for (const qn of SPEED) {
          if (qn === f.name || qn === s.name) continue;
          const Q = P[qn];
          if (SPEED.indexOf(qn) > SPEED.indexOf(f.name) && Q.hasDignity && Q.sign === f.sign && Math.abs(Q.deg - f.deg) <= DIPT[f.name]) add('duttotta', [f.name, s.name, qn], ctx);
        }
      }
    } else if (!st) {
      // Кхалласара: Луна «пустая» и не связана с Лагнешем и Карьешем
      if (f.name !== 'Луна' && s.name !== 'Луна' && moonVoid()) {
        const linked = [f, s].some(X => pairState(moon, X) || moon.sign === X.sign);
        if (!linked) add('khallasara', ['Луна'], ctx);
      }
      // Тамбира: итхасалы нет, одна из планет на 29°, в следующем знаке сильная планета связана с другой
      for (const [X, Y] of [[f, s], [s, f]]) {
        if (X.deg < 29 || X.retro) continue;
        const ns = (X.sign + 1) % 12;
        for (const qn of SPEED) {
          const Q = P[qn];
          if (qn === X.name || qn === Y.name || Q.sign !== ns || !Q.uttama || Q.deg > DIPT[X.name]) continue;
          if (hasDrishti(Q, Y) && Math.abs(Q.deg - Y.deg) <= DIPT[Q.name]) add('tambira', [X.name, Y.name, qn], ctx);
        }
      }
    }
    void rashyanta;
  }
  return out;
}
module.exports = { computeTajikaYogas };
