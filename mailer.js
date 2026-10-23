// ============================================================
// mailer.js — отправка писем с кодом входа.
// Провайдер: Unisender Go (транзакционные письма). Переменные окружения:
//   UNISENDER_API_KEY, MAIL_FROM_EMAIL (адрес, подтверждённый в Unisender),
//   MAIL_FROM_NAME (необязательно), MAIL_API_URL (необязательно, если адрес API другой).
// Без ключа код пишется в лог сервера (для проверки до подключения почты).
// ============================================================
const API_URL = process.env.MAIL_API_URL || 'https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json';

async function sendLoginCode(email, code) {
  const key = process.env.UNISENDER_API_KEY;
  const from = process.env.MAIL_FROM_EMAIL;
  if (!key || !from) {
    console.log(`[mail] Почта не настроена. Код для ${email}: ${code}`);
    return { dev: true };
  }
  const subject = `Код для входа: ${code}`;
  const text = `Ваш код для входа в Janma Kundali: ${code}\n\nКод действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2b2623"><p>Ваш код для входа в Janma Kundali:</p><p style="font-size:28px;letter-spacing:4px;font-weight:bold">${code}</p><p style="color:#7a6f66;font-size:13px">Код действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.</p></div>`;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({
      message: {
        recipients: [{ email }],
        subject,
        from_email: from,
        from_name: process.env.MAIL_FROM_NAME || 'Janma Kundali',
        body: { html, plaintext: text },
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Почтовый сервис отклонил отправку: ' + res.status + ' ' + t.slice(0, 200));
  }
  return { ok: true };
}

module.exports = { sendLoginCode };
