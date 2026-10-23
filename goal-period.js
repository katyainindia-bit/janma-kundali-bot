// ============================================================
// goal-period.js — оценка ПЕРИОДА под крупную цель: Даша + Гочара.
//
// Это не оценка момента (мухурта), а оценка того, поддерживает ли
// жизненный период тему цели. Медленные транзиты считаются на дату один
// раз и не «накручиваются» плюсом каждый день.
//
// Схема (рабочая, настраиваемая данными из muhurta-rules.js → period):
//
// ДАША. Для махадаши и антардаши смотрим связь управителя с бхавами цели:
//   сильная — управляет бхавой цели или стоит в ней;
//   слабая  — аспектирует бхаву цели или является караакой цели.
//   Антардаша весит больше махадаши. Если связанная планета для лагны
//   функционально неблагоприятна (управляет только 6/8/12) — оценка
//   снижается на ступень. Сама смена даши плюсом не считается.
//
// ГОЧАРА. Два слоя:
//   1) связь транзитных планет цели с бхавами цели (нахождение/аспект
//      от Лагны). Юпитер = поддержка; Сатурн = активирует тему, но
//      сдерживает (плюсом не считается); остальные — только отметка.
//   2) фон от натальной Луны: Юпитер в 2,5,7,9,11 — поддержка;
//      Сатурн в 3,6,11 — поддержка; Сатурн в 8-м (аштама) и Сади Сати
//      (12,1,2 от Луны) — нагрузка.
//   Баллов с весами нет: простой счёт совпадений → 4 понятных статуса.
// ============================================================

const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { ACTION_RULES } = require('./muhurta-rules.js');

const SIGN_LORDS = ['Марс', 'Венера', 'Меркурий', 'Луна', 'Солнце', 'Меркурий', 'Венера', 'Марс', 'Юпитер', 'Сатурн', 'Сатурн', 'Юпитер'];
// Графа-дришти: на какие дома (считая от своего = 1) смотрит планета
const ASPECTS = { 'Марс': [4, 7, 8], 'Юпитер': [5, 7, 9], 'Сатурн': [3, 7, 10], 'Раху': [5, 7, 9], 'Кету': [5, 7, 9] };
const aspectsOf = (planet) => ASPECTS[planet] || [7];
const houseFrom = (fromHouse, k) => ((fromHouse - 1 + (k - 1)) % 12) + 1;

function houseLord(chart, h) {
  const row = chart.houses.find(x => x.house === h);
  return row ? SIGN_LORDS[row.signIndex] : null;
}
function housesRuledBy(chart, planet) {
  const out = [];
  for (let h = 1; h <= 12; h++) if (houseLord(chart, h) === planet) out.push(h);
  return out;
}
// Функциональная природа планеты для лагны (упрощённая классическая)
function functionalNature(chart, planet) {
  const ruled = housesRuledBy(chart, planet);
  if (!ruled.length) return { key: 'node', text: 'по положению' };
  if (ruled.some(h => [1, 5, 9].includes(h))) return { key: 'good', text: 'функционально благоприятна' };
  if (ruled.every(h => [6, 8, 12].includes(h))) return { key: 'bad', text: 'функционально неблагоприятна' };
  return { key: 'mixed', text: 'смешанная по природе' };
}

// Связь планеты с бхавами цели: 'strong' | 'weak' | null (+ объяснение)
function connection(chart, planet, houses, karakas) {
  const ruled = housesRuledBy(chart, planet).filter(h => houses.includes(h));
  if (ruled.length) return { level: 'strong', text: `управляет ${ruled.join(', ')}-й бхавой цели` };
  const p = chart.planets[planet];
  if (p && houses.includes(p.house)) return { level: 'strong', text: `находится в ${p.house}-й бхаве цели` };
  if (p) {
    const hit = houses.find(h => aspectsOf(planet).some(k => houseFrom(p.house, k) === h));
    if (hit) return { level: 'weak', text: `аспектирует ${hit}-ю бхаву цели` };
  }
  if (karakas.includes(planet)) return { level: 'weak', text: 'является каракой этой цели' };
  return null;
}

