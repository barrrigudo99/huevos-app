import { useEffect, useMemo, useState } from 'react'
import { fetchConvocatoriaHistory, fetchEstadisticasPersonales } from '../api'
import { calculateAttendance } from '../utils/attendance'
import PlayerAvatar from './PlayerAvatar'
import RatingPanel from './RatingPanel'
import campoAlineacion from './icons/campo-alineacion.png'
import campoAlineacionGris from './icons/campo-alineacion-gris.png'
import golIcon from './icons/gol.png'
import asistenciaIcon from './icons/asistencia.png'
import tarjetaAmarillaIcon from './icons/tarjeta_amarilla.png'
import tarjetaRojaIcon from './icons/tarjeta_roja.png'
import dobleAmarillaIcon from './icons/doble_amarilla.png'

const SLOTS = [
  { id: 'gk', pos: 'POR', x: 50, y: 90 },
  { id: 'cen', pos: 'CEN', x: 50, y: 72 },
  { id: 'lat1', pos: 'LAT', x: 18, y: 62 },
  { id: 'lat2', pos: 'LAT', x: 82, y: 62 },
  { id: 'vol1', pos: 'VOL', x: 30, y: 36 },
  { id: 'vol2', pos: 'VOL', x: 70, y: 36 },
  { id: 'fw', pos: 'DEL', x: 50, y: 12 },
]

function generateLineup(pool, slots, attendanceById) {
  const byAttendance = (a, b) => (attendanceById[b.id] ?? 0) - (attendanceById[a.id] ?? 0)
  const used = new Set()
  const assignments = {}

  // Primera pasada: solo huecos cuya posición coincide con la del jugador.
  slots.forEach((slot) => {
    const candidate = pool
      .filter((p) => !used.has(p.id) && (p.positions || []).includes(slot.pos))
      .sort(byAttendance)[0]
    if (candidate) {
      assignments[slot.id] = candidate.id
      used.add(candidate.id)
    }
  })

  // Segunda pasada: huecos que quedaron vacíos, sin importar posición.
  const offPosition = new Set()
  const leftovers = pool.filter((p) => !used.has(p.id)).sort(byAttendance)
  slots
    .filter((slot) => !assignments[slot.id])
    .forEach((slot) => {
      const candidate = leftovers.shift()
      if (candidate) {
        assignments[slot.id] = candidate.id
        used.add(candidate.id)
        offPosition.add(slot.id)
      }
    })

  return { assignments, offPosition }
}

