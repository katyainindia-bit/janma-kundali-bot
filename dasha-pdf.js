// ============================================================
// Dasha PDF report — многостраничный отчёт по периодам Вимшоттари даша
// в фирменном стиле (пергамент/золото), вместо длинного текстового сообщения.
// ============================================================

const PDFDocument = require('pdfkit');
const path = require('path');

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

function fmtDate(d) {
  return d.toISOString().slice(0, 10).split('-').reverse().join('.');
}

function drawHeader(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.parchment);

  // Логотип слева + название и кликабельная ссылка на бота справа от него
  try {
    doc.image(LOGO_PATH, 50, 14, { width: 36 });
  } catch (e) {
    // если файл логотипа недоступен — просто пропускаем, не ломаем PDF
  }
  doc.fillColor(COLORS.ink).font(FONT_SERIF_BOLD).fontSize(13).text('Джанма Кундали', 96, 18);
  doc.fillColor(COLORS.gold).font(FONT_SANS).fontSize(10).text(BOT_LINK_LABEL, 96, 34, { link: BOT_LINK, underline: false });

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
  if (highlight) {
    doc.rect(45, y - 4, doc.page.width - 90, 22).fill('#fff9ee');
  }
  doc.fillColor(COLORS.inkSoft).font(FONT_SANS).fontSize(10).text(label, 55, y, { width: 150 });
  doc.fillColor(highlight ? COLORS.goldBright : COLORS.ink).font(highlight ? FONT_SANS_BOLD : FONT_SANS).fontSize(11).text(value, 210, y - 1);
  return y + 22;
}

function drawSubPeriodRow(doc, indent, label, value, y, opts = {}) {
  const { highlight = false, fontSize = 10, bold = false } = opts;
  if (highlight) {
    doc.rect(45, y - 3, doc.page.width - 90, fontSize + 8).fill('#fff9ee');
  }
  doc.fillColor(COLORS.inkSoft).font('sans').fontSize(fontSize).text(label, 55 + indent, y, { width: 170 - indent });
  doc.fillColor(highlight ? COLORS.goldBright : COLORS.ink).font(bold ? 'sans-bold' : 'sans').fontSize(fontSize).text(value, 220, y - 0.5);
  return y + fontSize + 8;
}

function ensureSpace(doc, y, needed, chapterTitle, chapterSubtitle) {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    drawHeader(doc, chapterTitle, chapterSubtitle);
    return 152;
  }
  return y;
}

/**
 * Строит PDF-отчёт по Вимшоттари даше и возвращает Buffer.
 * Полный разбор: для каждой Махадаши жизни расписаны все Антардаши,
 * а для каждой Антардаши — все Пратьянтардаши.
 * @param {object} opts - { dateStr, timeStr, mahadashas, chain }
 */
function buildDashaPDF({ dateStr, timeStr, mahadashas, chain }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('serif', FONT_SERIF);
    doc.registerFont('serif-bold', FONT_SERIF_BOLD);
    doc.registerFont('sans', FONT_SANS);
    doc.registerFont('sans-bold', FONT_SANS_BOLD);

    // ---------- Страница 1: обложка с текущим периодом ----------
    drawHeader(doc, 'Периоды Вимшоттари даша', `Карта: ${dateStr}, ${timeStr}`);
    doc.outline.addItem('Обложка и текущий период');
    let y = 152;

    if (chain) {
      y = drawSectionTitle(doc, 'Текущий период (на сегодня)', y);
      y = drawPeriodRow(doc, 'Махадаша', `${chain.mahadasha.lord}  (${fmtDate(chain.mahadasha.start)} – ${fmtDate(chain.mahadasha.end)})`, y, { highlight: true });
      if (chain.antardasha) {
        y = drawPeriodRow(doc, 'Антардаша', `${chain.antardasha.lord}  (${fmtDate(chain.antardasha.start)} – ${fmtDate(chain.antardasha.end)})`, y, { highlight: true });
      }
      if (chain.pratyantardasha) {
        y = drawPeriodRow(doc, 'Пратьянтардаша', `${chain.pratyantardasha.lord}  (${fmtDate(chain.pratyantardasha.start)} – ${fmtDate(chain.pratyantardasha.end)})`, y, { highlight: true });
      }
      y += 16;
    }

    y = drawSectionTitle(doc, 'Оглавление — махадаши жизни', y);
    for (const md of mahadashas) {
      const isCurrent = chain && md === chain.mahadasha;
      y = drawPeriodRow(doc, md.lord, `${fmtDate(md.start)} – ${fmtDate(md.end)}`, y, { highlight: isCurrent });
    }

    // ---------- Далее: по одной главе на каждую Махадашу, с полным деревом ----------
    for (const md of mahadashas) {
      doc.addPage();
      const isCurrentMD = chain && md === chain.mahadasha;
      const chapterTitle = `Махадаша: ${md.lord}`;
      const chapterSubtitle = `${fmtDate(md.start)} – ${fmtDate(md.end)}  ·  Карта: ${dateStr}, ${timeStr}`;
      drawHeader(doc, chapterTitle, chapterSubtitle);
      y = 152;

      // Закладка PDF (навигация в боковой панели читалки) на начало главы
      doc.outline.addItem(`Махадаша ${md.lord} (${fmtDate(md.start)}–${fmtDate(md.end)})`);

      for (const ad of md.antardashas) {
        y = ensureSpace(doc, y, 40, chapterTitle, chapterSubtitle);
        const isCurrentAD = chain && ad === chain.antardasha;
        y = drawSubPeriodRow(doc, 0, 'Антардаша', `${ad.lord}  (${fmtDate(ad.start)} – ${fmtDate(ad.end)})`, y, {
          highlight: isCurrentAD, fontSize: 11.5, bold: true
        });

        for (const pd of ad.pratyantardashas) {
          y = ensureSpace(doc, y, 22, chapterTitle, chapterSubtitle);
          const isCurrentPD = chain && pd === chain.pratyantardasha;
          y = drawSubPeriodRow(doc, 22, 'Пратьянтардаша', `${pd.lord}  (${fmtDate(pd.start)} – ${fmtDate(pd.end)})`, y, {
            highlight: isCurrentPD, fontSize: 9.5
          });
        }
        y += 6;
      }
    }

    // Номера страниц
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(COLORS.inkSoft).font('sans').fontSize(9)
        .text(`${i + 1} / ${pageCount}`, 0, doc.page.height - 40, { align: 'center', width: doc.page.width });
    }

    doc.end();
  });
}

module.exports = { buildDashaPDF };
