// ============================================================
// chart-export-pdf.js — экспорт карты из мини-приложения в PDF
// с выбором разделов: натальная карта, дробные карты, транзиты,
// периоды даши. Визуальный стиль (пергамент/золото, шрифты) —
// тот же, что уже используется в dasha-pdf.js.
// ============================================================

const PDFDocument = require('pdfkit');
const path = require('path');
const { renderNorthIndianPNG, renderNorthIndianWithTransitsPNG, renderDivisionalPNG } = require('./chart-canvas.js');
const { calculateNavamsha } = require('./navamsha.js');
const { calculateDashamsha } = require('./dashamsha.js');
const { calculateVarga, VARGA_DEFS } = require('./divisional-charts.js');

const COLORS = {
  ink: '#2a2118',
  inkSoft: '#6b6154',
  gold: '#b8935a',
  goldBright: '#8a6a3c',
  parchment: '#f7f2e9',
  line: '#e3d9c6',
};

const FONT_SERIF = path.join(__dirname, 'fonts', 'DejaVuSerif.ttf');
const FONT_SERIF_BOLD = path.join(__dirname, 'fonts', 'DejaVuSerif-Bold.ttf');
const FONT_SANS = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_SANS_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');
const LOGO_PATH = path.join(__dirname, 'assets', 'logo-ink.png');
const BOT_LINK = 'https://t.me/janma_kundali_bot';
const BOT_LINK_LABEL = 't.me/janma_kundali_bot';

const VARGA_LABELS = {
  d9: 'Навамша (D9)', d10: 'Дашамша (D10)',
  d2: 'Хора (D2)', d3: 'Дрекана (D3)', d4: 'Чатуртхамша (D4)', d7: 'Саптамша (D7)',
  d12: 'Двадашамша (D12)', d16: 'Шодашамша (D16)', d20: 'Вимшамша (D20)',
  d24: 'Чатурвимшамша (D24)', d27: 'Бхамша (D27)', d30: 'Тримшамша (D30)',
  d40: 'Хаведамша (D40)', d45: 'Акшаведамша (D45)', d60: 'Шаштиамша (D60)',
};

function fmtDate(d) {
  return d.toISOString().slice(0, 10).split('-').reverse().join('.');
}

function drawHeader(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.parchment);
  try {
    doc.image(LOGO_PATH, 50, 16, { width: 38 });
  } catch (e) { /* лого недоступно — не критично */ }
  const rightBoxX = 50, rightBoxW = doc.page.width - 100;
  doc.fillColor(COLORS.ink).font(FONT_SERIF_BOLD).fontSize(13).text('Джанма Кундали', rightBoxX, 22, { width: rightBoxW, align: 'right' });
  doc.fillColor(COLORS.gold).font(FONT_SANS).fontSize(10).text(BOT_LINK_LABEL, rightBoxX, 40, { width: rightBoxW, align: 'right', link: BOT_LINK, underline: false });

  doc.fillColor(COLORS.ink).font(FONT_SERIF_BOLD).fontSize(20).text(title, 50, 66, { align: 'center', width: doc.page.width - 100 });
  if (subtitle) {
    doc.fillColor(COLORS.inkSoft).font(FONT_SANS).fontSize(11).text(subtitle, 50, 94, { align: 'center', width: doc.page.width - 100 });
  }
  doc.moveTo(50, 122).lineTo(doc.page.width - 50, 122).strokeColor(COLORS.gold).lineWidth(1).stroke();
}

function drawSectionTitle(doc, text, y) {
  doc.fillColor(COLORS.goldBright).font(FONT_SERIF_BOLD).fontSize(14).text(text, 50, y);
  return y + 24;
}

function drawPeriodRow(doc, label, value, y, opts = {}) {
  const { highlight = false } = opts;
  if (highlight) doc.rect(45, y - 4, doc.page.width - 90, 22).fill('#fff9ee');
  doc.fillColor(COLORS.inkSoft).font(FONT_SANS).fontSize(10).text(label, 55, y, { width: 150 });
  doc.fillColor(highlight ? COLORS.goldBright : COLORS.ink).font(highlight ? FONT_SANS_BOLD : FONT_SANS).fontSize(11).text(value, 210, y - 1);
  return y + 22;
}

function embedImage(doc, buffer, topY) {
  const maxW = doc.page.width - 100;
  doc.image(buffer, 50, topY, { width: maxW, align: 'center' });
}

