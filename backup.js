// ============================================================
// backup.js — ночная копия базы администратору в Telegram.
//  - копия делается штатным механизмом SQLite (безопасно во время работы);
//  - сжимается (gzip); если задана переменная BACKUP_PASSWORD — ещё и
//    шифруется (AES-256-GCM), тогда файл без пароля не открыть;
//  - раз в сутки (по умолчанию 21:30 UTC = 03:00 по Индии), и по команде /backup.
// Расшифровка и восстановление: node restore-backup.js <файл> <пароль> <куда.db>
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('./database.js');

const MAX_BYTES = 45 * 1024 * 1024; // лимит Telegram для бота — 50 МБ

function encrypt(buf, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  // формат: "JKB1" | salt(16) | iv(12) | tag(16) | данные
  return Buffer.concat([Buffer.from('JKB1'), salt, iv, c.getAuthTag(), enc]);
}

async function makeBackupFile() {
  const tmp = path.join(os.tmpdir(), `jk-backup-${Date.now()}.db`);
  await db.rawDb.backup(tmp);
  const raw = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  let out = zlib.gzipSync(raw);
  const pw = process.env.BACKUP_PASSWORD;
  let encrypted = false;
  if (pw) { out = encrypt(out, pw); encrypted = true; }
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `janma-kundali-${stamp}.db.gz${encrypted ? '.enc' : ''}`;
  return { name, buffer: out, encrypted, users: db.getUserCount() };
}

async function sendBackup(bot, adminId) {
  const b = await makeBackupFile();
  if (b.buffer.length > MAX_BYTES) {
    await bot.telegram.sendMessage(adminId, `Копия базы получилась ${Math.round(b.buffer.length / 1048576)} МБ — больше лимита Telegram. Пора переносить базу на PostgreSQL или хранить копии в облаке.`);
    return false;
  }
  const caption = `Копия базы: ${b.users} пользователей.` + (b.encrypted ? ' Файл зашифрован.' : '\nВНИМАНИЕ: файл не зашифрован. Задай переменную BACKUP_PASSWORD в Railway.');
  await bot.telegram.sendDocument(adminId, { source: b.buffer, filename: b.name }, { caption });
  return true;
}

function startBackupScheduler(bot, adminId, { hourUTC = 21, minuteUTC = 30 } = {}) {
  if (!adminId) return;
  let lastDay = null;
  setInterval(async () => {
    const n = new Date();
    const day = n.toISOString().slice(0, 10);
    if (day === lastDay) return;
    if (n.getUTCHours() < hourUTC || (n.getUTCHours() === hourUTC && n.getUTCMinutes() < minuteUTC)) return;
    lastDay = day;
    try { await sendBackup(bot, adminId); } catch (e) { console.error('Ошибка ночной копии:', e.message); }
  }, 60 * 1000);
}

module.exports = { sendBackup, startBackupScheduler, makeBackupFile };
