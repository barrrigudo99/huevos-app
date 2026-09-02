import { useEffect, useMemo, useState } from 'react'
import { fetchConvocatoriaHistory } from '../api'
import { calculateAttendance } from '../utils/attendance'
import PlayerAvatar from './PlayerAvatar'
import RatingPanel from './RatingPanel'

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
  // 'lineup' = la pizarra de siempre; 'rating' = panel "Valorar partido".
  const [view, setView] = useState('lineup')

  useEffect(() => {
    fetchConvocatoriaHistory()
      .then(setHistory)
      .catch(() => {})
  }, [])

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

      <div className="pitch">
        {SLOTS.map((slot) => {
          const player = players.find((p) => p.id === assignments[slot.id])
          const isOffPosition = offPositionSlots.has(slot.id)
          const style = { left: slot.x + '%', top: slot.y + '%' }
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
