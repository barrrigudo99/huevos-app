import { useEffect, useMemo, useState } from 'react'
import { fetchCalendario, fetchConvocatoriaHistory, fetchConvocatoriaPorFecha } from '../api'
import { OUR_TEAM } from '../data/league'
import { calculateAttendance } from '../utils/attendance'
import PlayerAvatar from './PlayerAvatar'

function rivalDe(partido) {
  return partido.equipo_local === OUR_TEAM ? partido.equipo_visitante : partido.equipo_local
}

function formatFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-ES')
}

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

export default function AlineacionScreen({ players, listaConvocados }) {
  const [assignments, setAssignments] = useState({})
  const [offPositionSlots, setOffPositionSlots] = useState(new Set())
  const [convocados, setConvocados] = useState(() => listaConvocados.map((p) => p.id))
  const [history, setHistory] = useState([])

  const [calendario, setCalendario] = useState([])
  const [fechaSeleccionada, setFechaSeleccionada] = useState('')
  const [votosFechaLoading, setVotosFechaLoading] = useState(false)
  const [votosFechaError, setVotosFechaError] = useState('')

  useEffect(() => {
    fetchConvocatoriaHistory()
      .then(setHistory)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchCalendario()
      .then((partidos) => {
        const nuestros = partidos.filter(
          (p) => p.equipo_local === OUR_TEAM || p.equipo_visitante === OUR_TEAM
        )
        setCalendario(nuestros)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!fechaSeleccionada) {
      setConvocados(listaConvocados.map((p) => p.id))
      return
    }
    setVotosFechaLoading(true)
    setVotosFechaError('')
    fetchConvocatoriaPorFecha(fechaSeleccionada)
      .then((res) => {
        const votosFecha = res.votes || {}
        setConvocados(
          players.filter((p) => p.phone && votosFecha[p.phone] === 'Si').map((p) => p.id)
        )
      })
      .catch((err) => setVotosFechaError(err.message))
      .finally(() => setVotosFechaLoading(false))
  }, [fechaSeleccionada])

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

  return (
    <div className="pitch-wrap">
      <div className="plantilla-toolbar">
        <select
          className="date-filter"
          value={fechaSeleccionada}
          onChange={(e) => setFechaSeleccionada(e.target.value)}
        >
          <option value="">Convocatoria actual</option>
          {calendario.map((p) => (
            <option key={p.id} value={p.fecha}>
              J{p.jornada} · {formatFecha(p.fecha)} vs {rivalDe(p)}
            </option>
          ))}
        </select>
      </div>

      {votosFechaLoading && <p className="hint">Consultando convocatoria simulada...</p>}
      {!votosFechaLoading && votosFechaError && (
        <p className="auth-error">No se pudo consultar la convocatoria simulada: {votosFechaError}</p>
      )}

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
