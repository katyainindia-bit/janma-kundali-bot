// ============================================================
// Chart SVG renderer — строит SVG-разметку натальной карты
// для отправки как изображение в Telegram-боте.
// ============================================================

const fs = require('fs');
const path = require('path');

// Встраиваем шрифты как base64 прямо в SVG — иначе на сервере без системных
// шрифтов (например, Railway) кириллица рендерится пустыми квадратами.
const FONT_DIR = path.join(__dirname, 'fonts');
function loadFontBase64(filename) {
  return fs.readFileSync(path.join(FONT_DIR, filename)).toString('base64');
}
const FONT_SANS_B64 = loadFontBase64('DejaVuSans.ttf');
const FONT_SANS_BOLD_B64 = loadFontBase64('DejaVuSans-Bold.ttf');
const FONT_SERIF_B64 = loadFontBase64('DejaVuSerif.ttf');
const FONT_SERIF_BOLD_B64 = loadFontBase64('DejaVuSerif-Bold.ttf');

const EMBEDDED_FONTS_STYLE = `<style>
@font-face { font-family: 'JKSans'; src: url(data:font/ttf;base64,${FONT_SANS_B64}) format('truetype'); font-weight: normal; }
@font-face { font-family: 'JKSans'; src: url(data:font/ttf;base64,${FONT_SANS_BOLD_B64}) format('truetype'); font-weight: bold; }
@font-face { font-family: 'JKSerif'; src: url(data:font/ttf;base64,${FONT_SERIF_B64}) format('truetype'); font-weight: normal; }
@font-face { font-family: 'JKSerif'; src: url(data:font/ttf;base64,${FONT_SERIF_BOLD_B64}) format('truetype'); font-weight: bold; }
text { font-family: 'JKSans', 'JKSerif'; }
</style>`;

const PLANET_SYMBOLS = {
  'Солнце': 'Su', 'Луна': 'Mo', 'Меркурий': 'Me', 'Венера': 'Ve', 'Марс': 'Ma',
  'Юпитер': 'Ju', 'Сатурн': 'Sa', 'Раху': 'Ra', 'Кету': 'Ke'
};

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];

// Классическое достоинство планет (для 7 традиционных граха; Раху/Кету оставлены нейтральными,
// т.к. экзальтация узлов трактуется по-разному в разных школах).
const EXALTATION = {'Солнце':0,'Луна':1,'Марс':9,'Меркурий':5,'Юпитер':3,'Венера':11,'Сатурн':6};
const DEBILITATION = {'Солнце':6,'Луна':7,'Марс':3,'Меркурий':11,'Юпитер':9,'Венера':5,'Сатурн':0};
const OWN_SIGNS = {
  'Солнце': [4], 'Луна': [3], 'Марс': [0,7], 'Меркурий': [2,5],
  'Юпитер': [8,11], 'Венера': [1,6], 'Сатурн': [9,10]
};

function dignityOf(name, signIndex) {
  if (EXALTATION[name] === signIndex) return 'exalted';
  if (DEBILITATION[name] === signIndex) return 'debilitated';
  if (OWN_SIGNS[name] && OWN_SIGNS[name].includes(signIndex)) return 'own';
  return 'neutral';
}

const COLORS = {
  exalted: '#4f7a52',      // зелёный — экзальтация
  debilitated: '#b23b2e',  // красный — падение
  own: '#4a6d8c',          // синий — своя обитель
  neutral: '#2a2118',      // обычный цвет — без особого статуса
  ink: '#2a2118',
  inkSoft: '#6b6154',
  gold: '#b8935a',
  parchment: '#f7f2e9',
  parchmentCard: '#fffdf9',
};

function dmsFromDeg(deg) {
  const d = Math.floor(deg);
  const mFull = (deg - d) * 60;
  const m = Math.floor(mFull);
  return d + '°' + String(m).padStart(2, '0') + "'";
}

const VB = 400;
const C = VB / 2;

