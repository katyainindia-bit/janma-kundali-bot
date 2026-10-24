// ============================================================
// tajika-yogas.js — йоги годовой карты (Таджика) по таблице и лекции Katya Das.
// Раху и Кету не участвуют. Дриштхи: оси 1/7, 4/10, 3/11, 5/9 (сидение в одном знаке = 1).
// ============================================================
const pmod = (x, y) => ((x % y) + y) % y;
const SPEED = ['Луна', 'Меркурий', 'Венера', 'Солнце', 'Марс', 'Юпитер', 'Сатурн']; // от быстрой к медленной
const DIPT = { Луна: 12, Солнце: 15, Меркурий: 7, Марс: 8, Юпитер: 9, Венера: 7, Сатурн: 9 };
const COMBUST = { Луна: 12, Марс: 17, Меркурий: 14, Юпитер: 11, Венера: 10, Сатурн: 15 };
const DEBIL = { Солнце: 6, Луна: 7, Марс: 3, Меркурий: 11, Юпитер: 9, Венера: 5, Сатурн: 0 };
const DUSTHANA = [6, 8, 12];
const MITRA_AXES = [3, 5, 9, 11], SHATRU_AXES = [4, 7, 10];
const DRISHTI = [1, 3, 4, 5, 7, 9, 10, 11];
const FRIENDS = { Солнце: ['Луна','Марс','Юпитер'], Луна: ['Солнце','Меркурий'], Марс: ['Солнце','Луна','Юпитер'], Меркурий: ['Солнце','Венера'], Юпитер: ['Солнце','Луна','Марс'], Венера: ['Меркурий','Сатурн'], Сатурн: ['Меркурий','Венера'] };
const ENEMIES = { Солнце: ['Венера','Сатурн'], Луна: [], Марс: ['Меркурий'], Меркурий: ['Луна'], Юпитер: ['Меркурий','Венера'], Венера: ['Солнце','Луна'], Сатурн: ['Солнце','Луна','Марс'] };

const TEXT = {
  vartama: ['Вартама итхасала', 'Классическая итхасала', 'Результат ожидается, в зависимости от качества йог'],
  rashyanta: ['Рашьянта', 'Быстрый граха находится в 29° и готовится перейти в следующий знак, а оттуда делает итхасала йогу', 'Результат ожидается, в зависимости от качества йог'],
  purna: ['Пурна итхасала', 'Итхасала в 1° между грахами', 'Максимальный результат'],
  ishrafa: ['Ишрафа', 'Быстрый граха уходит от медленного', 'Результата нет'],
  nakta: ['Накта', 'Быстрый граха даёт аспект на грахи в потенциальной итхасала, у которых нет аспекта', 'Результат произойдёт с посторонней помощью'],
  yamaya: ['Ямайя', 'Медленный граха даёт аспект на грахи в потенциальной итхасала, у которых нет аспекта', 'Произойдёт с посторонней помощью, медленнее и сложнее'],
  manau: ['Манау йога', 'Аспект Мангала или Шани', 'Может усложнять, ускорять или давать непредсказуемые результаты, в зависимости от качества грах'],
  kamboola: ['Камбула', 'Есть итхасала и соединение с сильным Чандрой одного из грах', 'Ускорение события Чандрой и усиление результата. Результаты превзойдут ожидания, при шатру дриштхи могут быть небольшие осложнения'],
  gairi: ['Гаири камбула', 'Камбула йога через Рашьянта', 'Улучшение и усиление результата'],
  khallasara: ['Кхалласара', 'В Варшапхала слабый Чандра', 'Нет вкуса от результата'],
  rudda: ['Рудда', 'Граха ретро, слабый, сожжён, в дустхане', 'Результаты могут раскрываться через проблемы'],
  duphalli: ['Дупхалли-кутта', 'Быстрый граха слабее медленного, медленный очень силён', 'Медленный граха усиливает слабого и даёт хорошие результаты'],
  duttotta: ['Дутхотта вира', 'Грахи слабы (не важно, есть итхасала или нет, но должны подходить по градусам) и один из них в итхасала с другой сильной грахой', 'Реализация через дополнительную помощь'],
  tambira: ['Тамбира', 'Итхасалы нет, но есть Рашьянта у одной грахи, и она начинает образовывать итхасалу с двумя грахами, а одна из них сильнейшая', 'Реализация событий с помощью другого'],
  kutta: ['Кутта', 'Грахи в кендрах или панапхара, в хороших аспектах', 'Благоприятное соединение'],
  durpaha: ['Дурпаха', 'Грахи в дустханах, сожжены и слабы', 'Препятствия'],
};

