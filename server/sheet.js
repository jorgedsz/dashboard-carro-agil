const Papa = require('papaparse');

const SHEET_ID = process.env.SHEET_ID || '1lf3EK7vo3lUnx8uOMZvSnooshiZvboIjcurPasxMEl8';
const GID = process.env.SHEET_GID || '0';
const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 15) * 1000;

function csvUrl() {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
}

let cache = { at: 0, data: null };

/**
 * Descarga la Google Sheet publicada como CSV, la parsea y devuelve filas
 * normalizadas + estados distintos. Cachea CACHE_SECONDS para no martillar a Google.
 */
async function fetchSheet({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  const resp = await fetch(csvUrl(), { redirect: 'follow' });
  if (!resp.ok) {
    const e = new Error(
      `Google respondió ${resp.status}. ¿La hoja está publicada o compartida como "cualquiera con el enlace"?`
    );
    e.status = 502;
    throw e;
  }

  const csv = await resp.text();
  if (csv.trimStart().startsWith('<')) {
    const e = new Error(
      'La hoja no es accesible públicamente. Archivo → Compartir → Publicar en la web, o "Cualquiera con el enlace (Lector)".'
    );
    e.status = 502;
    throw e;
  }

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' });
  const columns = parsed.meta.fields || [];
  const leads = parsed.data.filter((r) =>
    Object.values(r).some((v) => String(v ?? '').trim() !== '')
  );

  const statusKey =
    columns.find((c) => c.toLowerCase() === 'status') ||
    columns.find((c) => c.toLowerCase().includes('status')) ||
    'Status';

  const statuses = [
    ...new Set(leads.map((l) => String(l[statusKey] ?? '').trim()).filter(Boolean)),
  ].sort();

  const data = {
    columns,
    statusKey,
    statuses,
    leads,
    total: leads.length,
    fetchedAt: new Date().toISOString(),
  };

  cache = { at: Date.now(), data };
  return { ...data, cached: false };
}

module.exports = { fetchSheet, csvUrl, SHEET_ID, GID };