const HP = {
  1:  [[C,0],[VB*0.75,C*0.5],[C,C],[VB*0.25,C*0.5]],
  2:  [[0,0],[C,0],[VB*0.25,C*0.5]],
  3:  [[0,0],[VB*0.25,C*0.5],[0,C]],
  4:  [[0,C],[VB*0.25,C*0.5],[C,C],[C*0.5,VB*0.75]],
  5:  [[0,C],[C*0.5,VB*0.75],[0,VB]],
  6:  [[0,VB],[C*0.5,VB*0.75],[C,VB]],
  7:  [[C*0.5,VB*0.75],[C,C],[VB*0.75,VB*0.75],[C,VB]],
  8:  [[C,VB],[VB*0.75,VB*0.75],[VB,VB]],
  9:  [[VB,VB],[VB*0.75,VB*0.75],[VB,C]],
  10: [[VB*0.75,VB*0.75],[C,C],[VB*0.75,C*0.5],[VB,C]],
  11: [[VB,C],[VB*0.75,C*0.5],[VB,0]],
  12: [[VB,0],[VB*0.75,C*0.5],[C,0]],
};

function polyCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

// Позиция номера знака: берём вершину дома, ближайшую к общему центру карты,
// и сдвигаем её немного внутрь дома (в сторону центроида), чтобы номера
// соседних домов, делящих одну вершину, не накладывались друг на друга.
function signNumberPosition(poly) {
  let nearest = poly[0], bestDist = Infinity;
  for (const v of poly) {
    const d = (v[0]-C)*(v[0]-C) + (v[1]-C)*(v[1]-C);
    if (d < bestDist) { bestDist = d; nearest = v; }
  }
  const centroid = polyCentroid(poly);
  let dx = centroid[0] - nearest[0], dy = centroid[1] - nearest[1];
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  dx /= len; dy /= len;
  const offset = 30;
  return [nearest[0] + dx*offset, nearest[1] + dy*offset];
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Renders the full chart as a standalone SVG string with header/footer text.
function renderNorthIndianSVG(chart, opts = {}) {
  const { title = 'Натальная карта', subtitle = '', width = 900, chartSize = 640 } = opts;
  const ascSignIdx = chart.ascendant.sign.index;
  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(chart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const order = ['Солнце','Луна','Меркурий','Венера','Марс','Юпитер','Сатурн','Раху','Кету'];
  const headerH = 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + (order.length + 1) * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const scale = chartSize / VB;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">${EMBEDDED_FONTS_STYLE}`;
  svg += `<rect width="${width}" height="${totalH}" fill="${COLORS.parchment}"/>`;

  // Header
  svg += `<text x="${width - 50}" y="38" font-family="JKSerif" font-size="18" font-weight="600" fill="${COLORS.ink}" text-anchor="end">Джанма Кундали</text>`;
  svg += `<text x="${width - 50}" y="58" font-family="JKSans" font-size="12" fill="${COLORS.gold}" text-anchor="end">t.me/janma_kundali_bot</text>`;
  svg += `<text x="${width/2}" y="98" font-family="JKSerif" font-size="30" fill="${COLORS.ink}" text-anchor="middle">${esc(title)}</text>`;
  if (subtitle) {
    svg += `<text x="${width/2}" y="122" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}" text-anchor="middle">${esc(subtitle)}</text>`;
  }

  // Chart group (translated + scaled)
  svg += `<g transform="translate(${chartOffsetX},${chartOffsetY}) scale(${scale})">`;

  // Outer square
  svg += `<polygon points="0,0 ${VB},0 ${VB},${VB} 0,${VB}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  // Diagonals
  svg += `<line x1="0" y1="0" x2="${VB}" y2="${VB}" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  svg += `<line x1="${VB}" y1="0" x2="0" y2="${VB}" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  // Inner diamond
  svg += `<polygon points="${C},0 ${VB},${C} ${C},${VB} 0,${C}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;

  for (let h = 1; h <= 12; h++) {
    const poly = HP[h];
    const [cx, cy] = polyCentroid(poly);
    const signIdx = (ascSignIdx + h - 1) % 12;
    const signNumber = signIdx + 1;

    if (h === 1) {
      // Мягкая золотая заливка ромба Лагны — чтобы дом Асцендента был виден сразу
      const pts = poly.map(p => p.join(',')).join(' ');
      svg += `<polygon points="${pts}" fill="#f9f1de"/>`;
      // Перерисовываем контур поверх заливки, чтобы не потерять линии сетки
      svg += `<polygon points="${pts}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
    }

    // Sign number — near the center-facing vertex, independent of planet count
    const [numX, numY] = signNumberPosition(poly);
    if (h === 1) {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="17" font-weight="600" fill="${COLORS.gold}" text-anchor="middle">${signNumber}</text>`;
      // Чёткий бейдж "ASC" вместо мелкой звёздочки
      svg += `<rect x="${cx - 23}" y="${cy - 46}" width="46" height="20" rx="4" fill="${COLORS.gold}"/>`;
      svg += `<text x="${cx}" y="${cy - 32}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.parchmentCard}" text-anchor="middle">ASC</text>`;
    } else {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="15" fill="${COLORS.inkSoft}" text-anchor="middle">${signNumber}</text>`;
    }

    // Planets — centered exactly at the polygon centroid
    const planetsHere = signPlanets[signIdx] || [];
    const count = planetsHere.length;
    const cols = count > 2 ? 2 : 1;
    const rows = Math.ceil(count / cols);
    const fontSize = count > 3 ? 12 : count > 1 ? 13.5 : 15;
    const colGap = fontSize * 2.6;
    const rowGap = fontSize * 2.9;
    const gridW = (cols - 1) * colGap;
    const gridH = (rows - 1) * rowGap;

    const startX = cx - gridW / 2;
    const startY = cy - gridH / 2;

    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      const dignity = dignityOf(item.name, item.p.sign.index);
      const color = COLORS[dignity];
      svg += `<text x="${px}" y="${py}" font-family="JKSans" font-weight="700" font-size="${fontSize}" fill="${color}" text-anchor="middle" dominant-baseline="central">${PLANET_SYMBOLS[item.name]}</text>`;
    });

    // Degrees below each planet (always shown)
    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      svg += `<text x="${px}" y="${py + fontSize * 1.15}" font-family="JKSans" font-size="9" fill="${COLORS.inkSoft}" text-anchor="middle">${dmsFromDeg(item.p.sign.degInSign)}</text>`;
    });
  }

  svg += `</g>`;

  // Legend for dignity colors
  const legendY = chartOffsetY + chartSize + 26;
  svg += `<circle cx="42" cy="${legendY - 4}" r="5" fill="${COLORS.exalted}"/>`;
  svg += `<text x="54" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">экзальтация</text>`;
  svg += `<circle cx="180" cy="${legendY - 4}" r="5" fill="${COLORS.own}"/>`;
  svg += `<text x="192" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">своя обитель</text>`;
  svg += `<circle cx="320" cy="${legendY - 4}" r="5" fill="${COLORS.debilitated}"/>`;
  svg += `<text x="332" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">падение</text>`;

  // Planet / sign / degree / nakshatra list below the chart
  const listStartY = legendY + 30;
  svg += `<line x1="40" y1="${listStartY - 24}" x2="${width - 40}" y2="${listStartY - 24}" stroke="${COLORS.gold}" stroke-width="1"/>`;
  svg += `<text x="40" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ПЛАНЕТА</text>`;
  svg += `<text x="180" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ЗНАК</text>`;
  svg += `<text x="280" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ГРАДУС</text>`;
  svg += `<text x="400" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">НАКШАТРА</text>`;

  // Строка Лагны (Асцендента) — мягкое выделение, отдельно от 9 планет
  {
    const asc = chart.ascendant;
    const y = listStartY + 14;
    svg += `<rect x="30" y="${y - 18}" width="${width - 60}" height="${listRowH}" fill="#fbf6ec"/>`;
    svg += `<text x="40" y="${y}" font-family="JKSans" font-weight="700" font-size="13" fill="${COLORS.gold}">Лагна</text>`;
    svg += `<text x="180" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${asc.sign.index + 1}. ${esc(asc.sign.name)}</text>`;
    svg += `<text x="280" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}">${dmsFromDeg(asc.sign.degInSign)}</text>`;
    svg += `<text x="400" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(asc.nakshatra.name)} (пада ${asc.nakshatra.pada})</text>`;
  }

  order.forEach((name, i) => {
    const p = chart.planets[name];
    const y = listStartY + (i + 1) * listRowH + 14;
    const dignity = dignityOf(name, p.sign.index);
    const color = COLORS[dignity];
    if (i % 2 === 0) {
      svg += `<rect x="30" y="${y - 18}" width="${width - 60}" height="${listRowH}" fill="${COLORS.parchmentCard}"/>`;
    }
    svg += `<text x="40" y="${y}" font-family="JKSans" font-weight="700" font-size="14" fill="${color}">${PLANET_SYMBOLS[name]}</text>`;
    svg += `<text x="70" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(name)}</text>`;
    svg += `<text x="180" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${p.sign.index + 1}. ${esc(p.sign.name)}</text>`;
    svg += `<text x="280" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}">${dmsFromDeg(p.sign.degInSign)}</text>`;
    svg += `<text x="400" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(p.nakshatra.name)} (пада ${p.nakshatra.pada})</text>`;
  });

  svg += `</svg>`;
  return svg;
}

// Транзитный маркер — единый цвет для всех транзитных планет (не зависит от достоинства),
// чтобы визуально сразу отличать транзитный слой от натального.
const TRANSIT_COLOR = '#6b8299';

// Renders natal chart with an overlaid transit layer: natal planets as before
// (plain colored text by dignity), transit planets shown smaller, below, prefixed with "T·".
function renderNorthIndianSVGWithTransits(natalChart, transitsResult, opts = {}) {
  const { title = 'Транзиты', subtitle = '', width = 900, chartSize = 640 } = opts;
  const ascSignIdx = natalChart.ascendant.sign.index;

  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  // Группируем транзитные планеты по номеру натального дома (уже посчитан в transits.js)
  const transitsByHouse = {};
  for (let h = 1; h <= 12; h++) transitsByHouse[h] = [];
  for (const [name, t] of Object.entries(transitsResult.planets)) {
    transitsByHouse[t.transitHouse].push({ name, t });
  }

  const headerH = 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + 12 * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const scale = chartSize / VB;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">${EMBEDDED_FONTS_STYLE}`;
  svg += `<rect width="${width}" height="${totalH}" fill="${COLORS.parchment}"/>`;

  svg += `<text x="${width - 50}" y="38" font-family="JKSerif" font-size="18" font-weight="600" fill="${COLORS.ink}" text-anchor="end">Джанма Кундали</text>`;
  svg += `<text x="${width - 50}" y="58" font-family="JKSans" font-size="12" fill="${COLORS.gold}" text-anchor="end">t.me/janma_kundali_bot</text>`;
  svg += `<text x="${width/2}" y="98" font-family="JKSerif" font-size="30" fill="${COLORS.ink}" text-anchor="middle">${esc(title)}</text>`;
  if (subtitle) {
    svg += `<text x="${width/2}" y="122" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}" text-anchor="middle">${esc(subtitle)}</text>`;
  }

  svg += `<g transform="translate(${chartOffsetX},${chartOffsetY}) scale(${scale})">`;
  svg += `<polygon points="0,0 ${VB},0 ${VB},${VB} 0,${VB}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  svg += `<line x1="0" y1="0" x2="${VB}" y2="${VB}" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  svg += `<line x1="${VB}" y1="0" x2="0" y2="${VB}" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
  svg += `<polygon points="${C},0 ${VB},${C} ${C},${VB} 0,${C}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;

  for (let h = 1; h <= 12; h++) {
    const poly = HP[h];
    const [cx, cy] = polyCentroid(poly);
    const signIdx = (ascSignIdx + h - 1) % 12;
    const signNumber = signIdx + 1;

    if (h === 1) {
      const pts = poly.map(p => p.join(',')).join(' ');
      svg += `<polygon points="${pts}" fill="#f9f1de"/>`;
      svg += `<polygon points="${pts}" fill="none" stroke="${COLORS.gold}" stroke-width="1.5"/>`;
    }

    const [numX, numY] = signNumberPosition(poly);
    if (h === 1) {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="17" font-weight="600" fill="${COLORS.gold}" text-anchor="middle">${signNumber}</text>`;
      svg += `<rect x="${cx - 23}" y="${cy - 46}" width="46" height="20" rx="4" fill="${COLORS.gold}"/>`;
      svg += `<text x="${cx}" y="${cy - 32}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.parchmentCard}" text-anchor="middle">ASC</text>`;
    } else {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="15" fill="${COLORS.inkSoft}" text-anchor="middle">${signNumber}</text>`;
    }

    // Натальные планеты — как раньше, в центре
    const planetsHere = signPlanets[signIdx] || [];
    const count = planetsHere.length;
    const cols = count > 2 ? 2 : 1;
    const rows = Math.ceil(count / cols);
    const fontSize = count > 3 ? 12 : count > 1 ? 13.5 : 15;
    const colGap = fontSize * 2.6;
    const rowGap = fontSize * 2.9;
    const gridW = (cols - 1) * colGap;
    const gridH = (rows - 1) * rowGap;
    const startX = cx - gridW / 2;
    const startY = cy - gridH / 2;

    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      const dignity = dignityOf(item.name, item.p.sign.index);
      const color = COLORS[dignity];
      svg += `<text x="${px}" y="${py}" font-family="JKSans" font-weight="700" font-size="${fontSize}" fill="${color}" text-anchor="middle" dominant-baseline="central">${PLANET_SYMBOLS[item.name]}</text>`;
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      svg += `<text x="${px}" y="${py + fontSize * 1.15}" font-family="JKSans" font-size="9" fill="${COLORS.inkSoft}" text-anchor="middle">${dmsFromDeg(item.p.sign.degInSign)}</text>`;
    });

    // Транзитные планеты — компактным блоком ниже натальных, отдельным цветом, с пометкой "т"
    const transitsHere = transitsByHouse[h] || [];
    if (transitsHere.length > 0) {
      const tCount = transitsHere.length;
      const tCols = tCount > 2 ? 2 : 1;
      const tFontSize = 10;
      const tColGap = tFontSize * 3.2;
      const tRowGap = tFontSize * 2.1;
      const tGridW = (tCols - 1) * tColGap;
      const tStartX = cx - tGridW / 2;
      const tStartY = startY + gridH + fontSize * 1.15 + 16;

      transitsHere.forEach((item, i) => {
        const col = i % tCols;
        const row = Math.floor(i / tCols);
        const px = tStartX + col * tColGap;
        const py = tStartY + row * tRowGap;
        svg += `<text x="${px}" y="${py}" font-family="JKSans" font-weight="600" font-size="${tFontSize}" fill="${TRANSIT_COLOR}" text-anchor="middle">${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.t.sign.degInSign)}</text>`;
      });
    }
  }

  svg += `</g>`;

  const legendY = chartOffsetY + chartSize + 26;
  svg += `<circle cx="42" cy="${legendY - 4}" r="5" fill="${COLORS.exalted}"/>`;
  svg += `<text x="54" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">экзальтация</text>`;
  svg += `<circle cx="180" cy="${legendY - 4}" r="5" fill="${COLORS.own}"/>`;
  svg += `<text x="192" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">своя обитель</text>`;
  svg += `<circle cx="320" cy="${legendY - 4}" r="5" fill="${COLORS.debilitated}"/>`;
  svg += `<text x="332" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">падение</text>`;
  svg += `<circle cx="440" cy="${legendY - 4}" r="5" fill="${TRANSIT_COLOR}"/>`;
  svg += `<text x="452" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">транзит</text>`;

  // Таблица по домам: натальные планеты и транзитные планеты, попадающие в этот дом
  const natalByHouse = {};
  for (let h = 1; h <= 12; h++) natalByHouse[h] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    natalByHouse[p.house].push({ name, p });
  }

  const listStartY = legendY + 30;
  svg += `<line x1="40" y1="${listStartY - 24}" x2="${width - 40}" y2="${listStartY - 24}" stroke="${COLORS.gold}" stroke-width="1"/>`;
  svg += `<text x="40" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ДОМ</text>`;
  svg += `<text x="100" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ЗНАК</text>`;
  svg += `<text x="220" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">НАТАЛ</text>`;
  svg += `<text x="530" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ТРАНЗИТ</text>`;

  for (let h = 1; h <= 12; h++) {
    const signIdx = (ascSignIdx + h - 1) % 12;
    const y = listStartY + (h - 1) * listRowH + 14;
    if (h % 2 === 0) {
      svg += `<rect x="30" y="${y - 18}" width="${width - 60}" height="${listRowH}" fill="${COLORS.parchmentCard}"/>`;
    }
    svg += `<text x="40" y="${y}" font-family="JKSerif" font-size="13" font-weight="700" fill="${COLORS.gold}">${h}</text>`;
    svg += `<text x="100" y="${y}" font-family="JKSans" font-size="12" fill="${COLORS.ink}">${signIdx + 1}. ${esc(SIGN_NAMES[signIdx])}</text>`;

    const natalHere = natalByHouse[h];
    const natalStr = natalHere.length
      ? natalHere.map(item => `${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.p.sign.degInSign)}`).join('   ')
      : '—';
    svg += `<text x="220" y="${y}" font-family="JKSans" font-size="12" fill="${COLORS.ink}">${esc(natalStr)}</text>`;

    const transitHere = transitsByHouse[h];
    const transitStr = transitHere.length
      ? transitHere.map(item => `${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.t.sign.degInSign)}`).join('   ')
      : '—';
    svg += `<text x="530" y="${y}" font-family="JKSans" font-size="12" fill="${TRANSIT_COLOR}">${esc(transitStr)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// ============================================================
// South Indian style — фиксированная сетка 4x4, каждая ячейка = всегда
// один и тот же знак зодиака (не зависит от Асцендента), в центре — надпись "Раши".
// ============================================================

const SOUTH_GRID_LAYOUT = [
  { sign: 11, row: 1, col: 1 }, { sign: 0, row: 1, col: 2 }, { sign: 1, row: 1, col: 3 }, { sign: 2, row: 1, col: 4 },
  { sign: 10, row: 2, col: 1 }, { sign: 3, row: 2, col: 4 },
  { sign: 9, row: 3, col: 1 }, { sign: 4, row: 3, col: 4 },
  { sign: 8, row: 4, col: 1 }, { sign: 7, row: 4, col: 2 }, { sign: 6, row: 4, col: 3 }, { sign: 5, row: 4, col: 4 },
];

function renderSouthIndianSVG(natalChart, opts = {}) {
  const { title = 'Натальная карта', subtitle = '', width = 900, chartSize = 640 } = opts;
  const ascSignIdx = natalChart.ascendant.sign.index;

  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const order = ['Солнце','Луна','Меркурий','Венера','Марс','Юпитер','Сатурн','Раху','Кету'];
  const headerH = 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + (order.length + 1) * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const cellSize = chartSize / 4;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">${EMBEDDED_FONTS_STYLE}`;
  svg += `<rect width="${width}" height="${totalH}" fill="${COLORS.parchment}"/>`;

  svg += `<text x="${width - 50}" y="38" font-family="JKSerif" font-size="18" font-weight="600" fill="${COLORS.ink}" text-anchor="end">Джанма Кундали</text>`;
  svg += `<text x="${width - 50}" y="58" font-family="JKSans" font-size="12" fill="${COLORS.gold}" text-anchor="end">t.me/janma_kundali_bot</text>`;
  svg += `<text x="${width/2}" y="98" font-family="JKSerif" font-size="30" fill="${COLORS.ink}" text-anchor="middle">${esc(title)}</text>`;
  if (subtitle) {
    svg += `<text x="${width/2}" y="122" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}" text-anchor="middle">${esc(subtitle)}</text>`;
  }

  svg += `<g transform="translate(${chartOffsetX},${chartOffsetY})">`;
  svg += `<rect x="0" y="0" width="${chartSize}" height="${chartSize}" fill="none" stroke="${COLORS.gold}" stroke-width="2"/>`;

  for (const pos of SOUTH_GRID_LAYOUT) {
    const cx0 = (pos.col - 1) * cellSize;
    const cy0 = (pos.row - 1) * cellSize;
    const isAsc = pos.sign === ascSignIdx;

    if (isAsc) {
      // Заливка всей ячейки мягким золотым тоном + утолщённая рамка — Асцендент виден сразу
      svg += `<rect x="${cx0}" y="${cy0}" width="${cellSize}" height="${cellSize}" fill="#f9f1de"/>`;
    }
    svg += `<rect x="${cx0}" y="${cy0}" width="${cellSize}" height="${cellSize}" fill="none" stroke="${COLORS.gold}" stroke-width="${isAsc ? 2 : 1}"/>`;

    const numX = cx0 + 14;
    const numY = cy0 + 20;
    if (isAsc) {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="19" font-weight="600" fill="${COLORS.gold}">${pos.sign + 1}</text>`;
      // Чёткий бейдж "ASC" вместо мелкой звёздочки
      const badgeX = cx0 + cellSize - 54;
      const badgeY = cy0 + 8;
      svg += `<rect x="${badgeX}" y="${badgeY}" width="46" height="20" rx="4" fill="${COLORS.gold}"/>`;
      svg += `<text x="${badgeX + 23}" y="${badgeY + 14}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.parchmentCard}" text-anchor="middle">ASC</text>`;
    } else {
      svg += `<text x="${numX}" y="${numY}" font-family="JKSerif" font-size="17" fill="${COLORS.inkSoft}">${pos.sign + 1}</text>`;
    }

    const planetsHere = signPlanets[pos.sign] || [];
    const cx = cx0 + cellSize / 2;
    const cy = cy0 + cellSize / 2 + 6;
    const count = planetsHere.length;
    const cols = count > 2 ? 2 : 1;
    const rows = Math.ceil(count / cols);
    const fontSize = count > 3 ? 12 : count > 1 ? 13.5 : 15;
    const colGap = fontSize * 2.4;
    const rowGap = fontSize * 2.7;
    const gridW = (cols - 1) * colGap;
    const gridH = (rows - 1) * rowGap;
    const startX = cx - gridW / 2;
    const startY = cy - gridH / 2;

    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      const dignity = dignityOf(item.name, item.p.sign.index);
      const color = COLORS[dignity];
      svg += `<text x="${px}" y="${py}" font-family="JKSans" font-weight="700" font-size="${fontSize}" fill="${color}" text-anchor="middle" dominant-baseline="central">${PLANET_SYMBOLS[item.name]}</text>`;
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * colGap;
      const py = startY + row * rowGap;
      svg += `<text x="${px}" y="${py + fontSize * 1.1}" font-family="JKSans" font-size="8.5" fill="${COLORS.inkSoft}" text-anchor="middle">${dmsFromDeg(item.p.sign.degInSign)}</text>`;
    });
  }

  // Центр (2x2 внутренних клетки пустые в классической South Indian раскладке) — подпись "Раши"
  const centerX = cellSize * 2, centerY = cellSize * 2;
  svg += `<text x="${centerX}" y="${centerY - 6}" font-family="JKSerif" font-size="16" fill="${COLORS.ink}" text-anchor="middle">Раши</text>`;
  svg += `<text x="${centerX}" y="${centerY + 12}" font-family="JKSans" font-size="9" fill="${COLORS.inkSoft}" text-anchor="middle">South Indian</text>`;

  svg += `</g>`;

  const legendY = chartOffsetY + chartSize + 26;
  svg += `<circle cx="42" cy="${legendY - 4}" r="5" fill="${COLORS.exalted}"/>`;
  svg += `<text x="54" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">экзальтация</text>`;
  svg += `<circle cx="180" cy="${legendY - 4}" r="5" fill="${COLORS.own}"/>`;
  svg += `<text x="192" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">своя обитель</text>`;
  svg += `<circle cx="320" cy="${legendY - 4}" r="5" fill="${COLORS.debilitated}"/>`;
  svg += `<text x="332" y="${legendY}" font-family="JKSans" font-size="11" fill="${COLORS.inkSoft}">падение</text>`;

  const listStartY = legendY + 30;
  svg += `<line x1="40" y1="${listStartY - 24}" x2="${width - 40}" y2="${listStartY - 24}" stroke="${COLORS.gold}" stroke-width="1"/>`;
  svg += `<text x="40" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ПЛАНЕТА</text>`;
  svg += `<text x="180" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ЗНАК</text>`;
  svg += `<text x="280" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">ГРАДУС</text>`;
  svg += `<text x="400" y="${listStartY - 6}" font-family="JKSans" font-size="11" font-weight="700" fill="${COLORS.inkSoft}">НАКШАТРА</text>`;

  // Строка Лагны (Асцендента) — мягкое выделение
  {
    const asc = natalChart.ascendant;
    const y = listStartY + 14;
    svg += `<rect x="30" y="${y - 18}" width="${width - 60}" height="${listRowH}" fill="#fbf6ec"/>`;
    svg += `<text x="40" y="${y}" font-family="JKSans" font-weight="700" font-size="13" fill="${COLORS.gold}">Лагна</text>`;
    svg += `<text x="180" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${asc.sign.index + 1}. ${esc(asc.sign.name)}</text>`;
    svg += `<text x="280" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}">${dmsFromDeg(asc.sign.degInSign)}</text>`;
    svg += `<text x="400" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(asc.nakshatra.name)} (пада ${asc.nakshatra.pada})</text>`;
  }

  order.forEach((name, i) => {
    const p = natalChart.planets[name];
    const y = listStartY + (i + 1) * listRowH + 14;
    const dignity = dignityOf(name, p.sign.index);
    const color = COLORS[dignity];
    if (i % 2 === 0) {
      svg += `<rect x="30" y="${y - 18}" width="${width - 60}" height="${listRowH}" fill="${COLORS.parchmentCard}"/>`;
    }
    svg += `<text x="40" y="${y}" font-family="JKSans" font-weight="700" font-size="14" fill="${color}">${PLANET_SYMBOLS[name]}</text>`;
    svg += `<text x="70" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(name)}</text>`;
    svg += `<text x="180" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${p.sign.index + 1}. ${esc(p.sign.name)}</text>`;
    svg += `<text x="280" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.inkSoft}">${dmsFromDeg(p.sign.degInSign)}</text>`;
    svg += `<text x="400" y="${y}" font-family="JKSans" font-size="14" fill="${COLORS.ink}">${esc(p.nakshatra.name)} (пада ${p.nakshatra.pada})</text>`;
  });

  svg += `</svg>`;
  return svg;
}

module.exports = { renderNorthIndianSVG, renderNorthIndianSVGWithTransits, renderSouthIndianSVG, dmsFromDeg, PLANET_SYMBOLS, dignityOf };
