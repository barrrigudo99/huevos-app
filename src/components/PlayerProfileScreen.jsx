import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, Star } from 'lucide-react'
import {
  fetchPlayerProfile,
  fetchPositions,
  fetchRatingsHistory,
  updatePlayerProfile,
  uploadPlayerPhoto,
  changePassword,
} from '../api'

// Paleta e identidad tipográfica del mockup aprobado — valores exactos, no
// tocar (ver conversación de rediseño de Perfil).
const COLORS = {
  ink: '#10241C',
  pitch: '#1B4332',
  grass: '#4C9A6A',
  paper: '#F2F3EC',
  yolk: '#E3A63E',
  rose: '#E0577A',
  line: '#DEDBC8',
  secondary: '#5B6F63',
  // Colores de la equipación — cabecera de la tarjeta de perfil.
  kitInk: '#0A0A0A',
  kitRed: '#C41E2A',
  kitSand: '#faf7f2',
  kitGold: '#B8860B',
}

const FONT_DISPLAY = "'Space Grotesk', sans-serif"
const FONT_BODY = "'IBM Plex Sans', sans-serif"

// Los 4 atributos valorables, en el orden en que se pintan los 4 tramos del
// marco del octógono (arriba-dcha, abajo-dcha, abajo-izda, arriba-izda).
const ATTRS = [
  { key: 'avgEsfuerzo', label: 'Esfuerzo' },
  { key: 'avgEquipo', label: 'Equipo' },
  { key: 'avgLiderazgo', label: 'Liderazgo' },
  { key: 'avgImpacto', label: 'Impacto' },
]

// Octógono: path del marco y la máscara de la foto (mismos valores que el
// mockup 3a). Cada tramo del marco es un trozo del perímetro (SEG_LEN) que
// arranca en un SEG_OFFSET; el tramo "de valor" se rellena en proporción a
// la nota del atributo (0..5).
const OCT_D = 'M59 7 L95.8 22.2 L111 59 L95.8 95.8 L59 111 L22.2 95.8 L7 59 L22.2 22.2 Z'
const OCT_CLIP =
  'polygon(50% 0%, 85.36% 14.64%, 100% 50%, 85.36% 85.36%, 50% 100%, 14.64% 85.36%, 0% 50%, 14.64% 14.64%)'
const SEG_LEN = 71.6
const SEG_OFFSETS = [-4, -83.6, -163.2, -242.8]

function attrColor(v) {
  if (v == null || Number.isNaN(v)) return '#5f5347'
  if (v >= 4) return '#eebc59'
  if (v >= 3) return '#c9992f'
  return '#5f5347'
}

