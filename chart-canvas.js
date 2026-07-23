// ============================================================
// Chart Canvas renderer — рисует натальную карту через node-canvas
// (Cairo + прямая загрузка шрифтов из файла), а не через SVG+sharp.
// Это надёжнее: не зависит от системных шрифтов сервера (в отличие
// от SVG @font-face, который может не поддерживаться на некоторых
// сборках librsvg/resvg на хостинге).
// ============================================================

const path = require('path');
const { createCanvas, registerFont } = require('canvas');

const FONT_DIR = path.join(__dirname, 'fonts');
registerFont(path.join(FONT_DIR, 'DejaVuSans.ttf'), { family: 'JKSans', weight: 'normal' });
registerFont(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'), { family: 'JKSans', weight: 'bold' });
registerFont(path.join(FONT_DIR, 'DejaVuSerif.ttf'), { family: 'JKSerif', weight: 'normal' });
registerFont(path.join(FONT_DIR, 'DejaVuSerif-Bold.ttf'), { family: 'JKSerif', weight: 'bold' });

const PLANET_SYMBOLS = {
  'Солнце': 'Su', 'Луна': 'Mo', 'Меркурий': 'Me', 'Венера': 'Ve', 'Марс': 'Ma',
  'Юпитер': 'Ju', 'Сатурн': 'Sa', 'Раху': 'Ra', 'Кету': 'Ke'
};

const SIGN_NAMES = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];

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
  exalted: '#4f7a52',
  debilitated: '#b23b2e',
  own: '#4a6d8c',
  neutral: '#2a2118',
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

// --- Небольшие обёртки для рисования, аналог SVG-примитивов ---
function text(ctx, str, x, y, { font, color, align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

function strokePoly(ctx, points, color, lineWidth) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function fillPoly(ctx, points, color) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, color, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function rect(ctx, x, y, w, h, { fill, stroke, lineWidth } = {}) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 1; ctx.strokeRect(x, y, w, h); }
}

