const Papa = require('papaparse');

const SHEET_ID = process.env.SHEET_ID || '1Gza5dBGGIwV_87FroTVZgY51lhzVqANpMK8VAdsnsUI';
const GID = process.env.SHEET_GID || '0';
const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 15) * 1000;
// Por defecto consolida TODAS las pestañas. Pon SHEET_ALL_TABS=false para usar solo SHEET_GID.
const ALL_TABS = String(process.env.SHEET_ALL_TABS ?? 'true').toLowerCase() !== 'false';

function csvUrl(gid = GID) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

let cache = { at: 0, data: null };
let tabsCache = { at: 0, tabs: null };
const TABS_CACHE_MS = 5 * 60 * 1000; // las pestañas casi nunca cambian

function decodeName(raw) {
  // Los nombres vienen escapados dentro del JS del htmlview (á, \x3d, \\, …).
  return raw
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([\dA-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1')
    .trim();
}

/**
 * Descubre TODAS las pestañas (gid + nombre) leyendo el htmlview público de la hoja.
 * El htmlview incluye un bloque JS con `items.push({name: "...", url: "...gid=N", gid: "N"})`.
 */
async function discoverTabs() {
  if (tabsCache.tabs && Date.now() - tabsCache.at < TABS_CACHE_MS) return tabsCache.tabs;

  const resp = await fetchWithRetry(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`,
    { redirect: 'follow' }
  );
  if (!resp.ok) throw new Error(`htmlview respondió ${resp.status} al listar pestañas`);
  const html = await resp.text();

  const re = /name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g;
  const seen = new Set();
  const tabs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const gid = m[2];
    if (seen.has(gid)) continue;
    seen.add(gid);
    tabs.push({ name: decodeName(m[1]), gid });
  }
  if (!tabs.length) throw new Error('No se pudo descubrir ninguna pestaña en la hoja');

  tabsCache = { at: Date.now(), tabs };
  return tabs;
}

/** fetch con un reintento ante fallos transitorios de red (Google a veces corta la conexión). */
async function fetchWithRetry(url, opts, retries = 1) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    if (retries > 0) return fetchWithRetry(url, opts, retries - 1);
    throw e;
  }
}

/** Baja y parsea UNA pestaña. Devuelve { columns, rows } (rows ya etiquetadas con _sheet). */
async function fetchTab(tab) {
  const resp = await fetchWithRetry(csvUrl(tab.gid), { redirect: 'follow' });
  if (!resp.ok) {
    const e = new Error(
      `Google respondió ${resp.status} para la pestaña "${tab.name}". ¿La hoja está compartida como "cualquiera con el enlace"?`
    );
    e.status = 502;
    throw e;
  }
  const csv = await resp.text();
  if (csv.trimStart().startsWith('<')) {
    const e = new Error(
      'La hoja no es accesible públicamente. Archivo → Compartir → "Cualquiera con el enlace (Lector)".'
    );
    e.status = 502;
    throw e;
  }

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' });
  const columns = parsed.meta.fields || [];
  const rows = parsed.data
    .filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''))
    .map((r) => ({ ...r, _sheet: tab.name }));
  return { columns, rows };
}

/**
 * Descarga la Google Sheet publicada como CSV y devuelve filas normalizadas + estados.
 * Por defecto consolida TODAS las pestañas (cada fila trae `_sheet` con su pestaña de origen).
 * Cachea CACHE_SECONDS para no martillar a Google.
 */
async function fetchSheet({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  // Qué pestañas bajar: todas (descubiertas) o solo la de SHEET_GID.
  let tabs;
  if (ALL_TABS) {
    try {
      tabs = await discoverTabs();
    } catch (e) {
      console.warn('[sheet] no se pudieron descubrir las pestañas, uso solo SHEET_GID:', e.message);
      tabs = [{ name: '', gid: GID }];
    }
  } else {
    tabs = [{ name: '', gid: GID }];
  }

  const results = await Promise.all(tabs.map((t) => fetchTab(t)));

  // Unión de columnas (orden: las de la primera pestaña + cualquier columna nueva de las demás).
  const columns = [];
  for (const r of results) for (const c of r.columns) if (!columns.includes(c)) columns.push(c);

  const leads = results.flatMap((r) => r.rows);

  const statusKey =
    columns.find((c) => c.toLowerCase() === 'status') ||
    columns.find((c) => c.toLowerCase().includes('status')) ||
    'Status';

  const statuses = [
    ...new Set(leads.map((l) => String(l[statusKey] ?? '').trim()).filter(Boolean)),
  ].sort();

  const sheets = tabs.map((t) => ({
    name: t.name,
    gid: t.gid,
    count: leads.filter((l) => l._sheet === t.name).length,
  }));

  const data = {
    columns,
    statusKey,
    statuses,
    sheets,
    leads,
    total: leads.length,
    fetchedAt: new Date().toISOString(),
  };

  cache = { at: Date.now(), data };
  return { ...data, cached: false };
}

module.exports = { fetchSheet, discoverTabs, csvUrl, SHEET_ID, GID, ALL_TABS };
