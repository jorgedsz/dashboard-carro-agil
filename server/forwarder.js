const fs = require('fs');
const path = require('path');
const { fetchSheet } = require('./sheet');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'forwarded.json');

// Webhook de n8n hardcodeado por defecto (overridable con la env var N8N_WEBHOOK_URL).
const DEFAULT_WEBHOOK_URL =
  'https://primary-production-b7ae.up.railway.app/webhook/4b712687-a64d-4c24-bb9f-448dd5afd2a1';
const WEBHOOK_URL = (process.env.N8N_WEBHOOK_URL || DEFAULT_WEBHOOK_URL).trim();
const TRIGGER_STATUS = (process.env.TRIGGER_STATUS || 'Registered').trim();
const POLL_MS = (Number(process.env.POLL_SECONDS) || 30) * 1000;
const LEAD_ID_COL = process.env.LEAD_ID_COLUMN || 'LEAD_ID';

// LEAD_IDs ya enviados a n8n (persistido en data/forwarded.json para sobrevivir reinicios).
let forwarded = new Set();
const state = { lastRun: null, lastError: null, lastSent: 0, running: false };
let timer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (Array.isArray(raw)) forwarded = new Set(raw.map(String));
  } catch {
    /* primer arranque: sin store todavía */
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify([...forwarded], null, 2));
  } catch (e) {
    console.error('[forwarder] no se pudo guardar el store:', e.message);
  }
}

async function sendWebhook(lead, leadId) {
  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'lead.registered',
      leadId,
      status: TRIGGER_STATUS,
      sentAt: new Date().toISOString(),
      lead, // todas las columnas de la fila, para crear la oportunidad en GHL
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`webhook respondió ${resp.status} ${text.slice(0, 120)}`);
  }
}

/**
 * Lee la hoja, busca leads en TRIGGER_STATUS que aún no se enviaron y los manda a n8n.
 * Si n8n falla, corta y reintenta en el siguiente ciclo (no marca como enviado).
 */
async function pollOnce() {
  if (state.running) return { skipped: 'ya en ejecución' };
  if (!WEBHOOK_URL) {
    state.lastError = 'N8N_WEBHOOK_URL no configurado';
    return { error: state.lastError };
  }

  state.running = true;
  let sent = 0;
  try {
    const { leads, statusKey } = await fetchSheet({ force: true });
    const pending = leads.filter((l) => {
      const id = String(l[LEAD_ID_COL] ?? '').trim();
      const status = String(l[statusKey] ?? '').trim();
      return id && status.toLowerCase() === TRIGGER_STATUS.toLowerCase() && !forwarded.has(id);
    });

    for (const lead of pending) {
      const id = String(lead[LEAD_ID_COL]).trim();
      try {
        await sendWebhook(lead, id);
        forwarded.add(id);
        sent++;
      } catch (e) {
        console.error(`[forwarder] error enviando lead ${id}:`, e.message);
        state.lastError = e.message;
        break; // n8n caído: detener y reintentar en el próximo ciclo
      }
    }

    if (sent > 0) save();
    state.lastRun = new Date().toISOString();
    state.lastSent = sent;
    if (sent === pending.length) state.lastError = null;
    if (sent > 0) console.log(`[forwarder] ${sent} lead(s) enviados a n8n`);
    return { sent, pending: pending.length };
  } catch (e) {
    state.lastError = e.message;
    console.error('[forwarder] pollOnce error:', e.message);
    return { error: e.message };
  } finally {
    state.running = false;
  }
}

function start() {
  load();
  if (!WEBHOOK_URL) {
    console.warn(
      '[forwarder] N8N_WEBHOOK_URL no configurado — reenvío a n8n DESACTIVADO. Define la URL en server/.env'
    );
    return;
  }
  console.log(
    `[forwarder] activo — status "${TRIGGER_STATUS}", cada ${POLL_MS / 1000}s → ${WEBHOOK_URL}`
  );
  pollOnce();
  timer = setInterval(pollOnce, POLL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function getStatus() {
  return {
    webhookConfigured: Boolean(WEBHOOK_URL),
    triggerStatus: TRIGGER_STATUS,
    pollSeconds: POLL_MS / 1000,
    forwardedCount: forwarded.size,
    lastRun: state.lastRun,
    lastSent: state.lastSent,
    lastError: state.lastError,
  };
}

/** Limpia el registro de enviados (útil para pruebas: vuelve a permitir reenvío). */
function reset() {
  forwarded = new Set();
  save();
  state.lastError = null;
  return { forwardedCount: 0 };
}

module.exports = { start, stop, pollOnce, getStatus, reset };