// Notas de los 4 atributos (null si aún no hay valoraciones) y su media.
function computeAttrs(stats) {
  const attrVals = ATTRS.map((a) => {
    const raw = stats?.[a.key]
    return raw == null ? null : Number(raw)
  })
  const present = attrVals.filter((v) => v != null && !Number.isNaN(v))
  const avg = present.length ? present.reduce((s, v) => s + v, 0) / present.length : null
  return { attrVals, avg }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fmtFecha(iso) {
  if (!iso) return null
  const [, mo, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!mo || !d) return String(iso).slice(0, 10)
  return `${d} ${MESES[mo - 1]}`
}

// Notas con coma decimal: un decimal para notas sueltas (4,7), dos para la
// media de cabecera (4,09), y siempre con signo para la diferencia (+0,64).
const fmt1 = (n) => Number(n).toFixed(1).replace('.', ',')
const fmt2 = (n) => Number(n).toFixed(2).replace('.', ',')
const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmt2(n)

function evoBarColor(v) {
  if (v >= 4) return '#eebc59'
  if (v >= 3.4) return '#c9992f'
  return '#2b2b2b'
}

// Barras = nota del jugador por jornada (color por tramo); línea = media del
// equipo (siempre #C41E2A). Se pintan las últimas 10 jornadas con nota.
function EvolutionChart({ rows }) {
  const data = rows.slice(-10)
  const W = 336
  const BASE = 110
  const TOP = 20
  const BW = 22
  const n = data.length
  const slot = n > 1 ? (W - BW) / (n - 1) : 0
  const x = (i) => (n > 1 ? i * slot : (W - BW) / 2)
  const y = (v) => BASE - (Math.max(0, Math.min(5, v)) / 5) * (BASE - TOP)

  const linePts = data
    .map((d, i) => (d.teamRating != null ? `${x(i) + BW / 2},${y(d.teamRating)}` : null))
    .filter(Boolean)
    .join(' ')

  return (
    <div className="p3-evo">
      <svg viewBox={`0 0 ${W} 132`} width="100%">
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="#1c1c1c" strokeWidth="1" />
        {data.map((d, i) =>
          d.rating != null ? (
            <rect
              key={`b${i}`}
              x={x(i)}
              y={y(d.rating)}
              width={BW}
              height={BASE - y(d.rating)}
              rx="3"
              fill={evoBarColor(d.rating)}
            />
          ) : null
        )}
        {linePts && (
          <polyline points={linePts} fill="none" stroke="#C41E2A" strokeWidth="2" strokeLinejoin="round" />
        )}
        {data.map((d, i) =>
          i === 0 || i === n - 1 || i % 3 === 0 ? (
            <text
              key={`t${i}`}
              x={x(i) + BW / 2}
              y="126"
              textAnchor="middle"
              style={{
                fontFamily: FONT_BODY,
                fontSize: 9,
                fill: i === n - 1 ? '#eebc59' : 'rgba(242,243,236,.58)',
              }}
            >
              J{d.matchday}
            </text>
          ) : null
        )}
      </svg>
      <div className="p3-evo-legend">
        <span>
          <span className="p3-evo-swatch-bar" /> Su nota
        </span>
        <span>
          <span className="p3-evo-swatch-line" /> Media del equipo
        </span>
      </div>
    </div>
  )
}

// Foto del jugador enmarcada en un octógono cuyo borde se ilumina, lado a
// lado, según la nota de cada atributo.
function Octagon({ photo, name, attrVals }) {
  return (
    <div className="p3-oct">
      <svg width="118" height="118" viewBox="0 0 118 118">
        {SEG_OFFSETS.map((off) => (
          <path
            key={`t${off}`}
            d={OCT_D}
            fill="none"
            stroke="#232323"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${SEG_LEN} 400`}
            strokeDashoffset={off}
          />
        ))}
        {attrVals.map((v, i) => {
          const dash = Math.max(0, Math.min(SEG_LEN, SEG_LEN * ((Number(v) || 0) / 5)))
          return (
            <path
              key={`v${i}`}
              d={OCT_D}
              fill="none"
              stroke={attrColor(v)}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} 400`}
              strokeDashoffset={SEG_OFFSETS[i]}
            />
          )
        })}
      </svg>
      <div className="p3-oct-photo" style={{ clipPath: OCT_CLIP }}>
        {photo ? (
          <img src={photo} alt={name} style={{ clipPath: OCT_CLIP }} />
        ) : (
          <span>{(name || '?').charAt(0)}</span>
        )}
      </div>
    </div>
  )
}

function Stat({ num, label }) {
  return (
    <div className="p3-stat">
      <p className="p3-stat-num">{num}</p>
      <p className="p3-stat-label">{label}</p>
    </div>
  )
}

function Section({ title, meta, open, onToggle, children }) {
  return (
    <div className="p3-sec">
      <button type="button" className="p3-sec-head" onClick={onToggle} aria-expanded={open}>
        <span className="p3-sec-title">{title}</span>
        {meta != null && <span className="p3-sec-meta">{meta}</span>}
        <span className="p3-sec-chev">{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </div>
  )
}

function Row({ label, value, accent, icon, last, labelColor = COLORS.ink }) {
  return (
    <div className="profile-stat-row" style={{ borderBottom: last ? 'none' : `1px solid ${COLORS.line}` }}>
      <span style={{ fontSize: 14, color: labelColor, fontFamily: FONT_BODY }}>{label}</span>
      <span
        className="profile-stat-value"
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 15,
          color: accent ? COLORS.yolk : COLORS.ink,
        }}
      >
        {icon}
        {value}
      </span>
    </div>
  )
}

