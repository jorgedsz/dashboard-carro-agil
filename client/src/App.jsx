import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

// Nombres de columna tal como vienen en la Google Sheet.
const COL = {
  leadId: 'LEAD_ID',
  adsetName: 'ADSET_NAME',
  adId: 'AD_ID',
  adName: 'AD_NAME',
  name: 'LEAD_NAME',
  phone: 'LEAD_PHONE',
  email: 'LEAD_EMAIL',
  source: 'LEAD_SOURCE',
}

// Paleta para los donuts (convertido / no convertido).
const DONUT_COLORS = ['#34d399', '#263150']

// Estilo común para los tooltips de Recharts sobre fondo oscuro.
const TOOLTIP_STYLE = {
  background: '#1b2238',
  border: '1px solid #263150',
  borderRadius: 8,
  color: '#e6e9f2',
}

const LS_KEY = 'convertedStatuses'

// Regla de negocio: "Won" (ganado) SIEMPRE cuenta como convertido y no se puede desmarcar.
const ALWAYS_CONVERTED = /^(won|ganad[oa]?)$/i
// Heurística para preseleccionar otros estados parecidos a "convertido".
const CONVERTED_HINT = /won|convert|client|closed|cliente|ganad|venta|vendi|sold|cerrad/i

function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}

// Input editable de "ganancia neta" por lead. Confirma al salir (blur) o con Enter.
function ProfitInput({ value, disabled, title, onSave }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => {
    setV(value ?? '')
  }, [value])

  const commit = () => {
    const norm = v === '' ? '' : String(Number(v))
    const prev = value == null ? '' : String(value)
    if (norm !== prev) onSave(v)
  }

  return (
    <input
      className="input profit-input"
      type="number"
      inputMode="decimal"
      step="0.01"
      disabled={disabled}
      title={title}
      placeholder={disabled ? '—' : '0'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const [converted, setConverted] = useState(() => new Set())
  const [convertedReady, setConvertedReady] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [adImages, setAdImages] = useState({})
  const [metaEnabled, setMetaEnabled] = useState(null)

  const [adInsights, setAdInsights] = useState({})
  const [datePreset, setDatePreset] = useState('maximum')

  // Ganancia neta por lead: { [LEAD_ID]: number|null }. Persiste en el backend (Postgres).
  const [profits, setProfits] = useState({})
  const [profitEnabled, setProfitEnabled] = useState(null)

  async function load(refresh = false) {
    try {
      refresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      const res = await fetch(`/api/leads${refresh ? '?refresh=1' : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`)
      setData(json)
      setProfitEnabled(json.profitEnabled)
      // Siembra las ganancias guardadas; conserva ediciones locales en curso.
      const seed = {}
      for (const l of json.leads || []) {
        const id = String(l[COL.leadId] ?? '').trim()
        if (id && l._netProfit != null) seed[id] = Number(l._netProfit)
      }
      setProfits((prev) => ({ ...seed, ...prev }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Guarda la ganancia de un lead (optimista: actualiza UI y persiste en el backend).
  async function saveProfit(leadId, raw) {
    const id = String(leadId || '').trim()
    if (!id) return
    const val = raw === '' || raw == null ? null : Number(raw)
    setProfits((prev) => ({ ...prev, [id]: val }))
    try {
      const res = await fetch(`/api/profits/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netProfit: val }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Error ${res.status}`)
      }
    } catch (err) {
      setError(`No se pudo guardar la ganancia: ${err.message}`)
    }
  }

  useEffect(() => {
    load()
    // Auto-refresco: vuelve a leer la hoja cada 30s.
    const t = setInterval(() => load(true), 30000)
    return () => clearInterval(t)
  }, [])

  // Trae las imágenes de los anuncios (Meta) para los AD_ID presentes en la hoja.
  useEffect(() => {
    const ids = [...new Set((data?.leads || []).map((l) => String(l[COL.adId] ?? '').trim()).filter(Boolean))]
    if (ids.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ad-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adIds: ids }),
        })
        const json = await res.json()
        if (cancelled) return
        setMetaEnabled(json.enabled)
        if (json.images) setAdImages((prev) => ({ ...prev, ...json.images }))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data])

  // Trae insights (gasto/rendimiento) de Meta para los AD_ID, según el rango elegido.
  useEffect(() => {
    const ids = [...new Set((data?.leads || []).map((l) => String(l[COL.adId] ?? '').trim()).filter(Boolean))]
    if (ids.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ad-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adIds: ids, datePreset }),
        })
        const json = await res.json()
        if (cancelled) return
        setMetaEnabled((prev) => (prev == null ? json.enabled : prev))
        if (json.insights) setAdInsights(json.insights)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data, datePreset])

  // Inicializa la selección de estados convertidos (localStorage o heurística).
  useEffect(() => {
    if (!data || convertedReady) return
    let initial
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      if (Array.isArray(saved)) initial = new Set(saved.filter((s) => data.statuses.includes(s)))
    } catch {
      /* ignore */
    }
    if (!initial || initial.size === 0) {
      initial = new Set(data.statuses.filter((s) => CONVERTED_HINT.test(s)))
    }
    // "Won" siempre cuenta como convertido, exista lo que exista en localStorage.
    data.statuses.forEach((s) => {
      if (ALWAYS_CONVERTED.test(s.trim())) initial.add(s)
    })
    setConverted(initial)
    setConvertedReady(true)
  }, [data, convertedReady])

  function toggleStatus(status) {
    if (ALWAYS_CONVERTED.test(status.trim())) return // Won es ganado por definición
    setConverted((prev) => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      localStorage.setItem(LS_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const leads = data?.leads || []
  const statusKey = data?.statusKey || 'Status'

  // "Won/Ganado" cuenta SIEMPRE (regla de negocio), además de los estados marcados a mano.
  const isConverted = (lead) => {
    const s = String(lead[statusKey] ?? '').trim()
    return ALWAYS_CONVERTED.test(s) || converted.has(s)
  }

  // KPIs globales
  const totals = useMemo(() => {
    const total = leads.length
    const conv = leads.filter(isConverted).length
    return { total, conv, pct: pct(conv, total) }
  }, [leads, converted])

  // Agregado por anuncio: etiqueta "ADSET_NAME - AD_ID"
  const byAd = useMemo(() => {
    const map = new Map()
    for (const lead of leads) {
      const adsetName = (lead[COL.adsetName] || '').trim() || '(sin adset)'
      const adId = (lead[COL.adId] || '').trim() || '(sin ad id)'
      const key = `${adsetName} - ${adId}`
      if (!map.has(key)) {
        map.set(key, { key, adsetName, adId, adName: (lead[COL.adName] || '').trim(), total: 0, conv: 0, profit: 0 })
      }
      const g = map.get(key)
      g.total += 1
      if (isConverted(lead)) g.conv += 1
      const id = String(lead[COL.leadId] ?? '').trim()
      if (id && profits[id] != null) g.profit += Number(profits[id])
    }
    return [...map.values()]
      .map((g) => ({ ...g, pct: pct(g.conv, g.total) }))
      .sort((a, b) => b.total - a.total || b.pct - a.pct)
  }, [leads, converted, profits])

  // Agregado por adset (solo ADSET_NAME)
  const byAdset = useMemo(() => {
    const map = new Map()
    for (const lead of leads) {
      const adsetName = (lead[COL.adsetName] || '').trim() || '(sin adset)'
      if (!map.has(adsetName)) map.set(adsetName, { name: adsetName, total: 0, conv: 0 })
      const g = map.get(adsetName)
      g.total += 1
      if (isConverted(lead)) g.conv += 1
    }
    return [...map.values()]
      .map((g) => ({ ...g, noConv: g.total - g.conv, pct: pct(g.conv, g.total) }))
      .sort((a, b) => b.total - a.total)
  }, [leads, converted])

  // Datos para la gráfica comparativa por anuncio (reusa byAd)
  const adChartData = useMemo(
    () => byAd.map((g) => ({ name: `${g.adName || g.adId}`, label: g.key, total: g.total, conv: g.conv, pct: g.pct })),
    [byAd]
  )

  // ─── Costos de Meta (gasto cruzado con leads / conversiones) ───
  const currency = useMemo(() => {
    for (const k in adInsights) if (adInsights[k]?.currency) return adInsights[k].currency
    return null
  }, [adInsights])

  const fmtMoney = (n) => {
    if (n == null || isNaN(n)) return '—'
    try {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
      }).format(n)
    } catch {
      return Number(n).toFixed(2)
    }
  }
  const fmtNum = (n) => (n == null || isNaN(n) ? '—' : new Intl.NumberFormat('es-MX').format(n))

  const metaTotals = useMemo(() => {
    const spend = byAd.reduce((s, g) => s + (adInsights[g.adId]?.spend || 0), 0)
    const hasData = byAd.some((g) => adInsights[g.adId]?.hasData)
    return {
      spend,
      hasData,
      cpl: totals.total ? spend / totals.total : null,
      cpa: totals.conv ? spend / totals.conv : null,
    }
  }, [byAd, adInsights, totals])

  // ─── Ganancia neta (a mano) y ROI vs gasto de Meta ───
  const profitTotals = useMemo(() => {
    let profit = 0
    let count = 0
    for (const l of leads) {
      const id = String(l[COL.leadId] ?? '').trim()
      if (id && profits[id] != null) {
        profit += Number(profits[id])
        count += 1
      }
    }
    const spend = metaTotals.spend
    // ROI = (ganancia neta − gasto) / gasto. Requiere gasto de Meta > 0.
    const roi = metaTotals.hasData && spend > 0 ? ((profit - spend) / spend) * 100 : null
    return { profit, count, roi }
  }, [leads, profits, metaTotals])

  // Desglose por estado
  const byStatus = useMemo(() => {
    const map = new Map()
    for (const lead of leads) {
      const s = String(lead[statusKey] ?? '').trim() || '(vacío)'
      map.set(s, (map.get(s) || 0) + 1)
    }
    return [...map.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
  }, [leads, statusKey])

  // Tabla de leads filtrada
  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((lead) => {
      if (statusFilter && String(lead[statusKey] ?? '').trim() !== statusFilter) return false
      if (!q) return true
      return [COL.name, COL.phone, COL.email, COL.adsetName, COL.adName].some((c) =>
        String(lead[c] ?? '').toLowerCase().includes(q)
      )
    })
  }, [leads, search, statusFilter, statusKey])

  // Paginación de la tabla de leads.
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const pagedLeads = useMemo(
    () => filteredLeads.slice((pageClamped - 1) * pageSize, pageClamped * pageSize),
    [filteredLeads, pageClamped, pageSize]
  )

  // Al cambiar búsqueda, filtro o tamaño de página, vuelve a la primera página.
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, pageSize])

  if (loading) {
    return (
      <div className="screen-center">
        <div className="spinner" />
        <p>Cargando leads…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-dot" />
          <div>
            <h1 className="title">Carro Ágil</h1>
            <p className="muted subtitle">
              <span className="live-dot" />
              {data?.total ?? 0} leads
              {data?.fetchedAt ? ` · actualizado ${new Date(data.fetchedAt).toLocaleTimeString('es-MX')}` : ''}
            </p>
          </div>
        </div>
        <button className="btn" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </header>

      {error && (
        <div className="alert">
          <strong>No se pudieron cargar los datos.</strong>
          <div>{error}</div>
        </div>
      )}

      {!error && (
        <>
          {/* KPIs */}
          <section className="kpis">
            <div className="kpi kpi-1">
              <div className="kpi-icon">👥</div>
              <div className="kpi-body">
                <span className="kpi-label">Leads totales</span>
                <span className="kpi-value">{totals.total}</span>
              </div>
            </div>
            <div className="kpi kpi-2">
              <div className="kpi-icon">🏆</div>
              <div className="kpi-body">
                <span className="kpi-label">Convertidos</span>
                <span className="kpi-value green">{totals.conv}</span>
              </div>
            </div>
            <div className="kpi kpi-3">
              <div className="kpi-icon">📈</div>
              <div className="kpi-body">
                <span className="kpi-label">% Conversión</span>
                <span className="kpi-value blue">{totals.pct}%</span>
              </div>
            </div>
            <div className="kpi kpi-4">
              <div className="kpi-icon">💰</div>
              <div className="kpi-body">
                <span className="kpi-label">Ganancia neta</span>
                <span className="kpi-value green">{fmtMoney(profitTotals.profit)}</span>
                <span className="kpi-sub muted">
                  {profitTotals.count} lead{profitTotals.count === 1 ? '' : 's'} con monto
                  {profitTotals.roi != null ? ` · ROI ${profitTotals.roi.toFixed(0)}%` : ''}
                </span>
              </div>
            </div>
          </section>

          {/* Selector de estados convertidos */}
          <section className="card">
            <div className="card-head">
              <h2>🎯 ¿Qué estados cuentan como convertido?</h2>
              <span className="muted">
                <strong>Won</strong> = ganado (convertido) siempre · marca otros con click
              </span>
            </div>
            <div className="chips">
              {data.statuses.length === 0 && <span className="muted">No hay estados en la hoja todavía.</span>}
              {data.statuses.map((s) => {
                const count = byStatus.find((b) => b.status === s)?.count || 0
                const locked = ALWAYS_CONVERTED.test(s.trim())
                const on = converted.has(s) || locked
                return (
                  <button
                    key={s}
                    className={`chip ${on ? 'chip-on' : ''} ${locked ? 'chip-locked' : ''}`}
                    onClick={() => toggleStatus(s)}
                    title={locked ? 'Won = ganado (convertido) por definición' : 'Click para marcar/desmarcar'}
                  >
                    {on ? '✓ ' : ''}
                    {s}
                    {locked ? ' · ganado' : ''} <span className="chip-count">{count}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Gráfica por adset */}
          <section className="card">
            <div className="card-head">
              <h2>📊 Conversión por adset</h2>
              <span className="muted">leads vs convertidos por adset</span>
            </div>
            <div style={{ width: '100%', height: Math.max(220, byAdset.length * 48) }}>
              <ResponsiveContainer>
                <BarChart data={byAdset} layout="vertical" margin={{ left: 12, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#263150" horizontal={false} />
                  <XAxis type="number" stroke="#8b93ad" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#8b93ad" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v, n) => [v, n === 'conv' ? 'Convertidos' : 'Leads']}
                  />
                  <Legend formatter={(v) => (v === 'conv' ? 'Convertidos' : 'Leads')} />
                  <Bar dataKey="total" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="conv" fill="#34d399" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Un donut por cada adset */}
            <div className="donut-grid">
              {byAdset.map((g) => (
                <div className="donut-card" key={g.name}>
                  <div className="donut-wrap">
                    <ResponsiveContainer width="100%" height={120}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Convertidos', value: g.conv },
                            { name: 'No convertidos', value: g.noConv },
                          ]}
                          dataKey="value"
                          innerRadius={36}
                          outerRadius={52}
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                        >
                          {DONUT_COLORS.map((c, i) => (
                            <Cell key={i} fill={c} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center">{g.pct}%</div>
                  </div>
                  <div className="donut-label">
                    <div className="strong">{g.name}</div>
                    <div className="muted small">
                      {g.conv}/{g.total} convertidos
                    </div>
                  </div>
                </div>
              ))}
              {byAdset.length === 0 && <span className="muted">Sin datos.</span>}
            </div>
          </section>

          {/* Gráfica comparativa por anuncio */}
          <section className="card">
            <div className="card-head">
              <h2>📈 Conversión por anuncio</h2>
              <span className="muted">leads vs convertidos por ad</span>
            </div>
            <div style={{ width: '100%', height: Math.max(240, adChartData.length * 52) }}>
              <ResponsiveContainer>
                <BarChart data={adChartData} layout="vertical" margin={{ left: 12, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#263150" horizontal={false} />
                  <XAxis type="number" stroke="#8b93ad" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#8b93ad" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v, n) => [v, n === 'conv' ? 'Convertidos' : 'Leads']}
                    labelFormatter={(_, p) => p?.[0]?.payload?.label || ''}
                  />
                  <Legend formatter={(v) => (v === 'conv' ? 'Convertidos' : 'Leads')} />
                  <Bar dataKey="total" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="conv" fill="#34d399" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Tabla detalle por anuncio */}
          <section className="card">
            <div className="card-head">
              <h2>🖼️ Detalle y costos por anuncio</h2>
              {metaEnabled === false ? (
                <span className="muted">Conecta Meta (META_ACCESS_TOKEN) para imágenes y gasto</span>
              ) : (
                <label className="range-select muted">
                  Gasto:
                  <select className="input" value={datePreset} onChange={(e) => setDatePreset(e.target.value)}>
                    <option value="maximum">Histórico</option>
                    <option value="last_7d">Últimos 7 días</option>
                    <option value="last_30d">Últimos 30 días</option>
                    <option value="last_90d">Últimos 90 días</option>
                  </select>
                </label>
              )}
            </div>
            {metaEnabled && metaTotals.hasData && (
              <div className="meta-kpis">
                <div className="meta-kpi">
                  <span className="mk-label">💸 Gasto total</span>
                  <span className="mk-value">{fmtMoney(metaTotals.spend)}</span>
                </div>
                <div className="meta-kpi">
                  <span className="mk-label">🎯 Costo por lead</span>
                  <span className="mk-value">{fmtMoney(metaTotals.cpl)}</span>
                </div>
                <div className="meta-kpi">
                  <span className="mk-label">🏆 Costo por conversión</span>
                  <span className="mk-value">{metaTotals.cpa != null ? fmtMoney(metaTotals.cpa) : '—'}</span>
                </div>
                <div className="meta-kpi">
                  <span className="mk-label">📊 ROI</span>
                  <span className={`mk-value ${profitTotals.roi != null && profitTotals.roi < 0 ? 'red' : 'green'}`}>
                    {profitTotals.roi != null ? `${profitTotals.roi.toFixed(0)}%` : '—'}
                  </span>
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="img-col">Imagen</th>
                    <th>Adset – Ad ID</th>
                    <th>Anuncio</th>
                    <th className="num">Leads</th>
                    <th className="num">Conv.</th>
                    <th className="bar-col">% Conversión</th>
                    <th className="num">Gasto</th>
                    <th className="num">CPL</th>
                    <th className="num">$/conv.</th>
                    <th className="num">Ganancia</th>
                    <th className="num">ROI</th>
                    <th className="num">CTR</th>
                    <th className="num">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {byAd.map((g) => {
                    const img = adImages[g.adId]
                    const ins = adInsights[g.adId]
                    const spend = ins?.spend || 0
                    const cpl = ins?.hasData && g.total ? spend / g.total : null
                    const cpa = ins?.hasData && g.conv ? spend / g.conv : null
                    const roi = ins?.hasData && spend > 0 ? ((g.profit - spend) / spend) * 100 : null
                    return (
                    <tr key={g.key}>
                      <td>
                        {img?.imageUrl ? (
                          <a href={img.imageUrl} target="_blank" rel="noreferrer">
                            <img className="ad-thumb" src={img.imageUrl} alt={g.adName || g.adId} loading="lazy" />
                          </a>
                        ) : (
                          <div className="ad-thumb ad-thumb-empty" title={img?.error || ''}>
                            {metaEnabled === false ? '—' : img?.error ? '⚠' : '…'}
                          </div>
                        )}
                      </td>
                      <td className="strong">{g.key}</td>
                      <td className="muted">{g.adName || '—'}</td>
                      <td className="num">{g.total}</td>
                      <td className="num green">{g.conv}</td>
                      <td>
                        <div className="bar-cell">
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${g.pct}%` }} />
                          </div>
                          <span className="bar-pct">{g.pct}%</span>
                        </div>
                      </td>
                      <td className="num">{ins?.hasData ? fmtMoney(spend) : '—'}</td>
                      <td className="num">{cpl != null ? fmtMoney(cpl) : '—'}</td>
                      <td className="num strong">{cpa != null ? fmtMoney(cpa) : '—'}</td>
                      <td className="num green">{g.profit ? fmtMoney(g.profit) : '—'}</td>
                      <td className={`num strong ${roi != null && roi < 0 ? 'red' : roi != null ? 'green' : ''}`}>
                        {roi != null ? `${roi.toFixed(0)}%` : '—'}
                      </td>
                      <td className="num">{ins?.hasData ? `${ins.ctr.toFixed(2)}%` : '—'}</td>
                      <td className="num">{ins?.hasData ? fmtMoney(ins.cpc) : '—'}</td>
                    </tr>
                    )
                  })}
                  {byAd.length === 0 && (
                    <tr>
                      <td colSpan={13} className="muted center">
                        Sin datos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Leads */}
          <section className="card">
            <div className="card-head">
              <h2>📋 Leads</h2>
              <div className="filters">
                <input
                  className="input"
                  placeholder="Buscar nombre, teléfono, email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {data.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Teléfono</th>
                    <th>Email</th>
                    <th>Fuente</th>
                    <th>Adset</th>
                    <th>Anuncio</th>
                    <th>Estado</th>
                    <th className="num">Ganancia neta</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLeads.map((lead, i) => {
                    const status = String(lead[statusKey] ?? '').trim()
                    const conv = converted.has(status)
                    const leadId = String(lead[COL.leadId] ?? '').trim()
                    const noId = !leadId
                    return (
                      <tr key={leadId || i}>
                        <td className="strong">{lead[COL.name] || '—'}</td>
                        <td>{lead[COL.phone] || '—'}</td>
                        <td className="muted">{lead[COL.email] || '—'}</td>
                        <td>{lead[COL.source] || '—'}</td>
                        <td>{lead[COL.adsetName] || '—'}</td>
                        <td className="muted">{lead[COL.adName] || '—'}</td>
                        <td>
                          <span className={`badge ${conv ? 'badge-green' : 'badge-gray'}`}>{status || '—'}</span>
                        </td>
                        <td className="num">
                          <ProfitInput
                            value={leadId ? profits[leadId] : null}
                            disabled={profitEnabled === false || noId}
                            title={
                              profitEnabled === false
                                ? 'Configura DATABASE_URL para guardar la ganancia'
                                : noId
                                ? 'Este lead no tiene LEAD_ID, no se puede guardar'
                                : 'Monto neto de ganancia de este lead'
                            }
                            onSave={(v) => saveProfit(leadId, v)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted center">
                        No hay leads que coincidan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span className="muted small">
                {filteredLeads.length === 0
                  ? 'Sin resultados'
                  : `Mostrando ${(pageClamped - 1) * pageSize + 1}–${Math.min(
                      pageClamped * pageSize,
                      filteredLeads.length
                    )} de ${filteredLeads.length}`}
                {filteredLeads.length !== leads.length ? ` (filtrados de ${leads.length})` : ''}
              </span>
              <div className="pager">
                <label className="muted small page-size">
                  Por página:
                  <select
                    className="input"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage(1)}
                  disabled={pageClamped <= 1}
                  title="Primera página"
                >
                  «
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageClamped <= 1}
                >
                  ‹ Anterior
                </button>
                <span className="muted small page-info">
                  Página {pageClamped} de {totalPages}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageClamped >= totalPages}
                >
                  Siguiente ›
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage(totalPages)}
                  disabled={pageClamped >= totalPages}
                  title="Última página"
                >
                  »
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
