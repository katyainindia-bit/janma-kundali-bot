// ============================================================
// Jyotish Telegram Bot — сбор данных рождения в диалоге,
// расчёт натальной карты, отправка карты картинкой.
// ============================================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const sharp = require('sharp');
const { calculateChart } = require('./engine.js');
const { renderNorthIndianSVG, renderNorthIndianSVGWithTransits, renderSouthIndianSVG } = require('./chart-svg.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computePanchanga } = require('./panchanga.js');
const { buildDashaPDF } = require('./dasha-pdf.js');
const { resolveCity } = require('./ru-timezone.js');
const { withLogo } = require('./branding.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Ошибка: не задан BOT_TOKEN. Установите переменную окружения BOT_TOKEN.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Хранилище последней построенной карты по каждому пользователю.
// Внимание: это простое хранилище в памяти процесса — при перезапуске бота
// данные теряются. Для продакшена стоит заменить на файл/базу данных.
const userCharts = new Map();

// ---------- Wizard scene: пошаговый сбор данных рождения ----------
const birthDataWizard = new Scenes.WizardScene(
  'birth-data-wizard',

  // Шаг 1: дата рождения
  async (ctx) => {
    await ctx.reply(
      'Давайте построим натальную карту.\n\nВведите дату рождения в формате ДД.ММ.ГГГГ\nНапример: 15.08.1990'
    );
    return ctx.wizard.next();
  },

  // Шаг 2: парсим дату, спрашиваем время
  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim();
    const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) {
      await ctx.reply('Не удалось распознать дату. Введите в формате ДД.ММ.ГГГГ, например: 15.08.1990');
      return;
    }
    const day = parseInt(m[1]), month = parseInt(m[2]), year = parseInt(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
      await ctx.reply('Проверьте дату — что-то не сходится. Введите ещё раз, например: 15.08.1990');
      return;
    }
    ctx.wizard.state.birthData = { day, month, year };
    await ctx.reply('Введите время рождения в формате ЧЧ:ММ (24-часовой формат)\nНапример: 14:30\n\nЕсли точное время неизвестно, введите примерное.');
    return ctx.wizard.next();
  },

  // Шаг 3: парсим время, спрашиваем город/координаты
  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim();
    const m = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      await ctx.reply('Не удалось распознать время. Введите в формате ЧЧ:ММ, например: 14:30');
      return;
    }
    const hour = parseInt(m[1]), minute = parseInt(m[2]);
    if (hour > 23 || minute > 59) {
      await ctx.reply('Проверьте время — часы 0-23, минуты 0-59. Введите ещё раз.');
      return;
    }
    ctx.wizard.state.birthData.hour = hour;
    ctx.wizard.state.birthData.minute = minute;
    await ctx.reply(
      'Теперь укажите место рождения.\n\n' +
      'Можно просто написать название города (для городов России часовой пояс определится автоматически, ' +
      'с учётом исторических переводов времени на нужную дату) — например: Пермь\n\n' +
      'Либо ввести координаты вручную: широта, долгота, часовой_пояс\n' +
      'Например: 55.7558, 37.6173, 3'
    );
    return ctx.wizard.next();
  },

  // Шаг 4: парсим место (город или координаты), считаем карту
  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim();
    let lat, lon, tz, placeLabel;

    const parts = text.split(',').map(s => s.trim());
    const asNumbers = parts.length === 3 ? parts.map(Number) : null;

    if (asNumbers && !asNumbers.some(isNaN)) {
      [lat, lon, tz] = asNumbers;
      placeLabel = `широта ${lat}, долгота ${lon}`;
    } else {
      // Пробуем найти город по названию
      const bd = ctx.wizard.state.birthData;
      const dateUTCForTz = new Date(Date.UTC(bd.year, bd.month - 1, bd.day, 12, 0, 0));
      const found = resolveCity(text, dateUTCForTz);
      if (!found) {
        await ctx.reply(
          'Не нашла такой город в базе (пока охвачены крупные города России) и не смогла распознать координаты.\n\n' +
          'Попробуйте название города точнее (например "Пермь"), либо введите координаты: широта, долгота, часовой пояс.'
        );
        return;
      }
      lat = found.lat; lon = found.lon; tz = found.utcOffset;
      placeLabel = `${found.city} (${lat}, ${lon})`;
      await ctx.reply(`Нашла: ${found.city}, часовой пояс на эту дату — UTC${tz >= 0 ? '+' : ''}${tz}`);
    }

    const bd = ctx.wizard.state.birthData;
    const params = {
      day: bd.day, month: bd.month, year: bd.year,
      hour: bd.hour, minute: bd.minute, second: 0,
      utcOffset: tz, lat, lon, ayanamshaType: 'lahiri'
    };

    await ctx.reply('Считаю карту...');

    try {
      const chart = calculateChart(params);
      const dateStr = `${String(bd.day).padStart(2,'0')}.${String(bd.month).padStart(2,'0')}.${bd.year}`;
      const timeStr = `${String(bd.hour).padStart(2,'0')}:${String(bd.minute).padStart(2,'0')}`;
      const subtitle = `${dateStr}, ${timeStr} · ${placeLabel}`;

      const svg = renderNorthIndianSVG(chart, { title: 'Натальная карта', subtitle });
      let pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    pngBuffer = await withLogo(pngBuffer);

      const moonSign = chart.planets['Луна'].sign;
      const caption =
        `🌕 Восходящий знак (Лагна): ${chart.ascendant.sign.name} ${chart.ascendant.sign.degInSign.toFixed(1)}°\n` +
        `🌙 Луна: ${moonSign.name}, накшатра ${chart.planets['Луна'].nakshatra.name} (пада ${chart.planets['Луна'].nakshatra.pada})\n` +
        `☀️ Аянамша (Лахири): ${chart.ayanamsha.toFixed(2)}°\n\n` +
        `Whole Sign дома\n\n` +
        `Команды /dasha и /transits теперь работают с этой картой.\n\n` +
        `✨ Джанма Кундали — t.me/janma_kundali_bot`;

      // Сохраняем для последующих команд /dasha и /transits, и для переключения стиля карты
      const birthDateUTC = new Date(Date.UTC(bd.year, bd.month - 1, bd.day, bd.hour, bd.minute, 0) - tz * 3600 * 1000);
      userCharts.set(ctx.from.id, { params, chart, birthDateUTC, dateStr, timeStr, subtitle, style: 'north' });

      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('◆ Северный стиль ✓', 'style_north'),
        Markup.button.callback('▦ Южный стиль', 'style_south'),
      ]);

      await ctx.replyWithPhoto({ source: pngBuffer }, { caption, ...keyboard });
    } catch (e) {
      console.error(e);
      await ctx.reply('Произошла ошибка при расчёте: ' + e.message);
    }

    return ctx.scene.leave();
  }
);