function roundRect(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function circle(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}


// Ретроградность — чёрточка НАД символом планеты (комбинирующий U+0305),
// а не буква — компактнее и привычнее по виду классических распечаток.
function retroText(symbol, isRetro) {
  return isRetro ? symbol.split('').map(c => c + '\u0305').join('') : symbol;
}

function drawHeader(ctx, width, title, subtitle) {
  text(ctx, 'Джанма Кундали', width - 50, 38, { font: 'bold 18px JKSerif', color: COLORS.ink, align: 'right' });
  text(ctx, 't.me/janma_kundali_bot', width - 50, 58, { font: '12px JKSans', color: COLORS.gold, align: 'right' });
  text(ctx, title, width / 2, 98, { font: '30px JKSerif', color: COLORS.ink, align: 'center' });
  if (subtitle) {
    text(ctx, subtitle, width / 2, 122, { font: '14px JKSans', color: COLORS.inkSoft, align: 'center' });
  }
}

function drawDignityLegend(ctx, legendY, extraTransitDot) {
  circle(ctx, 42, legendY - 4, 5, COLORS.exalted);
  text(ctx, 'экзальтация', 54, legendY, { font: '11px JKSans', color: COLORS.inkSoft });
  circle(ctx, 180, legendY - 4, 5, COLORS.own);
  text(ctx, 'своя обитель', 192, legendY, { font: '11px JKSans', color: COLORS.inkSoft });
  circle(ctx, 320, legendY - 4, 5, COLORS.debilitated);
  text(ctx, 'падение', 332, legendY, { font: '11px JKSans', color: COLORS.inkSoft });
  if (extraTransitDot) {
    circle(ctx, 440, legendY - 4, 5, TRANSIT_COLOR);
    text(ctx, 'транзит', 452, legendY, { font: '11px JKSans', color: COLORS.inkSoft });
  }
}

// ============================================================
// North Indian
// ============================================================
function renderNorthIndianPNG(chart, opts = {}) {
  const { title = 'Натальная карта', subtitle = '', width = 900, chartSize = 640, noHeader = false } = opts;
  const ascSignIdx = chart.ascendant.sign.index;
  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(chart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const order = ['Солнце','Луна','Меркурий','Венера','Марс','Юпитер','Сатурн','Раху','Кету'];
  const headerH = noHeader ? 20 : 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + (order.length + 1) * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const scale = chartSize / VB;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext('2d');
  rect(ctx, 0, 0, width, totalH, { fill: COLORS.parchment });

  if (!noHeader) drawHeader(ctx, width, title, subtitle);

  ctx.save();
  ctx.translate(chartOffsetX, chartOffsetY);
  ctx.scale(scale, scale);

  strokePoly(ctx, [[0,0],[VB,0],[VB,VB],[0,VB]], COLORS.gold, 1.5);
  line(ctx, 0, 0, VB, VB, COLORS.gold, 1.5);
  line(ctx, VB, 0, 0, VB, COLORS.gold, 1.5);
  strokePoly(ctx, [[C,0],[VB,C],[C,VB],[0,C]], COLORS.gold, 1.5);

  for (let h = 1; h <= 12; h++) {
    const poly = HP[h];
    const [cx, cy] = polyCentroid(poly);
    const signIdx = (ascSignIdx + h - 1) % 12;
    const signNumber = signIdx + 1;

    if (h === 1) {
      fillPoly(ctx, poly, '#f9f1de');
      strokePoly(ctx, poly, COLORS.gold, 1.5);
    }

    const [numX, numY] = signNumberPosition(poly);
    if (h === 1) {
      text(ctx, String(signNumber), numX, numY, { font: 'bold 17px JKSerif', color: COLORS.gold, align: 'center' });
      roundRect(ctx, cx - 23, cy - 46, 46, 20, 4, COLORS.gold);
      text(ctx, 'ASC', cx, cy - 32, { font: 'bold 11px JKSans', color: COLORS.parchmentCard, align: 'center' });
    } else {
      text(ctx, String(signNumber), numX, numY, { font: '15px JKSerif', color: COLORS.inkSoft, align: 'center' });
    }

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
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      const color = COLORS[dignityOf(item.name, item.p.sign.index)];
      text(ctx, retroText(PLANET_SYMBOLS[item.name], item.p.retrograde), px, py, { font: `bold ${fontSize}px JKSans`, color, align: 'center', baseline: 'middle' });
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      text(ctx, dmsFromDeg(item.p.sign.degInSign), px, py + fontSize * 1.15, { font: '9px JKSans', color: COLORS.inkSoft, align: 'center' });
    });
  }
  ctx.restore();

  const legendY = chartOffsetY + chartSize + 26;
  drawDignityLegend(ctx, legendY, false);

  const listStartY = legendY + 30;
  line(ctx, 40, listStartY - 24, width - 40, listStartY - 24, COLORS.gold, 1);
  text(ctx, 'ПЛАНЕТА', 40, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ЗНАК', 180, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ГРАДУС', 280, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'НАКШАТРА', 400, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });

  {
    const asc = chart.ascendant;
    const y = listStartY + 14;
    rect(ctx, 30, y - 18, width - 60, listRowH, { fill: '#fbf6ec' });
    text(ctx, 'Лагна', 40, y, { font: 'bold 13px JKSans', color: COLORS.gold });
    text(ctx, `${asc.sign.index + 1}. ${asc.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(asc.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, `${asc.nakshatra.name} (пада ${asc.nakshatra.pada})`, 400, y, { font: '14px JKSans', color: COLORS.ink });
  }

  order.forEach((name, i) => {
    const p = chart.planets[name];
    const y = listStartY + (i + 1) * listRowH + 14;
    const color = COLORS[dignityOf(name, p.sign.index)];
    if (i % 2 === 0) rect(ctx, 30, y - 18, width - 60, listRowH, { fill: COLORS.parchmentCard });
    text(ctx, retroText(PLANET_SYMBOLS[name], p.retrograde), 40, y, { font: 'bold 14px JKSans', color });
    text(ctx, name, 70, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, `${p.sign.index + 1}. ${p.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(p.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, `${p.nakshatra.name} (пада ${p.nakshatra.pada})`, 400, y, { font: '14px JKSans', color: COLORS.ink });
  });

  return canvas.toBuffer('image/png');
}

