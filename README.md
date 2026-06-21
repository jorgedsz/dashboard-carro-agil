# Dashboard Carro Ágil

Dashboard que lee una Google Sheet de leads (alimentada por n8n desde GoHighLevel) y
muestra el **porcentaje de conversión por anuncio**, etiquetado como `ADSET_NAME - AD_ID`.

- **Backend** (`server/`): Node + Express. Descubre **todas las pestañas** de la hoja, las descarga como CSV y las **consolida** en un solo JSON (evita CORS y oculta el ID de la hoja en un solo lugar). Si creas una pestaña nueva, se incluye sola (sin tocar config).
- **Frontend** (`client/`): React + Vite. KPIs globales, tabla de conversión por anuncio y tabla de leads con buscador/filtro.

El flujo GHL → Sheet (captura de leads y actualización del `Status`) lo hace **n8n** con su nodo trigger nativo de Google Sheets, fuera de este proyecto. Aquí solo **leemos** la hoja.

## Columnas que espera de la Sheet

`LEAD_ID, ADSET_ID, AD_ID, AD_NAME, LEAD_NAME, LEAD_PHONE, LEAD_SOURCE, LEAD_EMAIL, ADSET_NAME, FORM_ID, FORM_NAME, Status`

La columna `Status` define la conversión. En el dashboard eliges con un click qué estados cuentan como "convertido" (se guarda en tu navegador).

## Requisito en Google Sheets (una sola vez)

Para que el backend pueda leer la hoja sin credenciales:

- **Archivo → Compartir → Publicar en la web** → publica la pestaña como CSV, **o**
- **Compartir → Acceso general → "Cualquiera con el enlace" → Lector**.

> Nota: con esta opción los datos quedan accesibles por URL para quien tenga el enlace. Es el modo prototipo elegido; para producción conviene una Service Account.

## Configuración

En `server/.env` (ya viene con la hoja actual):

```
PORT=3001
SHEET_ID=1Gza5dBGGIwV_87FroTVZgY51lhzVqANpMK8VAdsnsUI
SHEET_GID=0
SHEET_ALL_TABS=true
CACHE_SECONDS=15
DATABASE_URL=        # Postgres de Railway (ver más abajo). Vacío = ganancia neta en solo lectura.
```

`SHEET_ID` es la parte de la URL entre `/d/` y `/edit`. Con `SHEET_ALL_TABS=true` (por defecto) se consolidan **todas** las pestañas; pon `false` para leer solo `SHEET_GID`.

## Ganancia neta por lead y ROI (base de datos)

En la tabla de **Leads** cada fila tiene una columna **Ganancia neta** editable a mano. El valor se guarda por `LEAD_ID` en **Postgres** y con él el dashboard calcula:

- **Ganancia neta total** (KPI) y **ROI** = `(ganancia − gasto) / gasto` (el gasto viene de Meta).
- **Ganancia** y **ROI por anuncio** en la tabla de detalle.

La tabla `lead_profit (lead_id, net_profit, updated_at)` se crea sola al arrancar. Sin `DATABASE_URL` la columna queda en solo lectura (el resto del dashboard funciona igual).

### Crear la base de datos en Railway

1. En tu proyecto de Railway: **New → Database → Add PostgreSQL**.
2. Abre el servicio Postgres → pestaña **Variables** → copia `DATABASE_URL`.
3. **En producción:** en el servicio del dashboard, agrega la variable `DATABASE_URL` (puedes referenciar la del Postgres con `${{Postgres.DATABASE_URL}}`).
4. **En local:** pega ese `DATABASE_URL` (el público, termina en `proxy.rlwy.net:PUERTO`) en `server/.env`.

> El SSL se activa solo según el host (interno `*.railway.internal` sin SSL; proxy público con SSL).

## Cómo correrlo (desarrollo)

En dos terminales:

```bash
# Terminal 1 — backend
cd server
npm install
npm run dev        # http://localhost:3001

# Terminal 2 — frontend
cd client
npm install
npm run dev        # http://localhost:5173
```

Abre http://localhost:5173. Vite redirige `/api/*` al backend automáticamente.

## Endpoints del backend

- `GET /api/leads` — devuelve `{ columns, statusKey, statuses, sheets, leads, total, fetchedAt }`. `sheets` lista cada pestaña con su conteo; cada lead trae `_sheet` (pestaña de origen).
- `GET /api/leads?refresh=1` — ignora la caché y vuelve a bajar la hoja (y redescubre pestañas nuevas al instante). Cada lead trae `_netProfit` si tiene ganancia guardada.
- `GET /api/profits` — `{ enabled, profits: { [LEAD_ID]: monto } }`.
- `PUT /api/profits/:leadId` — body `{ netProfit }` (número, o `null`/`""` para borrar). Guarda la ganancia del lead.
- `GET /api/health` — `{ ok: true }`.

## Deploy en Railway

El repo es un monorepo (`client/` + `server/`). El `package.json` de la raíz instala ambos, compila el cliente y arranca el server, que **sirve el frontend compilado y la API en el mismo puerto** (sin CORS).

1. En Railway: **New Project → Deploy from GitHub repo** → elige este repo.
2. Deja el **Root Directory** en la raíz (no lo pongas en `server/`).
3. Railway detecta Node y ejecuta automáticamente:
   - `npm run build` → instala server + client y compila el cliente.
   - `npm start` → `node server/index.js`.
4. **Variables de entorno** (Settings → Variables): Railway ya define `PORT`. Agrega las que uses:
   - `SHEET_ID` (por defecto la hoja actual)
   - `SHEET_ALL_TABS` (`true` por defecto = consolida todas las pestañas), `SHEET_GID` (solo si `SHEET_ALL_TABS=false`)
   - `DATABASE_URL` (Postgres, para la ganancia neta/ROI; referencia `${{Postgres.DATABASE_URL}}`)
   - `META_ACCESS_TOKEN` (imágenes de anuncios; opcional), `META_API_VERSION` (opcional)

> En local sigues usando dos procesos (`server` en :3001 y `client` Vite en :5173). En producción todo va por el puerto que asigna Railway.