function analyze(chart, pvbMap) {
  const P = {};
  const sunLon = chart.planets['Солнце'].siderealLon;
  for (const n of SPEED) {
    const p = chart.planets[n];
    const sign = p.sign.index, deg = p.siderealLon % 30;
    const combust = n !== 'Солнце' && Math.abs(((p.siderealLon - sunLon + 540) % 360) - 180) <= COMBUST[n] ? true : (n !== 'Солнце' && Math.min(pmod(p.siderealLon - sunLon, 360), pmod(sunLon - p.siderealLon, 360)) <= COMBUST[n]);
    const pvb = pvbMap[n] || 0;
    const weakFlags = [];
    if (DUSTHANA.includes(p.house)) weakFlags.push('в дустхане');
    if (sign === DEBIL[n]) weakFlags.push('в падении');
    if (combust) weakFlags.push('сожжён');
    if (pvb <= 7) weakFlags.push('слабая ПВБ');
    P[n] = { name: n, sign, deg, house: p.house, retro: !!p.retrograde, combust, pvb, weak: weakFlags.length > 0, weakFlags, strong: weakFlags.length === 0 && pvb >= 10, retroFlag: !!p.retrograde };
  }
  return P;
}
const dist = (a, b) => pmod(b.sign - a.sign, 12) + 1; // дом знака b от знака a
const hasDrishti = (a, b) => DRISHTI.includes(dist(a, b)) && DRISHTI.includes(dist(b, a));
const axisKind = (a, b) => {
  const d = dist(a, b);
  if (MITRA_AXES.includes(d)) return 'митра';
  if (SHATRU_AXES.includes(d)) return 'шатру';
  if (d === 1) return FRIENDS[a.name].includes(b.name) ? 'митра' : ENEMIES[a.name].includes(b.name) ? 'шатру' : 'нейтрально';
  return null;
};

