// ============================================================
// branding.js — наложение логотипа Katya Das на готовые PNG-изображения
// (натальная карта, транзиты) поверх места, оставленного в шапке.
// ============================================================

const sharp = require('sharp');
const path = require('path');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo-ink.png');
const LOGO_WIDTH = 65;
const LOGO_TOP = 18;
const LOGO_LEFT = 50;

/**
 * Накладывает логотип слева в шапке изображения.
 * @param {Buffer} pngBuffer - готовое PNG-изображение карты
 * @returns {Promise<Buffer>}
 */
async function withLogo(pngBuffer) {
  try {
    const logo = await sharp(LOGO_PATH).resize({ width: LOGO_WIDTH }).toBuffer();
    return await sharp(pngBuffer)
      .composite([{ input: logo, top: LOGO_TOP, left: LOGO_LEFT }])
      .png()
      .toBuffer();
  } catch (e) {
    console.error('Не удалось наложить логотип:', e.message);
    return pngBuffer; // при ошибке отдаём картинку без логотипа, не ломаем весь ответ
  }
}

module.exports = { withLogo, LOGO_PATH };
