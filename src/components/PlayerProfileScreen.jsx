import { useEffect, useState } from 'react'
import { ChevronLeft, Star, Camera, Lock } from 'lucide-react'
import {
  fetchPlayerProfile,
  fetchPositions,
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
}

const FONT_DISPLAY = "'Space Grotesk', sans-serif"
const FONT_BODY = "'IBM Plex Sans', sans-serif"

function StarRating({ value, max = 5 }) {
  const filled = Math.round(value)
  return (
    <div className="profile-star-rating">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={16}
          color={i < filled ? COLORS.yolk : 'rgba(242,243,236,0.3)'}
          fill={i < filled ? COLORS.yolk : 'rgba(242,243,236,0.3)'}
        />
      ))}
    </div>
  )
}

function polarPoint(cx, cy, angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) }
}

function sectorPath(cx, cy, centerAngle, radius) {
  const start = polarPoint(cx, cy, centerAngle - 45, radius)
  const end = polarPoint(cx, cy, centerAngle + 45, radius)
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y} Z`
}

function AttributeWheel({ data, max = 5, threshold = 3.5 }) {
  const cx = 180
  const cy = 160
  const maxR = 66
  const badgeOffset = 86
  const badgeR = 14
  const labelOffset = 114
  const anchorFor = (angle) => {
    if (angle === 90) return 'start'
    if (angle === 270) return 'end'
    return 'middle'
  }

  return (
    <svg width="100%" viewBox="0 0 360 320" style={{ display: 'block' }}>
      {Array.from({ length: max }, (_, i) => (i + 1) / max).map((f) => (
        <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="rgba(242,243,236,0.3)" strokeWidth={1.5} />
      ))}
      {[45, 135, 225, 315].map((a) => {
        const p = polarPoint(cx, cy, a, maxR)
        return <line key={a} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(242,243,236,0.3)" strokeWidth={1.5} />
      })}

      {data.map((d, i) => {
        const angle = i * 90
        const radius = maxR * (d.value / max)
        const weak = d.value < threshold
        const fill = weak ? COLORS.rose : COLORS.grass
        const badgePos = polarPoint(cx, cy, angle, badgeOffset)
        const labelPos = polarPoint(cx, cy, angle, labelOffset)
        return (
          <g key={d.subject}>
            <path d={sectorPath(cx, cy, angle, radius)} fill={fill} fillOpacity={0.8} />
            <circle cx={badgePos.x} cy={badgePos.y} r={badgeR} fill={fill} stroke={COLORS.pitch} strokeWidth={2} />
            <text
              x={badgePos.x}
              y={badgePos.y + 4}
              textAnchor="middle"
              style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, fill: '#FFFFFF' }}
            >
              {d.value.toFixed(1)}
            </text>
            <text
              x={labelPos.x}
              y={labelPos.y + 4}
              textAnchor={anchorFor(angle)}
              style={{ fontFamily: FONT_BODY, fontSize: 11, fill: 'rgba(242,243,236,0.85)' }}
            >
              {d.subject}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Row({ label, value, accent, icon, last }) {
  return (
    <div className="profile-stat-row" style={{ borderBottom: last ? 'none' : `1px solid ${COLORS.line}` }}>
      <span style={{ fontSize: 14, color: COLORS.ink, fontFamily: FONT_BODY }}>{label}</span>
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
    <div className="profile-tabbar" style={{ backgroundColor: COLORS.line + '55' }}>
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
              color: isActive ? COLORS.paper : COLORS.secondary,
              backgroundColor: isActive ? COLORS.pitch : 'transparent',
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

function EstadisticasTab({ stats }) {
  const radarData = [
    { subject: 'Esfuerzo', value: stats.avgEsfuerzo ?? 0 },
    { subject: 'Equipo', value: stats.avgEquipo ?? 0 },
    { subject: 'Liderazgo', value: stats.avgLiderazgo ?? 0 },
    { subject: 'Impacto', value: stats.avgImpacto ?? 0 },
  ]
  const media = radarData.reduce((sum, d) => sum + d.value, 0) / radarData.length

  return (
    <>
      <div className="profile-wheel-card" style={{ backgroundColor: COLORS.pitch }}>
        <div className="profile-wheel-header">
          <span style={{ fontSize: 12, color: 'rgba(242,243,236,0.65)' }}>Valoración media</span>
          <StarRating value={media} />
        </div>
        <AttributeWheel data={radarData} />
      </div>

      <div className="profile-attendance">
        <div className="profile-attendance-header">
          <span style={{ fontSize: 13, color: COLORS.secondary }}>Asistencia a convocatorias</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: COLORS.ink }}>
            {stats.attendancePct !== null ? `${stats.attendancePct}%` : '—'}
          </span>
        </div>
        <div className="profile-progress-track" style={{ height: 8, backgroundColor: COLORS.line }}>
          <div
            className="profile-progress-fill"
            style={{ width: `${stats.attendancePct ?? 0}%`, backgroundColor: COLORS.grass }}
          />
        </div>
      </div>

      <div className="profile-stats-grid">
        <div className="profile-stats-cell-left" style={{ borderRight: `1px solid ${COLORS.line}` }}>
          <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, color: COLORS.ink }}>{stats.goals}</p>
          <p style={{ fontSize: 12, color: COLORS.secondary }}>Goles</p>
        </div>
        <div className="profile-stats-cell-right">
          <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, color: COLORS.ink }}>{stats.assists}</p>
          <p style={{ fontSize: 12, color: COLORS.secondary }}>Asistencias</p>
        </div>
      </div>

      <div>
        <Row label="Amarillas" value={stats.yellowCards} />
        <Row label="Rojas" value={stats.redCards} />
        <Row
          label="MVPs recibidos"
          value={stats.mvpsRecibidos}
          accent
          last
          icon={<Star size={14} color={COLORS.yolk} fill={COLORS.yolk} />}
        />
      </div>
    </>
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

      <div className="profile-password-heading" style={{ color: COLORS.secondary }}>
        <Lock size={14} />
        <span style={{ fontSize: 12 }}>Cambiar contraseña</span>
      </div>
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
          backgroundColor: COLORS.pitch,
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
    return fetchPlayerProfile(player.id)
      .then(setProfile)
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
          <div className="profile-header-row">
            <div
              className="profile-avatar-circle"
              style={{ width: 52, height: 52, backgroundColor: COLORS.pitch, border: `2px solid ${COLORS.grass}` }}
            >
              {profile.photo ? (
                <img src={profile.photo} alt="Foto de perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: COLORS.paper }}>
                  {profile.name.charAt(0)}
                </span>
              )}
            </div>
            <div>
              <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 17, color: COLORS.ink }}>
                {profile.name}
              </p>
              <p style={{ fontSize: 13, color: COLORS.secondary }}>Huevos FC · {profile.positionLabel || 'Sin posición'}</p>
            </div>
          </div>

          <TabBar active={tab} onChange={setTab} />

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
      )}
    </div>
  )
}