// ---------- Wizard scene: транзиты на выбранную дату, время и место ----------
const transitWizard = new Scenes.WizardScene(
  'transit-wizard',

  // Шаг 1: дата (с быстрым вариантом "сейчас")
  async (ctx) => {
    const stored = userCharts.get(ctx.from.id);
    if (!stored) {
      await ctx.reply('Сначала постройте натальную карту командой /chart — транзиты считаются относительно неё.');
      return ctx.scene.leave();
    }
    ctx.wizard.state.transit = {};
    await ctx.reply(
      'На какую дату посчитать транзиты?\n\n' +
      'Введите дату в формате ДД.ММ.ГГГГ, либо напишите "сейчас" — тогда возьмём точный текущий момент ' +
      'и место рождения из натальной карты.'
    );
    return ctx.wizard.next();
  },

  // Шаг 2: если "сейчас" — сразу считаем; иначе спрашиваем время
  async (ctx) => {
    const stored = userCharts.get(ctx.from.id);
    const text = (ctx.message && ctx.message.text || '').trim().toLowerCase();

    if (text === 'сейчас') {
      const atDate = new Date();
      const place = {
        lat: stored.params.lat,
        lon: stored.params.lon,
        tz: stored.params.utcOffset,
        label: 'место рождения (из натальной карты)'
      };
      return finalizeTransit(ctx, stored, atDate, place);
    }

    const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) {
      await ctx.reply('Не удалось распознать дату. Введите в формате ДД.ММ.ГГГГ или напишите "сейчас".');
      return;
    }
    const day = parseInt(m[1]), month = parseInt(m[2]), year = parseInt(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      await ctx.reply('Проверьте дату — что-то не сходится. Введите ещё раз.');
      return;
    }
    ctx.wizard.state.transit.day = day;
    ctx.wizard.state.transit.month = month;
    ctx.wizard.state.transit.year = year;

    await ctx.reply('Введите время в формате ЧЧ:ММ (24-часовой формат), например: 12:00');
    return ctx.wizard.next();
  },

  // Шаг 3: время, затем спрашиваем место
  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim();
    const m = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      await ctx.reply('Не удалось распознать время. Введите в формате ЧЧ:ММ, например: 12:00');
      return;
    }
    const hour = parseInt(m[1]), minute = parseInt(m[2]);
    if (hour > 23 || minute > 59) {
      await ctx.reply('Проверьте время — часы 0-23, минуты 0-59. Введите ещё раз.');
      return;
    }
    ctx.wizard.state.transit.hour = hour;
    ctx.wizard.state.transit.minute = minute;

    await ctx.reply(
      'Укажите место для расчёта: город (для России — определим часовой пояс автоматически) ' +
      'или координаты: широта, долгота, часовой пояс.\n\n' +
      'Или напишите "натал" — тогда возьмём место рождения из натальной карты.\n\n' +
      'Например: Пермь, либо 55.7558, 37.6173, 3'
    );
    return ctx.wizard.next();
  },

  // Шаг 4: место — считаем и присылаем
  async (ctx) => {
    const stored = userCharts.get(ctx.from.id);
    const text = (ctx.message && ctx.message.text || '').trim();
    const textLower = text.toLowerCase();
    const td = ctx.wizard.state.transit;

    let place;
    if (textLower === 'натал') {
      place = {
        lat: stored.params.lat,
        lon: stored.params.lon,
        tz: stored.params.utcOffset,
        label: 'место рождения (из натальной карты)'
      };
    } else {
      const parts = text.split(',').map(s => s.trim());
      const asNumbers = parts.length === 3 ? parts.map(Number) : null;
      if (asNumbers && !asNumbers.some(isNaN)) {
        const [lat, lon, tz] = asNumbers;
        place = { lat, lon, tz, label: `широта ${lat}, долгота ${lon}` };
      } else {
        const dateForTz = new Date(Date.UTC(td.year, td.month - 1, td.day, 12, 0, 0));
        const found = resolveCity(text, dateForTz);
        if (!found) {
          await ctx.reply('Не нашла такой город и не смогла распознать координаты. Попробуйте точнее, либо введите координаты: широта, долгота, часовой пояс.');
          return;
        }
        place = { lat: found.lat, lon: found.lon, tz: found.utcOffset, label: found.city };
      }
    }

    const atDate = new Date(
      Date.UTC(td.year, td.month - 1, td.day, td.hour, td.minute, 0) - place.tz * 3600 * 1000
    );

    return finalizeTransit(ctx, stored, atDate, place);
  }
);

