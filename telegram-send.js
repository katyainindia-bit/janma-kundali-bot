// ============================================================
// telegram-send.js — отправка сообщения с уважением к лимиту скорости
// Telegram (429 Too Many Requests).
//
// Раньше рассылка (/broadcast) и ежедневные уведомления ловили ЛЮБУЮ
// ошибку отправки одинаково — заблокировал бота пользователь (403,
// навсегда) или Telegram попросил притормозить (429, временно) — и просто
// шли дальше с одной и той же паузой в 50 мс. При 429 это только усугубляет
// проблему: пачка сообщений продолжает валиться с той же скоростью, вместо
// того чтобы выждать ровно столько, сколько просит Telegram (retry_after).
// ============================================================

/**
 * Отправляет одно сообщение. При 429 ждёт ровно retry_after (с запасом)
 * и пробует ещё раз, до maxRetries попыток. Прочие ошибки (заблокировал
 * бота, некорректный chat_id и т.п.) пробрасываются как есть — их не
 * имеет смысла повторять.
 */
async function sendMessageWithBackoff(bot, chatId, text, extra, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await bot.telegram.sendMessage(chatId, text, extra);
    } catch (e) {
      const retryAfterSec = e && e.response && e.response.error_code === 429
        ? (e.response.parameters && e.response.parameters.retry_after)
        : null;
      if (retryAfterSec && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, (retryAfterSec + 1) * 1000));
        continue;
      }
      throw e;
    }
  }
}

module.exports = { sendMessageWithBackoff };
