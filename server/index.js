require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { fetchSheet, csvUrl } = require('./sheet');
const meta = require('./meta');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/**
 * GET /api/leads
 * Devuelve { columns, statusKey, statuses, leads, total, fetchedAt }.
 * ?refresh=1 ignora la caché.
 */
app.get('/api/leads', async (req, res) => {
  try {
    const data = await fetchSheet({ force: req.query.refresh === '1' });
    res.json(data);
  } catch (err) {
    console.error('[leads] error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Imágenes de anuncios (Meta Marketing API) ────────────────

/** GET /api/ad-images/status — si la integración con Meta está activa */
app.get('/api/ad-images/status', (req, res) => {
  res.json({ enabled: meta.enabled(), apiVersion: meta.API_VERSION });
});

/** POST /api/ad-images { adIds: [...] } — devuelve la imagen de cada anuncio */
app.post('/api/ad-images', async (req, res) => {
  if (!meta.enabled()) return res.json({ enabled: false, images: {} });
  try {
    const { adIds } = req.body || {};
    if (!Array.isArray(adIds)) return res.status(400).json({ error: 'adIds debe ser un array' });
    const images = await meta.getAdImages(adIds);
    res.json({ enabled: true, images });
  } catch (err) {
    console.error('[meta] ad-images error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/ad-insights { adIds: [...], datePreset } — gasto/rendimiento por anuncio */
app.post('/api/ad-insights', async (req, res) => {
  if (!meta.enabled()) return res.json({ enabled: false, insights: {} });
  try {
    const { adIds, datePreset } = req.body || {};
    if (!Array.isArray(adIds)) return res.status(400).json({ error: 'adIds debe ser un array' });
    const insights = await meta.getAdInsights(adIds, datePreset);
    res.json({ enabled: true, datePreset: datePreset || 'maximum', insights });
  } catch (err) {
    console.error('[meta] ad-insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ─── Servir el frontend compilado (producción) ────────────────
// En dev usamos Vite en :5173; en producción el server sirve client/dist.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log('[static] sirviendo frontend desde client/dist');
}

app.listen(PORT, () => {
  console.log(`Carro Ágil server escuchando en http://localhost:${PORT}`);
  console.log(`Hoja: ${csvUrl()}`);
});