// ============================================================
// South Indian
// ============================================================
const SOUTH_GRID_LAYOUT = [
  { sign: 11, row: 1, col: 1 }, { sign: 0, row: 1, col: 2 }, { sign: 1, row: 1, col: 3 }, { sign: 2, row: 1, col: 4 },
  { sign: 10, row: 2, col: 1 }, { sign: 3, row: 2, col: 4 },
  { sign: 9, row: 3, col: 1 }, { sign: 4, row: 3, col: 4 },
  { sign: 8, row: 4, col: 1 }, { sign: 7, row: 4, col: 2 }, { sign: 6, row: 4, col: 3 }, { sign: 5, row: 4, col: 4 },
];

function renderSouthIndianPNG(natalChart, opts = {}) {
  const { title = 'Натальная карта', subtitle = '', width = 900, chartSize = 640, noHeader = false } = opts;
  const ascSignIdx = natalChart.ascendant.sign.index;

  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const order = ['Солнце','Луна','Меркурий','Венера','Марс','Юпитер','Сатурн','Раху','Кету'];
  const headerH = noHeader ? 20 : 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + (order.length + 1) * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const cellSize = chartSize / 4;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext('2d');
  rect(ctx, 0, 0, width, totalH, { fill: COLORS.parchment });

  if (!noHeader) drawHeader(ctx, width, title, subtitle);

  ctx.save();
  ctx.translate(chartOffsetX, chartOffsetY);
  rect(ctx, 0, 0, chartSize, chartSize, { stroke: COLORS.gold, lineWidth: 2 });

  for (const pos of SOUTH_GRID_LAYOUT) {
    const cx0 = (pos.col - 1) * cellSize;
    const cy0 = (pos.row - 1) * cellSize;
    const isAsc = pos.sign === ascSignIdx;

    if (isAsc) rect(ctx, cx0, cy0, cellSize, cellSize, { fill: '#f9f1de' });
    rect(ctx, cx0, cy0, cellSize, cellSize, { stroke: COLORS.gold, lineWidth: isAsc ? 2 : 1 });

    const numX = cx0 + 14, numY = cy0 + 20;
    if (isAsc) {
      text(ctx, String(pos.sign + 1), numX, numY, { font: 'bold 19px JKSerif', color: COLORS.gold });
      const badgeX = cx0 + cellSize - 54, badgeY = cy0 + 8;
      roundRect(ctx, badgeX, badgeY, 46, 20, 4, COLORS.gold);
      text(ctx, 'ASC', badgeX + 23, badgeY + 14, { font: 'bold 11px JKSans', color: COLORS.parchmentCard, align: 'center' });
    } else {
      text(ctx, String(pos.sign + 1), numX, numY, { font: '17px JKSerif', color: COLORS.inkSoft });
    }

    const planetsHere = signPlanets[pos.sign] || [];
    const cx = cx0 + cellSize / 2, cy = cy0 + cellSize / 2 + 6;
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
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      const color = COLORS[dignityOf(item.name, item.p.sign.index)];
      text(ctx, retroText(PLANET_SYMBOLS[item.name], item.p.retrograde), px, py, { font: `bold ${fontSize}px JKSans`, color, align: 'center', baseline: 'middle' });
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      text(ctx, dmsFromDeg(item.p.sign.degInSign), px, py + fontSize * 1.1, { font: '8.5px JKSans', color: COLORS.inkSoft, align: 'center' });
    });
  }

  const centerX = cellSize * 2, centerY = cellSize * 2;
  text(ctx, 'Раши', centerX, centerY - 6, { font: '16px JKSerif', color: COLORS.ink, align: 'center' });
  text(ctx, 'South Indian', centerX, centerY + 12, { font: '9px JKSans', color: COLORS.inkSoft, align: 'center' });
  ctx.restore();

  const legendY = chartOffsetY + chartSize + 26;
  drawDignityLegend(ctx, legendY, false);

  const listStartY = legendY + 30;
  line(ctx, 40, listStartY - 24, width - 40, listStartY - 24, COLORS.gold, 1);
  text(ctx, 'ПЛАНЕТА', 40, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ЗНАК', 180, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ГРАДУС', 280, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'НАКШАТРА', 400, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });

  {
    const asc = natalChart.ascendant;
    const y = listStartY + 14;
    rect(ctx, 30, y - 18, width - 60, listRowH, { fill: '#fbf6ec' });
    text(ctx, 'Лагна', 40, y, { font: 'bold 13px JKSans', color: COLORS.gold });
    text(ctx, `${asc.sign.index + 1}. ${asc.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(asc.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, `${asc.nakshatra.name} (пада ${asc.nakshatra.pada})`, 400, y, { font: '14px JKSans', color: COLORS.ink });
  }

  order.forEach((name, i) => {
    const p = natalChart.planets[name];
    const y = listStartY + (i + 1) * listRowH + 14;
    const color = COLORS[dignityOf(name, p.sign.index)];
    if (i % 2 === 0) rect(ctx, 30, y - 18, width - 60, listRowH, { fill: COLORS.parchmentCard });
    text(ctx, retroText(PLANET_SYMBOLS[name], p.retrograde), 40, y, { font: 'bold 14px JKSans', color });
    text(ctx, name, 70, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, `${p.sign.index + 1}. ${p.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(p.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, `${p.nakshatra.name} (пада ${p.nakshatra.pada})`, 400, y, { font: '14px JKSans', color: COLORS.ink });
  });

  return canvas.toBuffer('image/png');
}