function evaluateDasha(chart, birthDateUTC, atDate, period) {
  const mahadashas = computeVimshottariDasha(chart, birthDateUTC);
  const chain = findCurrentDashaChain(mahadashas, atDate);
  if (!chain) return { status: 'nodata', label: 'недостаточно данных', lines: [] };
  const lines = [];
  let score = 0;
  const parts = [['Махадаша', chain.mahadasha, 1.5], ['Антардаша', chain.antardasha, 2]];
  let downgraded = false;
  for (const [name, d, w] of parts) {
    if (!d) continue;
    const c = connection(chart, d.lord, period.dashaHouses, period.dashaKarakas || []);
    const fn = functionalNature(chart, d.lord);
    if (c) {
      score += c.level === 'strong' ? w : w / 2;
      if (fn.key === 'bad' && name === 'Антардаша') downgraded = true;
      lines.push(`${name} ${d.lord}: ${c.text} (${fn.text}).`);
    } else {
      lines.push(`${name} ${d.lord}: прямой связи с бхавами цели нет (${fn.text}).`);
    }
  }
  let level = score >= 2.5 ? 2 : score >= 1 ? 1 : 0;
  if (downgraded && level > 0) { level -= 1; lines.push('Управитель антардаши функционально неблагоприятен для лагны — оценка снижена на ступень.'); }
  const status = level === 2 ? 'supports' : level === 1 ? 'partial' : 'not';
  const label = { supports: 'поддерживает', partial: 'частично', not: 'не поддерживает' }[status];
  return { status, label, lines, mahadasha: chain.mahadasha.lord, antardasha: chain.antardasha ? chain.antardasha.lord : null };
}

function evaluateGochara(chart, atDate, period) {
  const tr = computeCurrentTransits(chart, atDate);
  const moonSign = Math.floor(chart.planets['Луна'].siderealLon / 30) % 12;
  const lines = [];
  let score = 0;
  for (const planet of period.gocharaPlanets) {
    const t = tr.planets[planet];
    if (!t) continue;
    const th = t.transitHouse;
    const occupies = period.gocharaHouses.includes(th);
    const asp = period.gocharaHouses.find(h => aspectsOf(planet).some(k => houseFrom(th, k) === h));
    if (occupies || asp) {
      const how = occupies ? `находится в ${th}-й бхаве цели` : `аспектирует ${asp}-ю бхаву цели`;
      if (planet === 'Юпитер') { score += 1; lines.push(`Юпитер ${how} — поддержка.`); }
      else if (planet === 'Сатурн') lines.push(`Сатурн ${how} — активирует тему, но сдерживает и требует усилий.`);
      else lines.push(`${planet} ${how}.`);
    }
  }
  // Фон от натальной Луны
  const jup = tr.planets['Юпитер'], sat = tr.planets['Сатурн'];
  if (jup) {
    const h = ((jup.sign.index - moonSign + 12) % 12) + 1;
    if ([2, 5, 7, 9, 11].includes(h)) { score += 1; lines.push(`Юпитер в ${h}-м доме от натальной Луны — поддерживающий фон.`); }
  }
  if (sat) {
    const h = ((sat.sign.index - moonSign + 12) % 12) + 1;
    if ([3, 6, 11].includes(h)) { score += 1; lines.push(`Сатурн в ${h}-м доме от натальной Луны — поддерживающий фон.`); }
    else if (h === 8) { score -= 1; lines.push('Сатурн в 8-м от натальной Луны (аштама Шани) — период нагрузки.'); }
    else if ([12, 1, 2].includes(h)) { score -= 1; lines.push('Сади Сати (Сатурн рядом с натальной Луной) — период нагрузки.'); }
  }
  const status = score >= 2 ? 'supports' : score === 1 ? 'partial' : score === 0 ? 'neutral' : 'load';
  const label = { supports: 'поддерживает', partial: 'частично', neutral: 'нейтрально', load: 'нагрузка' }[status];
  if (!lines.length) lines.push('Значимых транзитных связей с этой целью сейчас нет.');
  return { status, label, lines };
}

/** Оценка периода под цель (на дату). null — у цели нет данных периода. */
function evaluateGoalPeriod(chart, birthDateUTC, goalKey, atDate) {
  const rule = ACTION_RULES[goalKey];
  if (!rule || !rule.period) return null;
  const dasha = evaluateDasha(chart, birthDateUTC, atDate, rule.period);
  const gochara = evaluateGochara(chart, atDate, rule.period);
  return { goalKey, dasha, gochara, summary: `Даша: ${dasha.label}. Гочара: ${gochara.label}.` };
}

module.exports = { evaluateGoalPeriod, evaluateDasha, evaluateGochara };