function computeTajikaYogas(chart, pvbMap) {
  const P = analyze(chart, pvbMap);
  const names = SPEED;
  const out = [];
  const add = (key, planets, extra) => out.push({ key, name: TEXT[key][0], how: TEXT[key][1], result: TEXT[key][2], planets, ...(extra || {}) });
  const ith = []; // найденные итхасалы {f, s, diff, kind, purna}
  const orb = (a, b) => (DIPT[a] + DIPT[b]) / 2;

  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const f = P[names[i]], s = P[names[j]]; // f — быстрее
    if (!hasDrishti(f, s)) continue;
    const diff = Math.abs(f.deg - s.deg), o = orb(f.name, s.name);
    const approaching = f.retro ? f.deg > s.deg : f.deg < s.deg;
    const kind = axisKind(f, s);
    if (diff < 1) { ith.push({ f, s, diff, kind, purna: true }); continue; }
    if (diff > o) continue;
    if (approaching) ith.push({ f, s, diff, kind, purna: false });
    else add('ishrafa', [f.name, s.name], { diff, kind });
  }
  for (const y of ith) {
    add(y.purna ? 'purna' : 'vartama', [y.f.name, y.s.name], { diff: y.diff, kind: y.kind });
  }
  const hasIth = (a, b) => ith.some(y => (y.f.name === a && y.s.name === b) || (y.f.name === b && y.s.name === a));

  // Рашьянта: быстрый в 29°+, из следующего знака даёт итхасалу
  const rash = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const f = P[names[i]], s = P[names[j]];
    if (f.deg < 29 || f.retro || hasIth(f.name, s.name)) continue;
    const nextSign = (f.sign + 1) % 12;
    const d1 = pmod(s.sign - nextSign, 12) + 1, d2 = pmod(nextSign - s.sign, 12) + 1;
    if (DRISHTI.includes(d1) && DRISHTI.includes(d2) && s.deg <= orb(f.name, s.name)) { rash.push({ f, s }); add('rashyanta', [f.name, s.name], { diff: s.deg + (30 - f.deg) }); }
  }

  // Накта / Ямайя: потенциальная итхасала без аспекта, посредник даёт аспект обоим
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const f = P[names[i]], s = P[names[j]];
    if (hasDrishti(f, s)) continue;
    const diff = Math.abs(f.deg - s.deg);
    if (diff > orb(f.name, s.name) || !(f.retro ? f.deg > s.deg : f.deg < s.deg)) continue;
    for (const t of names) {
      if (t === f.name || t === s.name) continue;
      const T = P[t];
      if (!hasDrishti(T, f) || !hasDrishti(T, s)) continue;
      const ti = SPEED.indexOf(t);
      if (ti < SPEED.indexOf(f.name)) add('nakta', [f.name, s.name, t], { diff });
      else if (ti > SPEED.indexOf(s.name)) add('yamaya', [f.name, s.name, t], { diff });
    }
  }

  // Манау: Марс или Шани аспектируют обе планеты итхасалы
  for (const y of ith) for (const m of ['Марс', 'Сатурн']) {
    if (m === y.f.name || m === y.s.name) continue;
    if (hasDrishti(P[m], y.f) && hasDrishti(P[m], y.s)) add('manau', [y.f.name, y.s.name, m]);
  }

  // Камбула / Гаири камбула
  const moon = P['Луна'];
  if (moon.strong) for (const y of ith) {
    if (y.f.name === 'Луна' || y.s.name === 'Луна') continue;
    if (moon.sign === y.f.sign || moon.sign === y.s.sign) add('kamboola', [y.f.name, y.s.name, 'Луна']);
    else if (moon.deg >= 29 && ((moon.sign + 1) % 12 === y.f.sign || (moon.sign + 1) % 12 === y.s.sign)) add('gairi', [y.f.name, y.s.name, 'Луна']);
  }
  // Кхалласара
  if (moon.weak) add('khallasara', ['Луна'], { flags: moon.weakFlags });

  // Рудда: планеты итхасал, которые ретро / слабы / сожжены / в дустхане
  const inIth = new Set(); ith.forEach(y => { inIth.add(y.f.name); inIth.add(y.s.name); });
  for (const n of inIth) { const p = P[n]; const fl = [...(p.retro ? ['ретроградна'] : []), ...p.weakFlags]; if (fl.length) add('rudda', [n], { flags: fl }); }

  // Дупхалли-кутта: быстрый слабее медленного, медленный очень силён
  for (const y of ith) if (y.f.pvb < y.s.pvb && y.s.pvb >= 12) add('duphalli', [y.f.name, y.s.name]);

  // Дутхотта вира: две слабые грахи подходят по градусам, и одна в итхасала с сильной
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = P[names[i]], b = P[names[j]];
    if (!a.weak || !b.weak || Math.abs(a.deg - b.deg) > orb(a.name, b.name)) continue;
    for (const c of names) {
      if (c === a.name || c === b.name || !P[c].strong) continue;
      if (hasIth(a.name, c)) add('duttotta', [a.name, b.name, c]);
      else if (hasIth(b.name, c)) add('duttotta', [b.name, a.name, c]);
    }
  }

  // Тамбира: итхасалы нет, у одной грахи рашьянта, она начинает итхасалу с двумя, одна из них сильнейшая
  const byFast = {};
  rash.forEach(r => { (byFast[r.f.name] = byFast[r.f.name] || []).push(r.s); });
  for (const [fn, list] of Object.entries(byFast)) if (list.length >= 2 && list.some(p => p.strong)) add('tambira', [fn, ...list.map(p => p.name)]);

  // Кутта: итхасала в митра-дриштхи, обе грахи в кендрах/панапхара
  const KP = [1, 2, 4, 5, 7, 8, 10, 11];
  for (const y of ith) if (y.kind === 'митра' && KP.includes(y.f.house) && KP.includes(y.s.house)) add('kutta', [y.f.name, y.s.name]);

  // Дурпаха: итхасала двух слабых грах (дустхана, сожжены, слабы)
  for (const y of ith) if (y.f.weak && y.s.weak) add('durpaha', [y.f.name, y.s.name]);

  return out;
}
module.exports = { computeTajikaYogas };
