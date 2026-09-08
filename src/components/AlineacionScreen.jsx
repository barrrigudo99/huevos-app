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

// Huecos del 1-3-2-1, con la y repartida para que las cartas no se solapen.
const SLOTS = [
  { id: 'fw', pos: 'DEL', x: 50, y: 13 },
  { id: 'vol1', pos: 'VOL', x: 24, y: 33 },
  { id: 'vol2', pos: 'VOL', x: 76, y: 32 },
  { id: 'lat1', pos: 'LAT', x: 17, y: 58 },
  { id: 'lat2', pos: 'LAT', x: 83, y: 57 },
  { id: 'cen', pos: 'CEN', x: 50, y: 67 },
  { id: 'gk', pos: 'POR', x: 50, y: 89 },
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

// Iconos de las acciones que se pintan en la placa de la carta. La roja directa
// y la doble amarilla comparten tarjetaRoja=true en los datos (ver esExpulsado
// en MatchStatsPanel); amarillas distingue cuál de las dos fue.
function statsToIcons(stats) {
  if (!stats) return []
  const icons = []
  if (stats.goles > 0) icons.push({ src: golIcon, alt: 'Gol', n: stats.goles })
  if (stats.asistencias > 0) icons.push({ src: asistenciaIcon, alt: 'Asistencia', n: stats.asistencias })
  if (stats.amarillas >= 2) icons.push({ src: dobleAmarillaIcon, alt: 'Doble amarilla', n: 1, card: true })
  else if (stats.tarjetaRoja) icons.push({ src: tarjetaRojaIcon, alt: 'Tarjeta roja', n: 1, card: true })
  else if (stats.amarillas === 1) icons.push({ src: tarjetaAmarillaIcon, alt: 'Tarjeta amarilla', n: 1, card: true })
  return icons
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// Carta tipo "cromo" de un jugador: zona de foto con dorsal y estado, y placa
// inferior con nombre, posición y los iconos de sus acciones en el partido.
function LineupCard({ player, pos, offPosition = false, stats = null, showStatus = false, onClick }) {
  const icons = statsToIcons(stats)
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className="al-card"
      onClick={onClick}
      title={offPosition ? `${player.name} (fuera de posición)` : player.name}
    >
      <div className="al-card-photo">
        <span className="al-card-stripe al-card-stripe-red" />
        <span className="al-card-stripe al-card-stripe-gold" />
        <span className="al-card-dorsal">{player.number}</span>
        {showStatus &&
          (offPosition ? (
            <span className="al-card-status al-card-status-off">*</span>
          ) : (
            <span className="al-card-status al-card-status-ok">
              <CheckIcon />
            </span>
          ))}
        <div className="al-card-avatar">
          <PlayerAvatar player={player} fallback="initials" />
        </div>
      </div>
      <div className="al-card-plate">
        <p className="al-card-name">{player.name.split(' ')[0]}</p>
        <p className="al-card-pos">
          {pos}
          {offPosition ? ' *' : ''}
        </p>
        {icons.length > 0 && (
          <div className="al-card-icons">
            {icons.map((ic, i) => (
              <span key={i} className={`al-card-icon ${ic.card ? 'al-card-icon-card' : ''}`} title={ic.alt}>
                <img src={ic.src} alt={ic.alt} />
                {ic.n > 1 && <span className="al-card-mult">×{ic.n}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </Tag>
  )
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
  // el icono correspondiente en su carta. Solo tiene sentido una vez jugado
  // (antes no hay player_match_stats que consultar).
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
    <div className="al-wrap">
      <div className="al-status">
        <span className="al-status-label">
          {jugado ? 'Alineación · partido jugado' : 'Alineación · por jugar'}
        </span>
      </div>

      <div className="al-panel">
        <div className="al-rate-row">
          <button
            type="button"
            className="al-rate-btn"
            disabled={!jugado}
            onClick={() => setView('rating')}
          >
            {jugado ? 'Valorar partido' : 'Disponible tras el partido'}
          </button>
        </div>

        <p className="al-label">
          Convocatoria ({convocadoPlayers.length}/{players.length})
        </p>
        <div className="al-chips">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`al-chip ${convocados.includes(p.id) ? 'selected' : ''}`}
              onClick={() => toggleConvocado(p.id)}
            >
              {p.number} {p.name.split(' ')[0]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="al-generate"
          onClick={handleGenerate}
          disabled={convocadoPlayers.length === 0}
        >
          Generar alineación prevista
        </button>

        <div className={`al-pitch ${jugado ? 'played' : ''}`}>
          <div
            className="al-pitch-bg"
            style={{ backgroundImage: `url(${jugado ? campoAlineacionGris : campoAlineacion})` }}
          />
          {SLOTS.map((slot) => {
            const player = players.find((p) => p.id === assignments[slot.id])
            const isOffPosition = offPositionSlots.has(slot.id)
            const style = { left: slot.x + '%', top: slot.y + '%' }
            return (
              <div className="al-slot" key={slot.id} style={style}>
                {player ? (
                  <LineupCard
                    player={player}
                    pos={slot.pos}
                    offPosition={isOffPosition}
                    stats={statsByPlayerId[player.id] || null}
                    showStatus={!jugado}
                    onClick={() => assign(slot.id, '')}
                  />
                ) : (
                  <label className="al-slot-empty">
                    <span className="al-slot-pos">{slot.pos}</span>
                    <select
                      value={assignments[slot.id] ?? ''}
                      onChange={(e) => assign(slot.id, e.target.value)}
                    >
                      <option value="">–</option>
                      {convocadoPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number}
                          {(p.positions || []).includes(slot.pos) ? '' : ' *'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )
          })}
        </div>
        <p className="al-label al-label-muted">* fuera de su posición habitual</p>

        {suplentes.length > 0 && (
          <>
            <p className="al-label">Suplentes</p>
            <div className="al-bench">
              {suplentes.map((p) => (
                <LineupCard
                  key={p.id}
                  player={p}
                  pos={(p.positions || [])[0] || '—'}
                  stats={statsByPlayerId[p.id] || null}
                  showStatus={!jugado}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
