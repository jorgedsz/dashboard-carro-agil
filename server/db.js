const { Pool } = require('pg');

const URL = (process.env.DATABASE_URL || '').trim();
const enabled = Boolean(URL);

// Railway: la conexión interna (*.railway.internal) y local no usan SSL;
// el proxy público (*.proxy.rlwy.net / *.railway.app) sí lo requiere.
function sslOption(u) {
  if (!u || /localhost|127\.0\.0\.1|\.railway\.internal/.test(u)) return false;
  return { rejectUnauthorized: false };
}

const pool = enabled ? new Pool({ connectionString: URL, ssl: sslOption(URL) }) : null;

/** Crea la tabla si no existe. Seguro de llamar varias veces. */
async function init() {
  if (!enabled) {
    console.warn(
      '[db] DATABASE_URL no configurado — la ganancia neta por lead está en SOLO LECTURA ' +
        '(pega el DATABASE_URL de Railway en server/.env para activarla).'
    );
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_profit (
      lead_id    TEXT PRIMARY KEY,
      net_profit NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('[db] Postgres conectado — tabla lead_profit lista.');
}

/** Devuelve { [lead_id]: number } con todas las ganancias guardadas. */
async function getProfits() {
  if (!enabled) return {};
  const { rows } = await pool.query('SELECT lead_id, net_profit FROM lead_profit');
  const map = {};
  for (const r of rows) map[r.lead_id] = r.net_profit == null ? null : Number(r.net_profit);
  return map;
}

/**
 * Inserta/actualiza la ganancia neta de un lead.
 * netProfit null o '' borra el registro (vuelve a "sin valor").
 */
async function setProfit(leadId, netProfit) {
  if (!enabled) {
    const e = new Error('Base de datos no configurada (DATABASE_URL).');
    e.status = 503;
    throw e;
  }
  const id = String(leadId || '').trim();
  if (!id) {
    const e = new Error('leadId vacío.');
    e.status = 400;
    throw e;
  }

  if (netProfit === null || netProfit === undefined || netProfit === '') {
    await pool.query('DELETE FROM lead_profit WHERE lead_id = $1', [id]);
    return { leadId: id, netProfit: null };
  }

  const val = Number(netProfit);
  if (Number.isNaN(val)) {
    const e = new Error('netProfit debe ser numérico.');
    e.status = 400;
    throw e;
  }

  await pool.query(
    `INSERT INTO lead_profit (lead_id, net_profit, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (lead_id)
     DO UPDATE SET net_profit = EXCLUDED.net_profit, updated_at = now()`,
    [id, val]
  );
  return { leadId: id, netProfit: val };
}

module.exports = { enabled, init, getProfits, setProfit };