// Общая функция для завершения расчёта транзита (используется и для "сейчас", и для явной даты)
async function finalizeTransit(ctx, stored, atDate, place) {
  await ctx.reply('Считаю транзиты...');
  try {
    const { chart } = stored;
    const transits = computeCurrentTransits(chart, atDate);

    const dateLabel = atDate.toISOString().slice(0, 10).split('-').reverse().join('.');
    const timeLabel = atDate.toISOString().slice(11, 16);
    const subtitle = `${dateLabel}, ${timeLabel} UTC · ${place.label}`;

    const svg = renderNorthIndianSVGWithTransits(chart, transits, {
      title: 'Транзиты',
      subtitle
    });
    let pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    pngBuffer = await withLogo(pngBuffer);

    const caption =
      `Транзитные планеты показаны рядом с натальными (приглушённый серо-синий цвет), в тех же домах.\n\n` +
      `Обратите внимание: сама долгота планет одинакова в любой точке Земли в данный момент — ` +
      `место здесь используется для перевода введённого времени в UTC и пока не влияет на положение планет.\n\n` +
      `✨ Джанма Кундали — t.me/janma_kundali_bot`;

    await ctx.replyWithPhoto({ source: pngBuffer }, { caption });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при расчёте транзитов: ' + e.message);
  }
  return ctx.scene.leave();
}

