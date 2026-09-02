import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Crown, Flame, Star, Users, Zap } from 'lucide-react'
import { fetchPlayerRatings, savePlayerRatings } from '../api'
import PlayerAvatar from './PlayerAvatar'
import RatingPanelRow from './RatingPanelRow'

// Los 4 criterios de valoración. `key` coincide con las columnas de
// player_ratings y con las claves del payload que espera el backend.
const CRITERIOS = [
  { key: 'impacto', label: 'Impacto', Icon: Zap, desc: 'Cómo pesó en el resultado, atacando o defendiendo.' },
  { key: 'esfuerzo', label: 'Esfuerzo', Icon: Flame, desc: 'Cuánto se vació físicamente por el equipo.' },
  { key: 'equipo', label: 'Equipo', Icon: Users, desc: 'Jugó para el grupo y no para su lucimiento.' },
  { key: 'liderazgo', label: 'Liderazgo', Icon: Crown, desc: 'Tiró del equipo más allá de su juego.' },
]

function ratingVacio() {
  return CRITERIOS.reduce((acc, c) => ({ ...acc, [c.key]: 0 }), {})
}

// Panel "Valorar partido": pestañas por criterio (cada una con su icono y su
// escala 1..5) + sección de MVP (selección única). Se nutre de
// `playersToRate` (los convocados 'Sí' de la jornada mostrada, ya sin la
// fila del propio usuario si es jugador) y guarda todo de golpe.
//
// Uso:
//   <RatingPanel matchId={partidoMostrado.matchId} playersToRate={...}
//                currentUser={currentUser} jornada={15} rival="Real Tornillo"
//                onBack={() => setView('lineup')} />
export default function RatingPanel({ matchId, playersToRate, currentUser, jornada, rival, onBack }) {
  const [ratings, setRatings] = useState({})
  const [mvpId, setMvpId] = useState(null)
  const [activeKey, setActiveKey] = useState(CRITERIOS[0].key)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const activeCriterio = useMemo(
    () => CRITERIOS.find((c) => c.key === activeKey) ?? CRITERIOS[0],
    [activeKey]
  )

  useEffect(() => {
    if (!matchId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    fetchPlayerRatings(matchId, currentUser.id)
      .then((res) => {
        const cargadas = {}
        playersToRate.forEach((p) => {
          cargadas[p.id] = { ...ratingVacio(), ...(res.ratings?.[p.id] || {}) }
        })
        setRatings(cargadas)
        setMvpId(res.mvpPlayerId ?? null)
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false))
    // playersToRate se deriva de props estables del padre para esta jornada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, currentUser.id])

  function setCriterio(playerId, n) {
    setRatings((prev) => ({
      ...prev,
      [playerId]: { ...ratingVacio(), ...prev[playerId], [activeKey]: n },
    }))
    setSaved(false)
  }

  function toggleMvp(playerId) {
    setMvpId((prev) => (prev === playerId ? null : playerId))
    setSaved(false)
  }

  async function handleGuardar() {
    setSaving(true)
    setSaveError('')
    try {
      const lista = playersToRate.map((p) => ({ playerId: p.id, ...(ratings[p.id] || ratingVacio()) }))
      const res = await savePlayerRatings(matchId, { ratings: lista, mvpPlayerId: mvpId }, currentUser.id)
      const normalizadas = {}
      playersToRate.forEach((p) => {
        normalizadas[p.id] = { ...ratingVacio(), ...(res.ratings?.[p.id] || {}) }
      })
      setRatings(normalizadas)
      setMvpId(res.mvpPlayerId ?? null)
      setSaved(true)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const subtitulo = [jornada ? `Jornada ${jornada}` : null, rival ? `vs ${rival}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="rating-panel">
      <div className="rating-panel-header">
        <button type="button" className="btn-outline small" onClick={onBack}>
          <ChevronLeft size={14} /> Volver a la alineación
        </button>
      </div>
      <p className="rating-panel-title">Valorar partido</p>
      {subtitulo && <p className="rating-panel-subtitle">{subtitulo}</p>}

      {loading && <p className="hint">Cargando valoraciones...</p>}
      {!loading && loadError && <p className="auth-error">{loadError}</p>}

      {!loading && !loadError && (
        <>
          {playersToRate.length === 0 ? (
            <p className="empty">No hay jugadores convocados para valorar en esta jornada.</p>
          ) : (
            <>
              <div className="rating-tabs" role="tablist">
                {CRITERIOS.map((c) => {
                  const activa = c.key === activeKey
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="tab"
                      aria-selected={activa}
                      className={`rating-tab ${activa ? 'active' : ''}`}
                      onClick={() => setActiveKey(c.key)}
                    >
                      <c.Icon size={16} />
                      <span>{c.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="rating-tab-desc">{activeCriterio.desc}</p>

              <div className="rating-panel-list">
                {playersToRate.map((p) => (
                  <RatingPanelRow
                    key={p.id}
                    player={p}
                    Icon={activeCriterio.Icon}
                    value={ratings[p.id]?.[activeKey] || 0}
                    onChange={(n) => setCriterio(p.id, n)}
                    disabled={saving}
                  />
                ))}
              </div>

              <p className="rating-panel-section-title">
                <Star size={18} fill="currentColor" /> MVP del partido
              </p>
              <p className="rating-tab-desc">Elige un único jugador como el más destacado del partido.</p>

              <div className="rating-panel-list">
                {playersToRate.map((p) => {
                  const seleccionado = mvpId === p.id
                  return (
                    <div className={`rating-panel-row mvp-row ${seleccionado ? 'selected' : ''}`} key={p.id}>
                      <div className="rating-panel-player">
                        <PlayerAvatar player={p} size="sm" />
                        <span className="rating-panel-name">{p.name}</span>
                        <span className="rating-panel-number">{p.number}</span>
                      </div>
                      <button
                        type="button"
                        className={`mvp-star ${seleccionado ? 'active' : ''}`}
                        disabled={saving}
                        aria-pressed={seleccionado}
                        aria-label={`Marcar a ${p.name} como MVP`}
                        onClick={() => toggleMvp(p.id)}
                      >
                        <Star size={20} fill={seleccionado ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  )
                })}
              </div>

              {saveError && <p className="auth-error">{saveError}</p>}
              <button
                type="button"
                className="btn-primary full-width"
                onClick={handleGuardar}
                disabled={saving}
              >
                {saving ? 'Guardando...' : saved ? 'Valoraciones guardadas' : 'Guardar valoraciones'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