// ============================================================
// Транзиты — натальная сетка + наложенный слой транзитных планет
// ============================================================
const TRANSIT_COLOR = '#6b8299';

function renderNorthIndianWithTransitsPNG(natalChart, transitsResult, opts = {}) {
  const { title = 'Транзиты', subtitle = '', width = 900, chartSize = 640, noHeader = false } = opts;
  const ascSignIdx = natalChart.ascendant.sign.index;

  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const transitsByHouse = {};
  for (let h = 1; h <= 12; h++) transitsByHouse[h] = [];
  for (const [name, t] of Object.entries(transitsResult.planets)) {
    transitsByHouse[t.transitHouse].push({ name, t });
  }

  const headerH = noHeader ? 20 : 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + 12 * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const scale = chartSize / VB;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext('2d');
  rect(ctx, 0, 0, width, totalH, { fill: COLORS.parchment });

  if (!noHeader) drawHeader(ctx, width, title, subtitle);

  ctx.save();
  ctx.translate(chartOffsetX, chartOffsetY);
  ctx.scale(scale, scale);

  strokePoly(ctx, [[0,0],[VB,0],[VB,VB],[0,VB]], COLORS.gold, 1.5);
  line(ctx, 0, 0, VB, VB, COLORS.gold, 1.5);
  line(ctx, VB, 0, 0, VB, COLORS.gold, 1.5);
  strokePoly(ctx, [[C,0],[VB,C],[C,VB],[0,C]], COLORS.gold, 1.5);

  for (let h = 1; h <= 12; h++) {
    const poly = HP[h];
    const [cx, cy] = polyCentroid(poly);
    const signIdx = (ascSignIdx + h - 1) % 12;
    const signNumber = signIdx + 1;

    if (h === 1) {
      fillPoly(ctx, poly, '#f9f1de');
      strokePoly(ctx, poly, COLORS.gold, 1.5);
    }

    const [numX, numY] = signNumberPosition(poly);
    if (h === 1) {
      text(ctx, String(signNumber), numX, numY, { font: 'bold 17px JKSerif', color: COLORS.gold, align: 'center' });
      roundRect(ctx, cx - 23, cy - 46, 46, 20, 4, COLORS.gold);
      text(ctx, 'ASC', cx, cy - 32, { font: 'bold 11px JKSans', color: COLORS.parchmentCard, align: 'center' });
    } else {
      text(ctx, String(signNumber), numX, numY, { font: '15px JKSerif', color: COLORS.inkSoft, align: 'center' });
    }

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
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      const color = COLORS[dignityOf(item.name, item.p.sign.index)];
      text(ctx, retroText(PLANET_SYMBOLS[item.name], item.p.retrograde), px, py, { font: `bold ${fontSize}px JKSans`, color, align: 'center', baseline: 'middle' });
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      text(ctx, dmsFromDeg(item.p.sign.degInSign), px, py + fontSize * 1.15, { font: '9px JKSans', color: COLORS.inkSoft, align: 'center' });
    });

    const transitsHere = transitsByHouse[h] || [];
    if (transitsHere.length > 0) {
      // Всегда один столбец — см. пояснение в public/index.html: метка
      // "символ + градус" длиннее натального символа, две колонки наезжали.
      // Растим блок транзитов В СТОРОНУ ЦЕНТРА карты, а не всегда вниз:
      // в нижней половине карты рост вниз быстро упирался в край холста
      // (особенно в маленьких угловых домах без натальных планет).
      const dir = cy <= C ? 1 : -1;
      const tFontSize = transitsHere.length > 3 ? 9 : 10;
      const tRowGap = tFontSize * 2.3;
      const tStartY = cy + dir * (gridH / 2 + fontSize * 1.15 + 16);

      transitsHere.forEach((item, i) => {
        const py = tStartY + dir * i * tRowGap;
        text(ctx, `${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.t.sign.degInSign)}`, cx, py, { font: `600 ${tFontSize}px JKSans`, color: TRANSIT_COLOR, align: 'center' });
      });
    }
  }
  ctx.restore();

  const legendY = chartOffsetY + chartSize + 26;
  drawDignityLegend(ctx, legendY, true);

  const natalByHouse = {};
  for (let h = 1; h <= 12; h++) natalByHouse[h] = [];
  for (const [name, p] of Object.entries(natalChart.planets)) {
    natalByHouse[p.house].push({ name, p });
  }

  const listStartY = legendY + 30;
  line(ctx, 40, listStartY - 24, width - 40, listStartY - 24, COLORS.gold, 1);
  text(ctx, 'ДОМ', 40, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ЗНАК', 100, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'НАТАЛ', 220, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ТРАНЗИТ', 530, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });

  for (let h = 1; h <= 12; h++) {
    const signIdx = (ascSignIdx + h - 1) % 12;
    const y = listStartY + (h - 1) * listRowH + 14;
    if (h % 2 === 0) rect(ctx, 30, y - 18, width - 60, listRowH, { fill: COLORS.parchmentCard });
    text(ctx, String(h), 40, y, { font: 'bold 13px JKSerif', color: COLORS.gold });
    text(ctx, `${signIdx + 1}. ${SIGN_NAMES[signIdx]}`, 100, y, { font: '12px JKSans', color: COLORS.ink });

    const natalHere = natalByHouse[h];
    const natalStr = natalHere.length
      ? natalHere.map(item => `${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.p.sign.degInSign)}`).join('   ')
      : '—';
    text(ctx, natalStr, 220, y, { font: '12px JKSans', color: COLORS.ink });

    const transitHere = transitsByHouse[h];
    const transitStr = transitHere.length
      ? transitHere.map(item => `${PLANET_SYMBOLS[item.name]} ${dmsFromDeg(item.t.sign.degInSign)}`).join('   ')
      : '—';
    text(ctx, transitStr, 530, y, { font: '12px JKSans', color: TRANSIT_COLOR });
  }

  return canvas.toBuffer('image/png');
}