/**
 * Собирает PDF с выбранными разделами.
 * @param {object} opts
 * @param {string} opts.name - имя (для подписи)
 * @param {string} opts.dateStr - дата рождения (для подписи)
 * @param {string} opts.timeStr - время рождения
 * @param {string} opts.placeLabel - место рождения
 * @param {object} opts.chart - натальная карта (calculateChart)
 * @param {object} opts.sections - { chart:bool, vargas:string[], transits:bool, periods:bool }
 * @param {object} [opts.transitsResult] - нужен, если sections.transits
 * @param {object} [opts.dashaData] - { mahadashas, chain }, нужен, если sections.periods
 */
function buildChartExportPDF({ name, dateStr, timeStr, placeLabel, chart, sections, transitsResult, dashaData }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('serif', FONT_SERIF);
    doc.registerFont('serif-bold', FONT_SERIF_BOLD);
    doc.registerFont('sans', FONT_SANS);
    doc.registerFont('sans-bold', FONT_SANS_BOLD);

    const subtitle = `${name} · ${dateStr}, ${timeStr}${placeLabel ? ' · ' + placeLabel : ''}`;
    let firstPage = true;
    function newPage(title) {
      if (!firstPage) doc.addPage();
      firstPage = false;
      drawHeader(doc, title, subtitle);
    }

    if (sections.chart) {
      newPage('Натальная карта');
      const buf = renderNorthIndianPNG(chart, { noHeader: true });
      embedImage(doc, buf, 140);
    }

    if (sections.vargas && sections.vargas.length > 0) {
      for (const key of sections.vargas) {
        newPage(VARGA_LABELS[key] || key);
        let vargaChart;
        if (key === 'd9') vargaChart = calculateNavamsha(chart);
        else if (key === 'd10') vargaChart = calculateDashamsha(chart);
        else if (VARGA_DEFS[key]) vargaChart = calculateVarga(chart, key);
        else continue;
        const buf = renderDivisionalPNG(vargaChart, { noHeader: true });
        embedImage(doc, buf, 140);
      }
    }

    if (sections.transits && transitsResult) {
      newPage('Текущие транзиты');
      const buf = renderNorthIndianWithTransitsPNG(chart, transitsResult, { noHeader: true });
      embedImage(doc, buf, 140);
    }

    if (sections.periods && dashaData) {
      newPage('Периоды Вимшоттари даша');
      let y = 152;
      const { mahadashas, chain } = dashaData;

      if (chain) {
        y = drawSectionTitle(doc, 'Текущий период', y);
        y = drawPeriodRow(doc, 'Махадаша', `${chain.mahadasha.lord}  (${fmtDate(new Date(chain.mahadasha.start))} – ${fmtDate(new Date(chain.mahadasha.end))})`, y, { highlight: true });
        if (chain.antardasha) {
          y = drawPeriodRow(doc, 'Антардаша', `${chain.antardasha.lord}  (${fmtDate(new Date(chain.antardasha.start))} – ${fmtDate(new Date(chain.antardasha.end))})`, y, { highlight: true });
        }
        if (chain.pratyantardasha) {
          y = drawPeriodRow(doc, 'Пратьянтардаша', `${chain.pratyantardasha.lord}  (${fmtDate(new Date(chain.pratyantardasha.start))} – ${fmtDate(new Date(chain.pratyantardasha.end))})`, y, { highlight: true });
        }
        y += 16;
      }

      y = drawSectionTitle(doc, 'Махадаши жизни', y);
      for (const md of mahadashas) {
        if (y > doc.page.height - 80) {
          doc.addPage();
          drawHeader(doc, 'Периоды Вимшоттари даша', subtitle);
          y = 152;
        }
        const isCurrent = chain && md.lord === chain.mahadasha.lord && new Date(md.start).getTime() === new Date(chain.mahadasha.start).getTime();
        y = drawPeriodRow(doc, md.lord, `${fmtDate(new Date(md.start))} – ${fmtDate(new Date(md.end))}`, y, { highlight: isCurrent });
      }
    }

    if (firstPage) {
      // ничего не выбрано — на всякий случай не отдаём пустой PDF без страниц
      drawHeader(doc, 'Экспорт карты', subtitle);
      doc.fillColor(COLORS.inkSoft).font(FONT_SANS).fontSize(11).text('Ни один раздел не был выбран для экспорта.', 50, 152);
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(COLORS.inkSoft).font(FONT_SANS).fontSize(9)
        .text(`${i + 1} / ${pageCount}`, 0, doc.page.height - 40, { align: 'center', width: doc.page.width });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

module.exports = { buildChartExportPDF };