function TabBar({ active, onChange }) {
  const tabs = [
    { id: 'estadisticas', label: 'Estadísticas' },
    { id: 'informacion', label: 'Información' },
  ]
  return (
    <div className="profile-tabbar" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
      {tabs.map((t) => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className="profile-tab"
            style={{
              padding: '8px 0',
              fontFamily: FONT_BODY,
              fontWeight: 500,
              fontSize: 13,
              color: isActive ? '#FFFFFF' : 'rgba(216,195,154,0.8)',
              backgroundColor: isActive ? COLORS.kitRed : 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="profile-field">
      <label style={{ fontSize: 12, color: COLORS.secondary, fontFamily: FONT_BODY }}>{label}</label>
      <div className="profile-field-control">{children}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${COLORS.line}`,
  fontSize: 14,
  color: COLORS.ink,
  fontFamily: FONT_BODY,
  backgroundColor: '#FFFFFF',
  outline: 'none',
  boxSizing: 'border-box',
}

// Letra y clase de color del badge de resultado (§4: victoria dorado, empate
// rojo, derrota gris — mismos colores que las clases .p3-res-G/E/P ya en CSS).
const RES_LETTER = { W: 'G', D: 'E', L: 'P' }

// Pestaña "Estadísticas" — mockup 3a: cuerpo en secciones plegables. Todos
// los datos son reales; "Evolución por jornada" y "Últimos partidos" vienen
// de stats.evolution / stats.lastMatches (endpoint ratings-history). Si un
// array llega vacío, su sección no se pinta.
function EstadisticasTab({ stats }) {
  const [openEvo, setOpenEvo] = useState(true)
  const [openAttr, setOpenAttr] = useState(true)
  const [openMatches, setOpenMatches] = useState(true)

  const { attrVals } = computeAttrs(stats)
  const tarj = `${stats.yellowCards ?? 0}/${stats.redCards ?? 0}`
  const evolution = Array.isArray(stats.evolution) ? stats.evolution : []
  const lastMatches = Array.isArray(stats.lastMatches) ? stats.lastMatches : []

  return (
    <div className="p3-body">
      <div className="p3-statgrid">
        <Stat num={stats.matchesPlayed ?? 0} label="Part." />
        <Stat num={stats.goals ?? 0} label="Goles" />
        <Stat num={stats.assists ?? 0} label="Asist." />
        <Stat num={tarj} label="Tarj." />
      </div>

      <div className="p3-conv">
        <div className="p3-conv-head">
          <span className="p3-conv-label">Convocatorias</span>
          <span className="p3-conv-pct">
            {stats.attendancePct != null ? `${stats.attendancePct}%` : '—'}
          </span>
        </div>
        <div className="p3-track">
          <div className="p3-fill" style={{ width: `${stats.attendancePct ?? 0}%` }} />
        </div>
      </div>

      <div className="p3-mvp">
        <Star size={13} color="#eebc59" fill="#eebc59" />
        <span className="p3-mvp-label">MVP recibidos</span>
        <span className="p3-mvp-val">{stats.mvpsRecibidos ?? 0}</span>
      </div>

      {evolution.length > 0 && (
        <Section
          title="Evolución por jornada"
          meta="últimas 10"
          open={openEvo}
          onToggle={() => setOpenEvo((v) => !v)}
        >
          <div className="p3-sec-body">
            <EvolutionChart rows={evolution} />
          </div>
        </Section>
      )}

      <Section title="Atributos" open={openAttr} onToggle={() => setOpenAttr((v) => !v)}>
        <div className="p3-sec-body p3-attrs">
          {ATTRS.map((a, i) => {
            const v = attrVals[i]
            return (
              <div className="p3-attr-row" key={a.key}>
                <span className="p3-attr-label">{a.label}</span>
                <span className="p3-attr-track">
                  <span
                    className="p3-attr-fill"
                    style={{ width: `${((Number(v) || 0) / 5) * 100}%`, background: attrColor(v) }}
                  />
                </span>
                <span className="p3-attr-val">{v != null ? fmt1(v) : '—'}</span>
              </div>
            )
          })}
        </div>
      </Section>

      {lastMatches.length > 0 && (
        <Section
          title="Últimos partidos"
          meta={lastMatches.length}
          open={openMatches}
          onToggle={() => setOpenMatches((v) => !v)}
        >
          <div className="p3-sec-body">
            {lastMatches.map((m, idx) => {
              const parts = []
              if (m.goals) parts.push(`${m.goals} G`)
              if (m.assists) parts.push(`${m.assists} A`)
              if (m.redCards) parts.push('roja')
              else if (m.yellowCards) parts.push('amarilla')
              if (m.mvp) parts.push('MVP')
              const meta = [`J${m.matchday ?? '—'}`, fmtFecha(m.date), ...parts]
                .filter(Boolean)
                .join(' · ')
              return (
                <div className="p3-match" key={`${m.matchday}-${m.date}-${idx}`}>
                  <span className={`p3-match-badge p3-res-${RES_LETTER[m.result] || 'E'}`}>
                    {RES_LETTER[m.result] || 'E'}
                  </span>
                  <div className="p3-match-main">
                    <p className="p3-match-title">
                      {m.opponent || '—'}{' '}
                      <span>
                        {m.goalsFor}-{m.goalsAgainst}
                      </span>
                    </p>
                    <p className="p3-match-meta">{meta}</p>
                  </div>
                  {m.rating != null && (
                    <span
                      className="p3-match-rating"
                      style={{ color: m.rating >= 4.5 ? '#eebc59' : '#faf7f2' }}
                    >
                      {fmt1(m.rating)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

// Tab "Información" en modo edición (solo cuando es tu propio perfil). Pide
// la contraseña actual para poder cambiarla — no está en el mockup original,
// pero sin sesión/token en esta app (solo X-User-Id por cabecera) es la
// única forma de que cambiar la contraseña de otra persona requiera saber
// algo que solo ella sabe.
function InformacionTabEditable({ playerId, currentUserId, initial, positions, onSaved }) {
  const [nombre, setNombre] = useState(initial.name || '')
  const [fechaNacimiento, setFechaNacimiento] = useState(initial.birthDate || '')
  const [posicion, setPosicion] = useState(initial.positionCode || '')
  const [telefono, setTelefono] = useState(initial.phone || '')
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const [errorFoto, setErrorFoto] = useState('')

  const [passwordActual, setPasswordActual] = useState('')
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function leerArchivoComoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const [, base64] = String(reader.result).split(',')
        resolve(base64)
      }
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
      reader.readAsDataURL(file)
    })
  }

  async function handleFotoChange(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setSubiendoFoto(true)
    setErrorFoto('')
    try {
      const photoBase64 = await leerArchivoComoBase64(file)
      await uploadPlayerPhoto(playerId, { photoBase64, contentType: file.type }, currentUserId)
    } catch (err) {
      setErrorFoto(err.message)
    } finally {
      setSubiendoFoto(false)
    }
  }

  async function handleGuardar() {
    setError('')
    setSaved(false)

    const cambiandoPassword = passwordActual || nuevaPassword || confirmarPassword
    if (cambiandoPassword) {
      if (!passwordActual) {
        setError('Escribe tu contraseña actual para poder cambiarla.')
        return
      }
      if (nuevaPassword.length < 6) {
        setError('La nueva contraseña debe tener al menos 6 caracteres.')
        return
      }
      if (nuevaPassword !== confirmarPassword) {
        setError('Las contraseñas no coinciden.')
        return
      }
    }

    setSaving(true)
    try {
      await updatePlayerProfile(
        playerId,
        { name: nombre, birthDate: fechaNacimiento || null, positionCode: posicion, phone: telefono },
        currentUserId
      )
      if (cambiandoPassword) {
        await changePassword(currentUserId, { currentPassword: passwordActual, newPassword: nuevaPassword })
        setPasswordActual('')
        setNuevaPassword('')
        setConfirmarPassword('')
      }
      setSaved(true)
      await onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Field label="Foto">
        <div className="profile-photo-row">
          <label
            className="profile-photo-btn"
            style={{
              fontSize: 13,
              color: COLORS.ink,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            <Camera size={15} color={COLORS.secondary} />
            {subiendoFoto ? 'Subiendo...' : 'Cambiar foto'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFotoChange} style={{ display: 'none' }} disabled={subiendoFoto} />
          </label>
        </div>
        {errorFoto && <p style={{ fontSize: 13, color: COLORS.rose, marginTop: 8 }}>{errorFoto}</p>}
      </Field>

      <Field label="Nombre">
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} style={inputStyle} />
      </Field>

      <Field label="Fecha de nacimiento">
        <input
          type="date"
          value={fechaNacimiento}
          onChange={(e) => setFechaNacimiento(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Posición">
        <select value={posicion} onChange={(e) => setPosicion(e.target.value)} style={inputStyle}>
          {positions.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Teléfono">
        <input
          type="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+34 600 000 000"
          style={inputStyle}
        />
      </Field>

      <Field label="Contraseña actual">
        <input
          type="password"
          value={passwordActual}
          onChange={(e) => setPasswordActual(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Nueva contraseña">
        <input
          type="password"
          value={nuevaPassword}
          onChange={(e) => setNuevaPassword(e.target.value)}
          placeholder="Mínimo 6 caracteres"
          style={inputStyle}
        />
      </Field>
      <Field label="Confirmar contraseña">
        <input
          type="password"
          value={confirmarPassword}
          onChange={(e) => setConfirmarPassword(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {error && <p style={{ fontSize: 13, color: COLORS.rose, marginBottom: 12 }}>{error}</p>}
      {saved && !error && <p style={{ fontSize: 13, color: COLORS.grass, marginBottom: 12 }}>Cambios guardados.</p>}

      <button
        type="button"
        onClick={handleGuardar}
        className="profile-save-btn"
        disabled={saving}
        style={{
          padding: '12px 0',
          backgroundColor: COLORS.kitRed,
          color: COLORS.paper,
          fontFamily: FONT_BODY,
          fontWeight: 500,
          fontSize: 14,
          border: 'none',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </div>
  )
}

// Tab "Información" en modo lectura: se ve al entrar al perfil de un
// compañero desde Plantilla. Sin edición ni cambio de contraseña — eso solo
// tiene sentido en tu propio perfil.
function InformacionTabReadOnly({ data }) {
  return (
    <div>
      <Row label="Nombre" value={data.name || '—'} />
      <Row label="Fecha de nacimiento" value={data.birthDate || '—'} />
      <Row label="Posición" value={data.positionLabel || '—'} />
      <Row label="Teléfono" value={data.phone || '—'} last />
    </div>
  )
}

export default function PlayerProfileScreen({ player, onBack, currentUser }) {
  const [tab, setTab] = useState('estadisticas')
  const [profile, setProfile] = useState(null)
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isOwnProfile = Boolean(currentUser?.player_id) && currentUser.player_id === player.id

  function cargarPerfil() {
    setLoading(true)
    setError('')
    return Promise.all([
      fetchPlayerProfile(player.id),
      // El histórico de notas es opcional: si falla, el perfil se pinta igual
      // y las secciones que dependen de él simplemente no aparecen.
      fetchRatingsHistory(player.id).catch(() => ({ evolution: [], lastMatches: [] })),
    ])
      .then(([prof, hist]) => {
        const evolution = Array.isArray(hist?.evolution) ? hist.evolution : []
        const lastMatches = Array.isArray(hist?.lastMatches) ? hist.lastMatches : []
        // Diferencia vs la media del equipo: media de sus notas por jornada
        // menos la media de las notas del equipo en esas mismas jornadas.
        const pRows = evolution.filter((e) => e.rating != null)
        const tRows = evolution.filter((e) => e.teamRating != null)
        const pAvg = pRows.length ? pRows.reduce((s, e) => s + e.rating, 0) / pRows.length : null
        const tAvg = tRows.length ? tRows.reduce((s, e) => s + e.teamRating, 0) / tRows.length : null
        const ratingDelta = pAvg != null && tAvg != null ? pAvg - tAvg : null
        setProfile({
          ...prof,
          stats: { ...prof.stats, evolution, lastMatches, teamAvgRating: tAvg, ratingDelta },
        })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    cargarPerfil()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id])

  useEffect(() => {
    if (!isOwnProfile) return
    fetchPositions()
      .then(setPositions)
      .catch(() => {})
  }, [isOwnProfile])

  const { attrVals, avg } = computeAttrs(profile?.stats)

  return (
    <div className="stats">
      {onBack && (
        <button className="btn-outline small" onClick={onBack}>
          <ChevronLeft size={14} /> Volver a la plantilla
        </button>
      )}

      {loading && <p className="hint">Cargando perfil...</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && profile && (
        <div className="profile-card" style={{ fontFamily: FONT_BODY }}>
          <div
            className="profile-hero"
            style={{ backgroundColor: COLORS.kitInk, borderBottom: `3px solid ${COLORS.kitRed}` }}
          >
            <div className="p3-hero-row">
              <Octagon photo={profile.photo} name={profile.name} attrVals={attrVals} />
              <div className="p3-hero-info">
                <p className="p3-name">{profile.name}</p>
                <p className="p3-sub">
                  {profile.positionLabel || 'Sin posición'}
                  {player?.number != null ? ` · Dorsal ${player.number}` : ''}
                </p>
                {avg != null && (
                  <div className="p3-avg-row">
                    <span className="p3-avg">{fmt2(avg)}</span>
                    {profile.stats?.ratingDelta != null && (
                      <span className="p3-avg-delta">{fmtSigned(profile.stats.ratingDelta)} vs equipo</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <TabBar active={tab} onChange={setTab} />
          </div>

          <div className="profile-body">
            {tab === 'estadisticas' ? (
              <EstadisticasTab stats={profile.stats} />
            ) : isOwnProfile ? (
              <InformacionTabEditable
                playerId={profile.id}
                currentUserId={currentUser.id}
                initial={profile}
                positions={positions}
                onSaved={cargarPerfil}
              />
            ) : (
              <InformacionTabReadOnly data={profile} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