// ============================================================
// Дробная карта (Навамша D9 и т.п.) — та же геометрия ромба North Indian,
// но без накшатр в таблице (в дробных картах накшатры традиционно не
// показываются — там оценивают только знак/дом/достоинство).
// ============================================================
function renderDivisionalPNG(d9chart, opts = {}) {
  const { title = 'Навамша (D9)', subtitle = '', width = 900, chartSize = 640, noHeader = false } = opts;
  const ascSignIdx = d9chart.ascendant.sign.index;
  const signPlanets = {};
  for (let i = 0; i < 12; i++) signPlanets[i] = [];
  for (const [name, p] of Object.entries(d9chart.planets)) {
    signPlanets[p.sign.index].push({ name, p });
  }

  const order = ['Солнце','Луна','Меркурий','Венера','Марс','Юпитер','Сатурн','Раху','Кету'];
  const headerH = noHeader ? 20 : 148;
  const listRowH = 30;
  const legendH = 34;
  const listH = 40 + (order.length + 1) * listRowH + legendH;
  const totalH = headerH + chartSize + listH;
  const chartOffsetX = (width - chartSize) / 2;
  const chartOffsetY = headerH;
  const scale = chartSize / VB;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext('2d');
  rect(ctx, 0, 0, width, totalH, { fill: COLORS.parchment });

  if (!noHeader) drawHeader(ctx, width, title, subtitle);

  ctx.save();
  ctx.translate(chartOffsetX, chartOffsetY);
  ctx.scale(scale, scale);

  strokePoly(ctx, [[0,0],[VB,0],[VB,VB],[0,VB]], COLORS.gold, 1.5);
  line(ctx, 0, 0, VB, VB, COLORS.gold, 1.5);
  line(ctx, VB, 0, 0, VB, COLORS.gold, 1.5);
  strokePoly(ctx, [[C,0],[VB,C],[C,VB],[0,C]], COLORS.gold, 1.5);

  for (let h = 1; h <= 12; h++) {
    const poly = HP[h];
    const [cx, cy] = polyCentroid(poly);
    const signIdx = (ascSignIdx + h - 1) % 12;
    const signNumber = signIdx + 1;

    if (h === 1) {
      fillPoly(ctx, poly, '#f9f1de');
      strokePoly(ctx, poly, COLORS.gold, 1.5);
    }

    const [numX, numY] = signNumberPosition(poly);
    if (h === 1) {
      text(ctx, String(signNumber), numX, numY, { font: 'bold 17px JKSerif', color: COLORS.gold, align: 'center' });
      roundRect(ctx, cx - 23, cy - 46, 46, 20, 4, COLORS.gold);
      text(ctx, 'ASC', cx, cy - 32, { font: 'bold 11px JKSans', color: COLORS.parchmentCard, align: 'center' });
    } else {
      text(ctx, String(signNumber), numX, numY, { font: '15px JKSerif', color: COLORS.inkSoft, align: 'center' });
    }

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
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      const color = COLORS[dignityOf(item.name, item.p.sign.index)];
      text(ctx, retroText(PLANET_SYMBOLS[item.name], item.p.retrograde), px, py, { font: `bold ${fontSize}px JKSans`, color, align: 'center', baseline: 'middle' });
    });
    planetsHere.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const px = startX + col * colGap, py = startY + row * rowGap;
      text(ctx, dmsFromDeg(item.p.sign.degInSign), px, py + fontSize * 1.15, { font: '9px JKSans', color: COLORS.inkSoft, align: 'center' });
    });
  }
  ctx.restore();

  const legendY = chartOffsetY + chartSize + 26;
  drawDignityLegend(ctx, legendY, false);

  const listStartY = legendY + 30;
  line(ctx, 40, listStartY - 24, width - 40, listStartY - 24, COLORS.gold, 1);
  text(ctx, 'ПЛАНЕТА', 40, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ЗНАК', 180, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ГРАДУС', 280, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });
  text(ctx, 'ДОМ', 400, listStartY - 6, { font: 'bold 11px JKSans', color: COLORS.inkSoft });

  {
    const asc = d9chart.ascendant;
    const y = listStartY + 14;
    rect(ctx, 30, y - 18, width - 60, listRowH, { fill: '#fbf6ec' });
    text(ctx, 'Лагна', 40, y, { font: 'bold 13px JKSans', color: COLORS.gold });
    text(ctx, `${asc.sign.index + 1}. ${asc.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(asc.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, '1', 400, y, { font: '14px JKSans', color: COLORS.ink });
  }

  order.forEach((name, i) => {
    const p = d9chart.planets[name];
    const y = listStartY + (i + 1) * listRowH + 14;
    const color = COLORS[dignityOf(name, p.sign.index)];
    if (i % 2 === 0) rect(ctx, 30, y - 18, width - 60, listRowH, { fill: COLORS.parchmentCard });
    text(ctx, retroText(PLANET_SYMBOLS[name], p.retrograde), 40, y, { font: 'bold 14px JKSans', color });
    text(ctx, name, 70, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, `${p.sign.index + 1}. ${p.sign.name}`, 180, y, { font: '14px JKSans', color: COLORS.ink });
    text(ctx, dmsFromDeg(p.sign.degInSign), 280, y, { font: '14px JKSans', color: COLORS.inkSoft });
    text(ctx, String(p.house), 400, y, { font: '14px JKSans', color: COLORS.ink });
  });

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderNorthIndianPNG,
  renderSouthIndianPNG,
  renderNorthIndianWithTransitsPNG,
  renderDivisionalPNG,
  dmsFromDeg,
  PLANET_SYMBOLS,
  dignityOf,
};
