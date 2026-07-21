// ============================================================
// webapp.js — сервер Telegram Mini App, запускается в том же
// процессе, что и сам бот (один сервис на Railway, без лишних затрат).
// ============================================================

const express = require('express');
const path = require('path');

const { calculateChart } = require('./engine.js');
const { computeVimshottariDasha, findCurrentDashaChain } = require('./dasha.js');
const { computeCurrentTransits } = require('./transits.js');
const { computePanchanga } = require('./panchanga.js');
const { calculateNavamsha } = require('./navamsha.js');
const { resolveCity } = require('./ru-timezone.js');
const { resolveWorldCity } = require('./world-geocoding.js');

function startWebApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/geocode', async (req, res) => {
    try {
      const { city, day, month, year } = req.body;
      const dateForTz = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      let found = resolveCity(city, dateForTz);
      if (!found) {
        const world = await resolveWorldCity(city, dateForTz);
        if (world) found = { city: world.city, lat: world.lat, lon: world.lon, utcOffset: world.utcOffset };
      }
      if (!found) return res.status(404).json({ error: 'Город не найден' });
      res.json(found);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chart', (req, res) => {
    try {
      const { day, month, year, hour, minute, lat, lon, utcOffset, ayanamshaType } = req.body;
      const params = { day, month, year, hour, minute, second: 0, utcOffset, lat, lon, ayanamshaType: ayanamshaType || 'lahiri' };
      const chart = calculateChart(params);
      res.json({ chart, params });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/dasha', (req, res) => {
    try {
      const { chart, birthDateUTC } = req.body;
      const mahadashas = computeVimshottariDasha(chart, new Date(birthDateUTC));
      const chain = findCurrentDashaChain(mahadashas, new Date());
      res.json({ mahadashas, chain });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/transits', (req, res) => {
    try {
      const { chart, atDate } = req.body;
      const transits = computeCurrentTransits(chart, atDate ? new Date(atDate) : new Date());
      res.json({ transits });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/navamsha', (req, res) => {
    try {
      const { chart } = req.body;
      const d9 = calculateNavamsha(chart);
      res.json({ d9 });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/panchanga', (req, res) => {
    try {
      const { day, month, year, lat, lon, utcOffset } = req.body;
      const p = computePanchanga(year, month, day, lat, lon, utcOffset);
      res.json({ panchanga: p });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Railway сам передаёт правильный порт через переменную PORT для "публичных" сервисов
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Mini App сервер запущен на порту ${PORT}`));
}

module.exports = { startWebApp };
