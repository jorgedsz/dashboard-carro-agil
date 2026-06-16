# Dashboard Carro Ágil

Dashboard que lee una Google Sheet de leads (alimentada por n8n desde GoHighLevel) y
muestra el **porcentaje de conversión por anuncio**, etiquetado como `ADSET_NAME - AD_ID`.

- **Backend** (`server/`): Node + Express. Descarga la Sheet publicada como CSV y la sirve como JSON (evita CORS y oculta el ID de la hoja en un solo lugar).
- **Frontend** (`client/`): React + Vite. KPIs globales, tabla de conversión por anuncio y tabla de leads con buscador/filtro.

El flujo GHL → Sheet (captura de leads y actualización del `Status`) lo hace **n8n**, fuera de este proyecto. Aquí solo **leemos** la hoja.

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
SHEET_ID=1lf3EK7vo3lUnx8uOMZvSnooshiZvboIjcurPasxMEl8
SHEET_GID=0
CACHE_SECONDS=15
```

`SHEET_ID` es la parte de la URL entre `/d/` y `/edit`. `SHEET_GID` es el `gid` de la pestaña.

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

- `GET /api/leads` — devuelve `{ columns, statusKey, statuses, leads, total, fetchedAt }`.
- `GET /api/leads?refresh=1` — ignora la caché y vuelve a bajar la hoja.
- `GET /api/health` — `{ ok: true }`.

## Deploy en Railway

El repo es un monorepo (`client/` + `server/`). El `package.json` de la raíz instala ambos, compila el cliente y arranca el server, que **sirve el frontend compilado y la API en el mismo puerto** (sin CORS).

1. En Railway: **New Project → Deploy from GitHub repo** → elige este repo.
2. Deja el **Root Directory** en la raíz (no lo pongas en `server/`).
3. Railway detecta Node y ejecuta automáticamente:
   - `npm run build` → instala server + client y compila el cliente.
   - `npm start` → `node server/index.js`.
4. **Variables de entorno** (Settings → Variables): Railway ya define `PORT`. Agrega las que uses:
   - `SHEET_ID` (por defecto la hoja actual), `SHEET_GID`
   - `N8N_WEBHOOK_URL` (reenvío de leads a n8n)
   - `META_ACCESS_TOKEN` (imágenes de anuncios; opcional)
   - `TRIGGER_STATUS`, `POLL_SECONDS`, `META_API_VERSION` (opcionales)

> En local sigues usando dos procesos (`server` en :3001 y `client` Vite en :5173). En producción todo va por el puerto que asigna Railway.
