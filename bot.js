// ============================================================
// Jyotish Telegram Bot — сбор данных рождения в диалоге,
// расчёт натальной карты, отправка карты картинкой.
// ============================================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const sharp = require('sharp');
const { calculateChart } = require('./engine.js');
const { renderNorthIndianPNG, renderNorthIndianWithTransitsPNG, renderSouthIndianPNG, renderDivisionalPNG } = require('./chart-canvas.js');
const { calculateNavamsha } = require('./navamsha.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computePanchanga } = require('./panchanga.js');
const { buildDashaPDF } = require('./dasha-pdf.js');
const { resolveCity } = require('./ru-timezone.js');
const { resolveWorldCity } = require('./world-geocoding.js');
const { withLogo } = require('./branding.js');
const db = require('./database.js');

// ID администратора (тебя) для команды /broadcast — задаётся переменной окружения ADMIN_ID
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

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

// Проверка "аварийного выхода": если внутри любого шага любого мастера
// человек написал /start, /menu или нажал «☰ Меню» — выходим из сцены
// и показываем главное меню, вместо того чтобы упорно ждать первоначальный вопрос.
async function checkGlobalEscape(ctx) {
  const text = (ctx.message && ctx.message.text || '').trim().toLowerCase();
  if (text === '/start' || text === '/menu' || text === '☰ меню') {
    await ctx.scene.leave();
    await sendMainMenu(ctx);
    return true;
  }
  return false;
}

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
    if (await checkGlobalEscape(ctx)) return;
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
    if (await checkGlobalEscape(ctx)) return;
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
    if (await checkGlobalEscape(ctx)) return;
    let lat, lon, tz, placeLabel;

    const parts = text.split(',').map(s => s.trim());
    const asNumbers = parts.length === 3 ? parts.map(Number) : null;

    if (asNumbers && !asNumbers.some(isNaN)) {
      [lat, lon, tz] = asNumbers;
      placeLabel = `широта ${lat}, долгота ${lon}`;
    } else {
      // Сначала пробуем найти город в базе России (точная историческая таблица)
      const bd = ctx.wizard.state.birthData;
      const dateUTCForTz = new Date(Date.UTC(bd.year, bd.month - 1, bd.day, 12, 0, 0));
      let found = resolveCity(text, dateUTCForTz);

      if (found) {
        lat = found.lat; lon = found.lon; tz = found.utcOffset;
        placeLabel = `${found.city} (${lat}, ${lon})`;
        await ctx.reply(`Нашла: ${found.city}, часовой пояс на эту дату — UTC${tz >= 0 ? '+' : ''}${tz}`);
      } else {
        // Если не нашли в российской базе — ищем по всему миру
        await ctx.reply('Ищу город...');
        const worldFound = await resolveWorldCity(text, dateUTCForTz);
        if (!worldFound) {
          await ctx.reply(
            'Не нашла такой город и не смогла распознать координаты.\n\n' +
            'Попробуйте название точнее (можно с указанием страны, например "Париж, Франция"), ' +
            'либо введите координаты: широта, долгота, часовой пояс.'
          );
          return;
        }
        lat = worldFound.lat; lon = worldFound.lon; tz = worldFound.utcOffset;
        placeLabel = worldFound.city;
        await ctx.reply(`Нашла: ${worldFound.city}\nЧасовой пояс (${worldFound.timezone}) на эту дату — UTC${tz >= 0 ? '+' : ''}${tz}`);
      }
    }

    const bd = ctx.wizard.state.birthData;
    const params = {
      day: bd.day, month: bd.month, year: bd.year,
      hour: bd.hour, minute: bd.minute, second: 0,
      utcOffset: tz, lat, lon, ayanamshaType: 'lahiri', placeLabel
    };

    await ctx.reply('Считаю карту...');

    try {
      const chart = calculateChart(params);
      const dateStr = `${String(bd.day).padStart(2,'0')}.${String(bd.month).padStart(2,'0')}.${bd.year}`;
      const timeStr = `${String(bd.hour).padStart(2,'0')}:${String(bd.minute).padStart(2,'0')}`;
      const subtitle = `${dateStr}, ${timeStr} · ${placeLabel}`;

      let pngBuffer = renderNorthIndianPNG(chart, { title: 'Натальная карта', subtitle });
    pngBuffer = await withLogo(pngBuffer);

      const moonSign = chart.planets['Луна'].sign;
      const userName = ctx.from && ctx.from.first_name;
      const namePrefix = userName ? `${userName}, вот ваша карта:\n\n` : '';
      const caption =
        namePrefix +
        `🌕 Восходящий знак (Лагна): ${chart.ascendant.sign.name} ${chart.ascendant.sign.degInSign.toFixed(1)}°\n` +
        `🌙 Луна: ${moonSign.name}, накшатра ${chart.planets['Луна'].nakshatra.name} (пада ${chart.planets['Луна'].nakshatra.pada})\n` +
        `☀️ Аянамша (Лахири): ${chart.ayanamsha.toFixed(2)}°\n\n` +
        `Теперь можно посмотреть периоды жизни или текущие транзиты — кнопками ниже или командами /dasha и /transits.\n\n` +
        `✨ Джанма Кундали — t.me/janma_kundali_bot`;

      // Сохраняем для последующих команд /dasha и /transits, и для переключения стиля карты
      const birthDateUTC = new Date(Date.UTC(bd.year, bd.month - 1, bd.day, bd.hour, bd.minute, 0) - tz * 3600 * 1000);
      userCharts.set(ctx.from.id, { params, chart, birthDateUTC, dateStr, timeStr, subtitle, style: 'north' });

      const editingChartId = ctx.scene.state && ctx.scene.state.editingChartId;
      if (editingChartId) {
        db.updateChart(ctx.from.id, editingChartId, params, placeLabel);
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('📜 Периоды жизни', 'menu_dasha'), Markup.button.callback('🔄 Транзиты', 'menu_transits')],
          [Markup.button.callback('🔯 Навамша', 'menu_navamsha')],
          [Markup.button.callback('📝 Заметки', `notes_${editingChartId}`), Markup.button.callback('🗑 Удалить', `delask_${editingChartId}`)],
        ]);
        await ctx.replyWithPhoto({ source: pngBuffer }, { caption: `✏️ Данные обновлены.\n\n${caption}`, ...keyboard });
        return ctx.scene.leave();
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('◆ Северный стиль ✓', 'style_north'), Markup.button.callback('▦ Южный стиль', 'style_south')],
        [Markup.button.callback('📜 Периоды жизни', 'menu_dasha'), Markup.button.callback('🔄 Транзиты', 'menu_transits')],
        [Markup.button.callback('💾 Сохранить', 'save_chart'), Markup.button.callback('📁 Архив', 'menu_archive')],
        [Markup.button.callback('🔯 Навамша', 'menu_navamsha')],
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
      await ctx.reply('Сначала постройте карту — кнопка «🌟 Построить карту» выше, либо команда /chart. Транзиты считаются относительно неё.');
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
    if (await checkGlobalEscape(ctx)) return;
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
    if (await checkGlobalEscape(ctx)) return;
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
    if (await checkGlobalEscape(ctx)) return;
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
        let found = resolveCity(text, dateForTz);
        if (found) {
          place = { lat: found.lat, lon: found.lon, tz: found.utcOffset, label: found.city };
        } else {
          await ctx.reply('Ищу город...');
          const worldFound = await resolveWorldCity(text, dateForTz);
          if (!worldFound) {
            await ctx.reply('Не нашла такой город и не смогла распознать координаты. Попробуйте точнее, либо введите координаты: широта, долгота, часовой пояс.');
            return;
          }
          place = { lat: worldFound.lat, lon: worldFound.lon, tz: worldFound.utcOffset, label: worldFound.city };
        }
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

    let pngBuffer = renderNorthIndianWithTransitsPNG(chart, transits, {
      title: 'Транзиты',
      subtitle
    });
    pngBuffer = await withLogo(pngBuffer);

    const caption =
      `Транзитные планеты показаны рядом с натальными (приглушённый серо-синий цвет), в тех же домах.\n\n` +
      `Все планеты видны одинаково из любой точки Земли — место здесь только помогает верно перевести время суток.\n\n` +
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
    if (await checkGlobalEscape(ctx)) return;
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
    if (await checkGlobalEscape(ctx)) return;
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
        let found = resolveCity(text, dateForTz);
        if (found) {
          lat = found.lat; lon = found.lon; tz = found.utcOffset;
        } else {
          await ctx.reply('Ищу город...');
          const worldFound = await resolveWorldCity(text, dateForTz);
          if (!worldFound) {
            await ctx.reply('Не нашла такой город и не смогла распознать координаты. Попробуйте точнее, либо введите координаты: широта, долгота, часовой пояс.');
            return;
          }
          lat = worldFound.lat; lon = worldFound.lon; tz = worldFound.utcOffset;
        }
      }
    }

    try {
      const p = computePanchanga(pd.year, pd.month, pd.day, 12, 0, lat, lon, tz);

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

// ---------- Wizard scene: сохранение карты в архив (спросить имя) ----------
const saveChartWizard = new Scenes.WizardScene(
  'save-chart-wizard',

  async (ctx) => {
    const stored = userCharts.get(ctx.from.id);
    if (!stored) {
      await ctx.reply('Сначала постройте карту — кнопка «🌟 Построить карту», либо команда /chart.');
      return ctx.scene.leave();
    }
    await ctx.reply('Как назвать эту карту в архиве? (например: имя человека)');
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (await checkGlobalEscape(ctx)) return;
    const label = (ctx.message && ctx.message.text || '').trim();
    if (!label) {
      await ctx.reply('Напишите короткое название текстом.');
      return;
    }
    const stored = userCharts.get(ctx.from.id);
    if (!stored) {
      await ctx.reply('Карта потерялась — постройте заново через /chart.');
      return ctx.scene.leave();
    }
    try {
      const chartId = db.saveChart(ctx.from.id, label, stored.params, stored.params.placeLabel);
      await ctx.reply(
        `Сохранено как «${label}» — теперь доступно в 📁 Архиве.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('☆ В избранное', `fav_${chartId}`), Markup.button.callback('📝 Заметки', `notes_${chartId}`)],
        ])
      );
    } catch (e) {
      console.error(e);
      await ctx.reply('Не получилось сохранить: ' + e.message);
    }
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([birthDataWizard, transitWizard, panchangaWizard, saveChartWizard]);
bot.use(session());
bot.use(stage.middleware());
bot.use((ctx, next) => {
  try { db.upsertUser(ctx); } catch (e) { console.error('Ошибка сохранения пользователя:', e.message); }
  return next();
});

// ---------- Commands ----------
const WEBAPP_URL = process.env.WEBAPP_URL; // публичный HTTPS-адрес мини-приложения (задаётся в Railway)

const mainMenuButtons = [
  [Markup.button.callback('🌟 Построить карту', 'menu_chart')],
  [Markup.button.callback('📜 Периоды жизни', 'menu_dasha'), Markup.button.callback('🔄 Транзиты', 'menu_transits')],
  [Markup.button.callback('📅 Панчанга', 'menu_panchanga'), Markup.button.callback('📁 Архив', 'menu_archive')],
  [Markup.button.callback('🔯 Навамша', 'menu_navamsha')],
];
if (WEBAPP_URL) {
  mainMenuButtons.push([Markup.button.webApp('🌐 Открыть приложение', WEBAPP_URL)]);
}
const mainMenuKeyboard = Markup.inlineKeyboard(mainMenuButtons);

// Постоянная кнопка внизу экрана (не пропадает, в отличие от кнопок под сообщениями) —
// нажатие всегда возвращает в главное меню, даже если бот "завис" посреди диалога.
const persistentKeyboard = Markup.keyboard([['☰ Меню']]).resize();

function welcomeTextFor(ctx) {
  const name = ctx.from && ctx.from.first_name;
  const greeting = name ? `${name}, добро пожаловать` : 'Добро пожаловать';
  return (
    `${greeting} в Джанма Кундали — пространство точных расчётов джйотиш от Katya Das.\n\n` +
    'Здесь вы можете построить свою натальную карту, рассчитать периоды и транзиты, а также ' +
    'смотреть панчангу дня, чтобы следить за звёздной динамикой.\n\n' +
    'Нажмите «Построить карту», чтобы начать.'
  );
}

async function sendMainMenu(ctx) {
  await ctx.reply(welcomeTextFor(ctx), { reply_markup: mainMenuKeyboard.reply_markup });
  await ctx.reply('Кнопка «☰ Меню» внизу всегда вернёт сюда.', persistentKeyboard);
}

bot.start(async (ctx) => { await sendMainMenu(ctx); });

// Универсальный выход: если человек застрял посреди любого диалога (мастера),
// команды /start, /menu или нажатие «☰ Меню» должны сработать в любой момент.
bot.hears('☰ Меню', async (ctx) => {
  if (ctx.scene && ctx.scene.current) await ctx.scene.leave();
  await sendMainMenu(ctx);
});
bot.command('menu', async (ctx) => {
  if (ctx.scene && ctx.scene.current) await ctx.scene.leave();
  await sendMainMenu(ctx);
});

const startChartWizard = (ctx) => ctx.scene.enter('birth-data-wizard');
bot.command('chart', startChartWizard);
bot.action('menu_chart', async (ctx) => { await ctx.answerCbQuery(); return startChartWizard(ctx); });

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
    let pngBuffer = style === 'south'
      ? renderSouthIndianPNG(chart, { title: 'Натальная карта', subtitle })
      : renderNorthIndianPNG(chart, { title: 'Натальная карта', subtitle });
    pngBuffer = await withLogo(pngBuffer);

    stored.style = style;
    userCharts.set(ctx.from.id, stored);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(style === 'north' ? '◆ Северный стиль ✓' : '◆ Северный стиль', 'style_north'),
       Markup.button.callback(style === 'south' ? '▦ Южный стиль ✓' : '▦ Южный стиль', 'style_south')],
      [Markup.button.callback('📜 Периоды жизни', 'menu_dasha'), Markup.button.callback('🔄 Транзиты', 'menu_transits')],
      [Markup.button.callback('💾 Сохранить', 'save_chart'), Markup.button.callback('📁 Архив', 'menu_archive')],
        [Markup.button.callback('🔯 Навамша', 'menu_navamsha')],
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

async function sendDashaReport(ctx) {
  const stored = userCharts.get(ctx.from.id);
  if (!stored) {
    await ctx.reply('Сначала постройте карту — кнопка «🌟 Построить карту» выше, либо команда /chart. Периоды считаются от неё.');
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
}
bot.command('dasha', sendDashaReport);
bot.action('menu_dasha', async (ctx) => { await ctx.answerCbQuery(); return sendDashaReport(ctx); });

const startTransitWizard = (ctx) => ctx.scene.enter('transit-wizard');
bot.command('transits', startTransitWizard);
bot.action('menu_transits', async (ctx) => { await ctx.answerCbQuery(); return startTransitWizard(ctx); });

const startPanchangaWizard = (ctx) => ctx.scene.enter('panchanga-wizard');
bot.command('panchanga', startPanchangaWizard);
bot.action('menu_panchanga', async (ctx) => { await ctx.answerCbQuery(); return startPanchangaWizard(ctx); });

// ---------- Сохранение и архив карт ----------
bot.action('save_chart', async (ctx) => { await ctx.answerCbQuery(); return ctx.scene.enter('save-chart-wizard'); });

async function showArchive(ctx) {
  const charts = db.listCharts(ctx.from.id);
  if (charts.length === 0) {
    await ctx.reply('Архив пуст — постройте карту и нажмите «💾 Сохранить».');
    return;
  }
  const buttons = charts.map(c => [Markup.button.callback(
    `${c.is_favorite ? '⭐ ' : ''}${c.label} (${String(c.day).padStart(2,'0')}.${String(c.month).padStart(2,'0')}.${c.year})`,
    `open_chart_${c.id}`
  )]);
  await ctx.reply('Ваш архив карт:', Markup.inlineKeyboard(buttons));
}
bot.command('archive', showArchive);
bot.action('menu_archive', async (ctx) => { await ctx.answerCbQuery(); return showArchive(ctx); });

async function sendNavamsha(ctx) {
  const stored = userCharts.get(ctx.from.id);
  if (!stored) {
    await ctx.reply('Сначала постройте карту — кнопка «🌟 Построить карту» выше, либо команда /chart. Навамша считается от неё.');
    return;
  }
  try {
    const d9 = calculateNavamsha(stored.chart);
    let pngBuffer = renderDivisionalPNG(d9, { title: 'Навамша (D9)', subtitle: stored.subtitle });
    pngBuffer = await withLogo(pngBuffer);
    await ctx.replyWithPhoto({ source: pngBuffer }, {
      caption: '🔯 Навамша (D9) — дробная карта, традиционно связана с браком, дхармой и внутренней силой планет. Накшатры и градусы в дробных картах не показываются — здесь важны только знак, дом и достоинство.'
    });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при расчёте навамши: ' + e.message);
  }
}
bot.command('navamsha', sendNavamsha);
bot.action('menu_navamsha', async (ctx) => { await ctx.answerCbQuery(); return sendNavamsha(ctx); });

bot.action(/^open_chart_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Открываю...');
  const chartId = Number(ctx.match[1]);
  const row = db.getChart(ctx.from.id, chartId);
  if (!row) {
    await ctx.reply('Карта не найдена — возможно, была удалена.');
    return;
  }
  try {
    const params = {
      day: row.day, month: row.month, year: row.year, hour: row.hour, minute: row.minute, second: 0,
      utcOffset: row.utc_offset, lat: row.lat, lon: row.lon, ayanamshaType: 'lahiri'
    };
    const chart = calculateChart(params);
    const dateStr = `${String(row.day).padStart(2,'0')}.${String(row.month).padStart(2,'0')}.${row.year}`;
    const timeStr = `${String(row.hour).padStart(2,'0')}:${String(row.minute).padStart(2,'0')}`;
    const subtitle = `${dateStr}, ${timeStr}` + (row.place_label ? ` · ${row.place_label}` : '');

    let pngBuffer = renderNorthIndianPNG(chart, { title: row.label, subtitle });
    pngBuffer = await withLogo(pngBuffer);

    const birthDateUTC = new Date(Date.UTC(row.year, row.month - 1, row.day, row.hour, row.minute, 0) - row.utc_offset * 3600 * 1000);
    userCharts.set(ctx.from.id, { params, chart, birthDateUTC, dateStr, timeStr, subtitle, style: 'north' });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📜 Периоды жизни', 'menu_dasha'), Markup.button.callback('🔄 Транзиты', 'menu_transits')],
      [Markup.button.callback('🔯 Навамша', 'menu_navamsha')],
      [Markup.button.callback(row.is_favorite ? '⭐ В избранном' : '☆ В избранное', `fav_${row.id}`),
       Markup.button.callback('📝 Заметки', `notes_${row.id}`)],
      [Markup.button.callback('✏️ Изменить данные', `edit_chart_${row.id}`),
       Markup.button.callback('🗑 Удалить', `delask_${row.id}`)],
    ]);

    await ctx.replyWithPhoto({ source: pngBuffer }, { caption: `📁 «${row.label}» — открыто из архива.`, ...keyboard });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при открытии карты: ' + e.message);
  }
});

// ---------- Редактирование данных сохранённой карты ----------
bot.action(/^edit_chart_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const chartId = Number(ctx.match[1]);
  const row = db.getChart(ctx.from.id, chartId);
  if (!row) {
    await ctx.reply('Карта не найдена.');
    return;
  }
  await ctx.reply(`Изменяем данные карты «${row.label}».`);
  return ctx.scene.enter('birth-data-wizard', { editingChartId: chartId });
});

// ---------- Удаление с подтверждением (двойной клик, чтобы не удалить случайно) ----------
bot.action(/^delask_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const chartId = Number(ctx.match[1]);
  await ctx.reply('Точно удалить эту карту из архива? Это необратимо.', Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, удалить', `delconfirm_${chartId}`), Markup.button.callback('Отмена', 'delcancel')],
  ]));
});

bot.action(/^delconfirm_(\d+)$/, async (ctx) => {
  const chartId = Number(ctx.match[1]);
  db.deleteChart(ctx.from.id, chartId);
  await ctx.answerCbQuery('Удалено');
  await ctx.editMessageText('Карта удалена из архива.');
});

bot.action('delcancel', async (ctx) => {
  await ctx.answerCbQuery('Отменено');
  await ctx.editMessageText('Удаление отменено.');
});

// ---------- Избранное ----------
bot.action(/^fav_(\d+)$/, async (ctx) => {
  const chartId = Number(ctx.match[1]);
  const newState = db.toggleFavorite(ctx.from.id, chartId);
  if (newState === null) {
    await ctx.answerCbQuery('Карта не найдена');
    return;
  }
  await ctx.answerCbQuery(newState ? 'Добавлено в избранное' : 'Убрано из избранного');
  try {
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        [Markup.button.callback(newState ? '⭐ В избранном' : '☆ В избранное', `fav_${chartId}`),
         Markup.button.callback('📝 Заметки', `notes_${chartId}`)],
      ]).reply_markup
    );
  } catch (e) { /* сообщение могло измениться — не критично */ }
});

// ---------- Заметки к карте ----------
async function showNotes(ctx, chartId) {
  const row = db.getChart(ctx.from.id, chartId);
  if (!row) {
    await ctx.reply('Карта не найдена.');
    return;
  }
  const notes = db.listNotes(chartId);
  let text = `📝 Заметки к «${row.label}»:\n\n`;
  if (notes.length === 0) {
    text += '(пока пусто)';
  } else {
    text += notes.map(n => `• ${n.note}\n  (${n.created_at.slice(0, 10).split('-').reverse().join('.')})`).join('\n\n');
  }
  await ctx.reply(text, Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить заметку', `addnote_${chartId}`)],
  ]));
}

bot.action(/^notes_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return showNotes(ctx, Number(ctx.match[1]));
});

bot.action(/^addnote_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.pendingNoteChartId = Number(ctx.match[1]);
  await ctx.reply('Напишите текст заметки:');
});

// Обрабатываем текст заметки (когда ждём её после нажатия "Добавить заметку")
// Это не сцена-мастер, а простая проверка сессии — чтобы не мешать другим сценам.
bot.on('text', async (ctx, next) => {
  if (ctx.session && ctx.session.pendingNoteChartId && !(ctx.scene && ctx.scene.current)) {
    const chartId = ctx.session.pendingNoteChartId;
    delete ctx.session.pendingNoteChartId;
    const text = ctx.message.text.trim();
    if (text === '☰ Меню' || text === '/menu') return next();
    db.addNote(chartId, text);
    await ctx.reply('Заметка сохранена.');
    return;
  }
  return next();
});


bot.command('broadcast', async (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    return; // тихо игнорируем для всех, кроме администратора
  }
  const text = ctx.message.text.replace(/^\/broadcast\s*/, '').trim();
  if (!text) {
    await ctx.reply('Использование: /broadcast текст сообщения');
    return;
  }
  const userIds = db.getAllUserIds();
  await ctx.reply(`Начинаю рассылку на ${userIds.length} пользователей...`);
  let sent = 0, failed = 0;
  for (const id of userIds) {
    try {
      await bot.telegram.sendMessage(id, text);
      sent++;
    } catch (e) {
      failed++;
    }
    await new Promise(r => setTimeout(r, 50)); // пауза, чтобы не упереться в лимиты Telegram
  }
  await ctx.reply(`Готово: доставлено ${sent}, не удалось ${failed}.`);
});

bot.command('setpremium', async (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    return; // тихо игнорируем для всех, кроме администратора
  }
  // Использование: /setpremium <telegram_id> <дней|off>
  // Например: /setpremium 123456789 30   — выдать Premium на 30 дней
  //           /setpremium 123456789 off  — снять Premium (вернуть на free)
  //           /setpremium 123456789 0    — выдать Premium бессрочно
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  const targetId = Number(parts[0]);
  const arg = (parts[1] || '').toLowerCase();
  if (!targetId || !arg) {
    await ctx.reply('Использование: /setpremium <telegram_id> <дней|off|0>\nПример: /setpremium 123456789 30');
    return;
  }
  if (arg === 'off') {
    db.setTier(targetId, 'free', null);
    await ctx.reply(`Пользователю ${targetId} снят Premium (тариф: free).`);
    return;
  }
  const days = Number(arg);
  if (Number.isNaN(days) || days < 0) {
    await ctx.reply('Количество дней должно быть числом (0 — бессрочно).');
    return;
  }
  const untilISO = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
  db.setTier(targetId, 'premium', untilISO);
  await ctx.reply(days === 0
    ? `Пользователю ${targetId} выдан Premium бессрочно.`
    : `Пользователю ${targetId} выдан Premium до ${untilISO.slice(0, 10)}.`);
  try {
    await bot.telegram.sendMessage(targetId, '✨ Вам открыт доступ к Premium — все дробные карты, безлимитный архив, заметки и избранное уже доступны в приложении.');
  } catch (e) {
    // пользователь мог не запускать бота напрямую — не критично
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Доступные команды:\n' +
    '/chart — построить натальную карту\n' +
    '/dasha — периоды Вимшоттари даша (по последней построенной карте)\n' +
    '/transits — транзиты на выбранную дату, наложенные на натальную карту\n' +
    '/panchanga — панчанга (титхи, накшатра дня, Раху-калам и др.) на любую дату и место\n' +
    '/archive — архив сохранённых карт\n' +
    '/navamsha — дробная карта D9 (Навамша)\n' +
    '/whoami — узнать свой Telegram ID (нужен для настройки администратора)\n' +
    '/help — это сообщение'
  );
});

bot.command('whoami', async (ctx) => {
  await ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
});

bot.launch();
console.log('Бот запущен.');
const { SWISSEPH_AVAILABLE } = require('./engine.js');
console.log(SWISSEPH_AVAILABLE
  ? '✅ Расчёты идут через Swiss Ephemeris (нативный модуль собрался успешно).'
  : '⚠️ Swiss Ephemeris недоступен — используется резервный движок (VSOP87D + Мееус). Проверьте установку зависимостей (npm install) и логи сборки нативных модулей.');

// Запускаем сервер мини-приложения в том же процессе (один сервис на Railway)
const { startWebApp } = require('./webapp.js');
startWebApp();

// Ежедневная проверка уведомлений (Premium): смена подпериода даши,
// заметный день по тара-бале, новый значимый транзит.
const { startNotificationScheduler } = require('./notifications.js');
startNotificationScheduler(bot);
console.log('Планировщик уведомлений запущен.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