// ---------- Wizard scene: панчанга на дату и место (не требует натальной карты) ----------
const panchangaWizard = new Scenes.WizardScene(
  'panchanga-wizard',

  async (ctx) => {
    await ctx.reply(
      'На какую дату посчитать панчангу?\n\n' +
      'Введите дату в формате ДД.ММ.ГГГГ, либо напишите "сегодня".'
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim().toLowerCase();
    let day, month, year;

    if (text === 'сегодня') {
      const now = new Date();
      day = now.getUTCDate(); month = now.getUTCMonth() + 1; year = now.getUTCFullYear();
    } else {
      const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!m) {
        await ctx.reply('Не удалось распознать дату. Введите в формате ДД.ММ.ГГГГ или напишите "сегодня".');
        return;
      }
      day = parseInt(m[1]); month = parseInt(m[2]); year = parseInt(m[3]);
      if (day < 1 || day > 31 || month < 1 || month > 12) {
        await ctx.reply('Проверьте дату — что-то не сходится. Введите ещё раз.');
        return;
      }
    }
    ctx.wizard.state.panchanga = { day, month, year };

    const stored = userCharts.get(ctx.from.id);
    const hint = stored ? ' Либо напишите "натал" — возьмём место рождения из вашей натальной карты.' : '';
    await ctx.reply(
      'Укажите место: город (для России — автоматически) или координаты: широта, долгота, часовой пояс.\n' +
      'Например: Пермь' + hint
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const text = (ctx.message && ctx.message.text || '').trim();
    const textLower = text.toLowerCase();
    const pd = ctx.wizard.state.panchanga;
    let lat, lon, tz;

    if (textLower === 'натал') {
      const stored = userCharts.get(ctx.from.id);
      if (!stored) {
        await ctx.reply('Натальная карта не найдена — постройте её командой /chart, либо введите координаты вручную.');
        return;
      }
      lat = stored.params.lat; lon = stored.params.lon; tz = stored.params.utcOffset;
    } else {
      const parts = text.split(',').map(s => s.trim());
      const asNumbers = parts.length === 3 ? parts.map(Number) : null;
      if (asNumbers && !asNumbers.some(isNaN)) {
        [lat, lon, tz] = asNumbers;
      } else {
        const dateForTz = new Date(Date.UTC(pd.year, pd.month - 1, pd.day, 12, 0, 0));
        const found = resolveCity(text, dateForTz);
        if (!found) {
          await ctx.reply('Не нашла такой город и не смогла распознать координаты. Попробуйте точнее, либо введите координаты: широта, долгота, часовой пояс.');
          return;
        }
        lat = found.lat; lon = found.lon; tz = found.utcOffset;
      }
    }

    try {
      const p = computePanchanga(pd.year, pd.month, pd.day, lat, lon, tz);

      if (p.sunError) {
        await ctx.reply(`${p.date}\n\n${p.sunError}`);
        return ctx.scene.leave();
      }

      const text =
        `📅 *Панчанга на ${p.date}*\n` +
        `Широта ${lat}, долгота ${lon}, UTC${tz >= 0 ? '+' : ''}${tz}\n\n` +
        `*Вара:* ${p.vara}\n` +
        `*Титхи:* ${p.tithi.name} (№${p.tithi.number}, ${p.tithi.paksha})\n` +
        `*Накшатра дня (Луна):* ${p.nakshatraOfDay}\n` +
        `*Йога:* ${p.yoga.name}\n` +
        `*Карана:* ${p.karana.name}\n\n` +
        `🌅 Восход: ${p.sunrise}   🌇 Закат: ${p.sunset}\n\n` +
        `⚠️ *Раху-калам:* ${p.rahuKalam.start}–${p.rahuKalam.end}\n` +
        `*Ямаганда:* ${p.yamaganda.start}–${p.yamaganda.end}\n` +
        `*Гулика-калам:* ${p.gulikaKalam.start}–${p.gulikaKalam.end}`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(e);
      await ctx.reply('Ошибка при расчёте панчанги: ' + e.message);
    }

    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([birthDataWizard, transitWizard, panchangaWizard]);
bot.use(session());
bot.use(stage.middleware());

// ---------- Commands ----------
bot.start(async (ctx) => {
  await ctx.reply(
    'Здравствуйте! Я бот для расчёта натальной карты по системе джйотиш (ведическая астрология).\n\n' +
    'Команда /chart — построить карту\n' +
    'Whole Sign дома, аянамша Лахири, North Indian стиль отображения.'
  );
});

bot.command('chart', (ctx) => ctx.scene.enter('birth-data-wizard'));

// ---------- Переключение стиля карты (Северный / Южный) по кнопкам под фото ----------
async function switchChartStyle(ctx, style) {
  const stored = userCharts.get(ctx.from.id);
  if (!stored) {
    await ctx.answerCbQuery('Карта не найдена — постройте новую через /chart');
    return;
  }
  if (stored.style === style) {
    await ctx.answerCbQuery('Уже выбран этот стиль');
    return;
  }

  await ctx.answerCbQuery('Перерисовываю...');
  try {
    const { chart, subtitle } = stored;
    const svg = style === 'south'
      ? renderSouthIndianSVG(chart, { title: 'Натальная карта', subtitle })
      : renderNorthIndianSVG(chart, { title: 'Натальная карта', subtitle });
    let pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    pngBuffer = await withLogo(pngBuffer);

    stored.style = style;
    userCharts.set(ctx.from.id, stored);

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(style === 'north' ? '◆ Северный стиль ✓' : '◆ Северный стиль', 'style_north'),
      Markup.button.callback(style === 'south' ? '▦ Южный стиль ✓' : '▦ Южный стиль', 'style_south'),
    ]);

    await ctx.editMessageMedia(
      { type: 'photo', media: { source: pngBuffer } },
      { reply_markup: keyboard.reply_markup }
    );
  } catch (e) {
    console.error(e);
    await ctx.answerCbQuery('Ошибка при перерисовке');
  }
}

bot.action('style_north', (ctx) => switchChartStyle(ctx, 'north'));
bot.action('style_south', (ctx) => switchChartStyle(ctx, 'south'));

bot.command('dasha', async (ctx) => {
  const stored = userCharts.get(ctx.from.id);
  if (!stored) {
    await ctx.reply('Сначала постройте карту командой /chart — периоды считаются от неё.');
    return;
  }
  const { chart, birthDateUTC, dateStr, timeStr } = stored;
  const mahadashas = computeVimshottariDasha(chart, birthDateUTC);
  const chain = findCurrentDashaChain(mahadashas, new Date());

  await ctx.reply('Формирую PDF-отчёт по периодам...');
  try {
    const pdfBuffer = await buildDashaPDF({ dateStr, timeStr, mahadashas, chain });
    await ctx.replyWithDocument(
      { source: pdfBuffer, filename: `Даши_${dateStr.replace(/\./g, '-')}.pdf` },
      { caption: '📜 Периоды Вимшоттари даша — текущий период, все махадаши жизни, антардаши и пратьянтардаши.' }
    );
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при формировании PDF: ' + e.message);
  }
});

bot.command('transits', (ctx) => ctx.scene.enter('transit-wizard'));
bot.command('panchanga', (ctx) => ctx.scene.enter('panchanga-wizard'));

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Доступные команды:\n' +
    '/chart — построить натальную карту\n' +
    '/dasha — периоды Вимшоттари даша (по последней построенной карте)\n' +
    '/transits — транзиты на выбранную дату, наложенные на натальную карту\n' +
    '/panchanga — панчанга (титхи, накшатра дня, Раху-калам и др.) на любую дату и место\n' +
    '/help — это сообщение'
  );
});

bot.launch();
console.log('Бот запущен.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
