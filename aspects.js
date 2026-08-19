// ============================================================
// aspects.js — классические ведические аспекты (дришти).
//
// Система домов везде та же, что уже используется в приложении (Whole
// Sign — целые знаки), поэтому аспект считается через расстояние в домах,
// а не в градусах — это и есть корректный классический метод для этой
// системы, а не упрощение.
//
// Правила:
// - У ВСЕХ планет есть универсальный аспект на 7-й дом от себя.
// - Дополнительные (особые) аспекты:
//     Марс     → 4-й и 8-й дом от себя (плюс обычный 7-й)
//     Юпитер   → 5-й и 9-й дом от себя (плюс обычный 7-й)
//     Сатурн   → 3-й и 10-й дом от себя (плюс обычный 7-й)
// - Раху/Кету: сознательно НЕ даю им особых аспектов (только обычный 7-й,
//   как у Солнца/Луны/Меркурия/Венеры) — вопрос спорный между традициями
//   (часть текстов даёт узлам аспекты как у Юпитера или Сатурна), это
//   решение можно пересмотреть, если у тебя другая методика.
// ============================================================

const PLANET_ORDER = ['Солнце', 'Луна', 'Меркурий', 'Венера', 'Марс', 'Юпитер', 'Сатурн', 'Раху', 'Кету'];

const SPECIAL_ASPECTS = {
  'Марс': [4, 8],
  'Юпитер': [5, 9],
  'Сатурн': [3, 10],
};

// "Какой это дом от planetHouse" — расстояние 1..12 (1 = тот же дом/соединение)
function houseDistance(fromHouse, toHouse) {
  return ((toHouse - fromHouse + 12) % 12) + 1;
}

function planetAspectsAtDistance(planetName, distance) {
  if (distance === 7) return true; // универсальный аспект — есть у всех
  const special = SPECIAL_ASPECTS[planetName];
  return !!(special && special.includes(distance));
}

// Аспектирует ли planetName конкретный дом (targetHouse) в этой карте
function planetAspectsHouse(chart, planetName, targetHouse) {
  const p = chart.planets[planetName];
  if (!p) return false;
  const distance = houseDistance(p.house, targetHouse);
  return planetAspectsAtDistance(planetName, distance);
}

// Все планета-к-планете аспекты в карте: [{from, to, houseDiff}, ...]
function computeAspects(chart) {
  const result = [];
  for (const from of PLANET_ORDER) {
    const fromP = chart.planets[from];
    if (!fromP) continue;
    for (const to of PLANET_ORDER) {
      if (from === to) continue;
      const toP = chart.planets[to];
      if (!toP) continue;
      const distance = houseDistance(fromP.house, toP.house);
      if (planetAspectsAtDistance(from, distance)) {
        result.push({ from, to, houseDiff: distance });
      }
    }
  }
  return result;
}

// Взаимный аспект (from аспектирует to И to аспектирует from) — для йог,
// где важна именно обоюдная связь, а не одностороннее воздействие.
function mutualAspects(chart) {
  const all = computeAspects(chart);
  const set = new Set(all.map(a => a.from + '->' + a.to));
  return all.filter(a => set.has(a.to + '->' + a.from));
}

module.exports = { PLANET_ORDER, houseDistance, planetAspectsAtDistance, planetAspectsHouse, computeAspects, mutualAspects };