export default function AlineacionScreen({
  players,
  convocadosDelPartido,
  currentUser,
  matchId,
  jugado = false,
  jornada,
  rival,
}) {
  const [assignments, setAssignments] = useState({})
  const [offPositionSlots, setOffPositionSlots] = useState(new Set())
  const [convocados, setConvocados] = useState(() => convocadosDelPartido.map((p) => p.id))
  const [history, setHistory] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  // 'lineup' = la pizarra de siempre; 'rating' = panel "Valorar partido".
  const [view, setView] = useState('lineup')
  // Quién marcó gol/asistencia/tarjeta en este partido concreto, para pintar
  // el icono correspondiente en su pitch-slot. Solo tiene sentido una vez
  // jugado (antes no hay player_match_stats que consultar).
  const [statsByPlayerId, setStatsByPlayerId] = useState({})

  useEffect(() => {
    fetchConvocatoriaHistory()
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [])

  useEffect(() => {
    if (!jugado || !matchId) {
      setStatsByPlayerId({})
      return
    }
    fetchEstadisticasPersonales()
      .then((partidos) => {
        const partido = partidos.find((p) => p.id === matchId)
        const map = {}
        ;(partido?.jugadores || []).forEach((j) => {
          if (j.goles > 0 || j.asistencias > 0 || j.amarillas > 0 || j.tarjetaRoja) {
            map[j.id] = j
          }
        })
        setStatsByPlayerId(map)
      })
      .catch(() => setStatsByPlayerId({}))
  }, [jugado, matchId])

  // La convocatoria editable de la pizarra sigue a la jornada mostrada en
  // NextMatchCard (convocadosDelPartido, ya sincronizada por el padre).
  useEffect(() => {
    setConvocados(convocadosDelPartido.map((p) => p.id))
  }, [convocadosDelPartido])

  // Jugador de la plantilla que es el usuario actual: player_id del backend
  // si lo trae, y si no, emparejado por nombre (mismo criterio que App.jsx).
  const selfPlayerId =
    currentUser?.player_id ??
    players.find(
      (p) => p.name.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()
    )?.id ??
    null

  // A quién se lista para valorar: los convocados 'Sí' de esta jornada; si el
  // usuario es jugador, se excluye a sí mismo (el entrenador ve a todos).
  const playersToRate =
    currentUser?.role === 'entrenador'
      ? convocadosDelPartido
      : convocadosDelPartido.filter((p) => p.id !== selfPlayerId)

  const convocadoPlayers = useMemo(
    () => players.filter((p) => convocados.includes(p.id)),
    [players, convocados]
  )

  const attendanceById = useMemo(() => {
    const map = {}
    convocadoPlayers.forEach((p) => {
      map[p.id] = calculateAttendance(p, history).pct ?? 0
    })
    return map
  }, [convocadoPlayers, history])

  const assignedIds = useMemo(
    () => new Set(Object.values(assignments).filter(Boolean)),
    [assignments]
  )

  const suplentes = useMemo(
    () =>
      [...convocadoPlayers]
        .filter((p) => !assignedIds.has(p.id))
        .sort((a, b) => (attendanceById[b.id] ?? 0) - (attendanceById[a.id] ?? 0)),
    [convocadoPlayers, assignedIds, attendanceById]
  )

  function toggleConvocado(id) {
    setConvocados((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  function handleGenerate() {
    const { assignments: next, offPosition } = generateLineup(convocadoPlayers, SLOTS, attendanceById)
    setAssignments(next)
    setOffPositionSlots(offPosition)
  }

  // Genera la alineación automáticamente en cuanto se abre el panel, sin
  // esperar a que el entrenador pulse "Generar alineación prevista" a mano.
  // Se espera a que cargue el historial de asistencia (historyLoaded) para
  // que el orden salga igual que si se pulsara el botón después de cargar; y
  // solo se dispara una vez (autoGenerated) para no pisar los ajustes
  // manuales del entrenador si luego cambia la convocatoria.
  const [autoGenerated, setAutoGenerated] = useState(false)
  useEffect(() => {
    if (autoGenerated || !historyLoaded || convocadoPlayers.length === 0) return
    handleGenerate()
    setAutoGenerated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, convocadoPlayers, autoGenerated])

  function assign(slotId, playerId) {
    setAssignments((prev) => ({ ...prev, [slotId]: playerId ? Number(playerId) : null }))
    setOffPositionSlots((prev) => {
      if (!prev.has(slotId)) return prev
      const next = new Set(prev)
      next.delete(slotId)
      return next
    })
  }

  if (view === 'rating') {
    return (
      <RatingPanel
        matchId={matchId}
        playersToRate={playersToRate}
        currentUser={currentUser}
        jornada={jornada}
        rival={rival}
        onBack={() => setView('lineup')}
      />
    )
  }

  return (
    <div className="pitch-wrap">
      <div className="plantilla-toolbar">
        <button
          type="button"
          className="rate-match-btn"
          disabled={!jugado}
          onClick={() => setView('rating')}
        >
          {jugado ? 'Valorar partido' : 'Disponible tras el partido'}
        </button>
      </div>

      <p className="hint">
        Convocatoria ({convocadoPlayers.length}/{players.length})
      </p>
      <div className="call-list">
        {players.map((p) => (
          <button
            key={p.id}
            className={`call-chip ${convocados.includes(p.id) ? 'selected' : ''}`}
            onClick={() => toggleConvocado(p.id)}
          >
            {p.number} {p.name.split(' ')[0]}
          </button>
        ))}
      </div>

      <button
        className="btn-primary full-width"
        onClick={handleGenerate}
        disabled={convocadoPlayers.length === 0}
      >
        Generar alineación prevista
      </button>

      <div
        className={`pitch ${jugado ? '' : 'pitch-locked'}`}
        style={{ backgroundImage: `url(${jugado ? campoAlineacionGris : campoAlineacion})` }}
      >
        {SLOTS.map((slot) => {
          const player = players.find((p) => p.id === assignments[slot.id])
          const isOffPosition = offPositionSlots.has(slot.id)
          const style = { left: slot.x + '%', top: slot.y + '%' }
          const playerStats = player ? statsByPlayerId[player.id] : null
          return (
            <div className="pitch-slot" key={slot.id} style={style}>
              <span className="pitch-slot-pos">{slot.pos}</span>
              {player ? (
                <button
                  type="button"
                  className="pitch-slot-photo"
                  onClick={() => assign(slot.id, '')}
                  title={isOffPosition ? `${player.name} (fuera de posición)` : player.name}
                >
                  <PlayerAvatar player={player} size="sm" fallback="blank" />
                  {isOffPosition && <span className="pitch-slot-star">*</span>}
                  {playerStats && (
                    <span className="pitch-slot-badges">
                      {playerStats.goles > 0 && (
                        <span
                          className="pitch-badge"
                          title={`${playerStats.goles} gol${playerStats.goles > 1 ? 'es' : ''}`}
                        >
                          <img src={golIcon} alt="Gol" className="pitch-badge-icon" />
                          {playerStats.goles > 1 && playerStats.goles}
                        </span>
                      )}
                      {playerStats.asistencias > 0 && (
                        <span
                          className="pitch-badge"
                          title={`${playerStats.asistencias} asistencia${playerStats.asistencias > 1 ? 's' : ''}`}
                        >
                          <img src={asistenciaIcon} alt="Asistencia" className="pitch-badge-icon" />
                          {playerStats.asistencias > 1 && playerStats.asistencias}
                        </span>
                      )}
                      {/* Doble amarilla y roja directa comparten tarjetaRoja=true en los
                          datos (ver esExpulsado en MatchStatsPanel); amarillas distingue
                          cuál de las dos fue. */}
                      {playerStats.amarillas >= 2 ? (
                        <span className="pitch-badge pitch-badge-card" title="Doble amarilla (expulsado)">
                          <img src={dobleAmarillaIcon} alt="Doble amarilla" className="pitch-badge-icon" />
                        </span>
                      ) : playerStats.tarjetaRoja ? (
                        <span className="pitch-badge pitch-badge-card" title="Tarjeta roja">
                          <img src={tarjetaRojaIcon} alt="Tarjeta roja" className="pitch-badge-icon" />
                        </span>
                      ) : playerStats.amarillas === 1 ? (
                        <span className="pitch-badge pitch-badge-card" title="Tarjeta amarilla">
                          <img src={tarjetaAmarillaIcon} alt="Tarjeta amarilla" className="pitch-badge-icon" />
                        </span>
                      ) : null}
                    </span>
                  )}
                </button>
              ) : (
                <select value={assignments[slot.id] ?? ''} onChange={(e) => assign(slot.id, e.target.value)}>
                  <option value="">-</option>
                  {convocadoPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number}
                      {(p.positions || []).includes(slot.pos) ? '' : ' *'}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
      </div>
      <p className="hint">* fuera de su posición habitual</p>

      {suplentes.length > 0 && (
        <>
          <p className="hint">Suplentes</p>
          <div className="bench-list">
            {suplentes.map((p) => (
              <div className="bench-player" key={p.id}>
                <PlayerAvatar player={p} size="sm" fallback="blank" />
                <span className="bench-player-name">{p.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
