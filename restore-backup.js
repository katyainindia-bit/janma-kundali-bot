// Расшифровка копии базы.  node restore-backup.js <файл .gz или .gz.enc> <пароль или -> <куда.db>
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const [file, password, out] = process.argv.slice(2);
if (!file || !out) { console.log('Использование: node restore-backup.js <файл> <пароль или -> <куда.db>'); process.exit(1); }
let buf = fs.readFileSync(file);
if (buf.slice(0, 4).toString() === 'JKB1') {
  if (!password || password === '-') { console.log('Файл зашифрован — нужен пароль.'); process.exit(1); }
  const salt = buf.slice(4, 20), iv = buf.slice(20, 32), tag = buf.slice(32, 48), data = buf.slice(48);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(password, salt, 32), iv);
  d.setAuthTag(tag);
  try { buf = Buffer.concat([d.update(data), d.final()]); } catch (e) { console.log('Неверный пароль или файл повреждён.'); process.exit(1); }
}
fs.writeFileSync(out, zlib.gunzipSync(buf));
console.log('Готово:', out);
