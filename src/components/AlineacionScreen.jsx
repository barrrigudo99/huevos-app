import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchConvocatoriaHistory } from '../api'
import { calculateAttendance } from '../utils/attendance'
import LineupCard from './LineupCard'
import RatingPanel from './RatingPanel'
import campoAlineacion from './icons/campo-alineacion.png'
import campoAlineacionGris from './icons/campo-alineacion-gris.png'

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

// Distancia (px) que hay que mover el dedo/ratón con la carta pulsada para
// que empiece el arrastre: por debajo, es un toque corto y no hace nada.
const DRAG_THRESHOLD = 6

// Destinos de soltar, como cadena en el atributo data-drop: 'slot:<slotId>'
// para una posición del campo (con o sin jugador) y 'bench:<playerId>' para
// una carta del banquillo.
function parseDropKey(key) {
  const i = key.indexOf(':')
  return { type: key.slice(0, i), value: key.slice(i + 1) }
}

export default function AlineacionScreen({
  players,
  convocadosDelPartido,
  currentUser,
  matchId,
  jugado = false,
  jornada,
  rival,
  // Estadísticas por partido (misma fuente que ya carga el padre para el
  // marcador de NextMatchCard / HistorialJornadas): se reciben por prop en
  // vez de volver a pedirlas aquí, para no duplicar la petición cada vez que
  // se abre este panel ni volver a esperar a la BBDD si el padre ya las tenía.
  estadisticasPersonales = [],
  estadisticasLoaded = true,
}) {
  const [assignments, setAssignments] = useState({})
  const [convocados, setConvocados] = useState(() => convocadosDelPartido.map((p) => p.id))
  const [history, setHistory] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  // 'lineup' = la pizarra de siempre; 'rating' = panel "Valorar partido".
  const [view, setView] = useState('lineup')

  useEffect(() => {
    fetchConvocatoriaHistory()
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [])

  // Quién marcó gol/asistencia/tarjeta en este partido concreto, para pintar
  // el icono correspondiente en su carta. Solo tiene sentido una vez jugado
  // (antes no hay player_match_stats que consultar).
  const statsByPlayerId = useMemo(() => {
    if (!jugado || !matchId) return {}
    const partido = estadisticasPersonales.find((p) => p.id === matchId)
    const map = {}
    ;(partido?.jugadores || []).forEach((j) => {
      if (j.goles > 0 || j.asistencias > 0 || j.amarillas > 0 || j.tarjetaRoja) {
        map[j.id] = j
      }
    })
    return map
  }, [jugado, matchId, estadisticasPersonales])

  // Mientras el padre todavía no ha resuelto estadisticasPersonales para un
  // partido ya jugado, no sabemos aún si hubo gol/asistencia/tarjeta: se
  // pinta un skeleton en vez de dar por hecho que no pasó nada.
  const statsLoading = jugado && !estadisticasLoaded

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
    setAssignments(generateLineup(convocadoPlayers, SLOTS, attendanceById).assignments)
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
  }

  // "Fuera de posición" se calcula a partir de las posiciones del jugador
  // (antes era un Set que solo rellenaba generateLineup), para que siga
  // siendo correcto tras arrastrar a un jugador a otra posición.
  function isOffPosition(player, slot) {
    return !(player.positions || []).includes(slot.pos)
  }

  // Intercambio al soltar una carta arrastrada. Las posiciones (SLOTS) no se
  // mueven nunca: solo cambia qué jugador ocupa cada una.
  //   campo -> campo: se intercambian (si el destino está vacío, se mueve).
  //   campo -> carta del banquillo: el del banquillo entra en esa posición y
  //     el de campo pasa al banquillo (el banquillo = convocados sin posición).
  //   banquillo -> campo: entra en la posición; quien la ocupaba, al banquillo.
  //   banquillo -> banquillo: nada (el banquillo se ordena por asistencia).
  function swapByDrop(fromKey, toKey) {
    if (fromKey === toKey) return
    const from = parseDropKey(fromKey)
    const to = parseDropKey(toKey)
    setAssignments((prev) => {
      const next = { ...prev }
      if (from.type === 'slot' && to.type === 'slot') {
        next[to.value] = prev[from.value] ?? null
        next[from.value] = prev[to.value] ?? null
      } else if (from.type === 'slot' && to.type === 'bench') {
        next[from.value] = Number(to.value)
      } else if (from.type === 'bench' && to.type === 'slot') {
        next[to.value] = Number(from.value)
      } else {
        return prev
      }
      return next
    })
  }

  // ---- Arrastre con Pointer Events (ratón y táctil) ----
  // dragRef guarda el gesto en curso sin provocar renders en cada movimiento;
  // la copia flotante se mueve directamente por su style (ghostRef). Solo se
  // re-renderiza al empezar/terminar el arrastre y al cambiar de destino.
  const dragRef = useRef(null)
  const ghostRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropOver, setDropOver] = useState(null)
  const swapRef = useRef(swapByDrop)
  swapRef.current = swapByDrop

  function startPointer(e, fromKey, player, pos, offPosition) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Evita selección de texto y el arrastre nativo de imágenes en escritorio.
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      fromKey,
      player,
      pos,
      offPosition,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      over: null,
    }
  }

  useEffect(() => {
    function moveGhost(d, x, y) {
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${x - d.offsetX}px, ${y - d.offsetY}px)`
      }
    }

    function onMove(e) {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
        d.active = true
        setDragging({ ...d, x: e.clientX, y: e.clientY })
      }
      e.preventDefault()
      moveGhost(d, e.clientX, e.clientY)
      // La copia flotante tiene pointer-events: none, así que esto devuelve
      // lo que hay debajo del dedo/ratón.
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const over = el?.closest?.('[data-drop]')?.getAttribute('data-drop') ?? null
      if (over !== d.over) {
        d.over = over
        setDropOver(over)
      }
    }

    function finish(e, drop) {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      // Soltar fuera de una posición (over = null) o sobre la de origen: la
      // carta vuelve a su sitio sin cambios.
      if (drop && d.active && d.over && d.over !== d.fromKey) swapRef.current(d.fromKey, d.over)
      dragRef.current = null
      setDragging(null)
      setDropOver(null)
    }

    const onUp = (e) => finish(e, true)
    const onCancel = (e) => finish(e, false)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [])

  // Clases de origen (atenuado) y destino (borde dorado) para una clave.
  function dropClass(key) {
    if (!dragging) return ''
    if (key === dragging.fromKey) return ' al-drag-origin'
    if (key === dropOver) return ' al-drop-over'
    return ''
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
        {/* <div className="al-chips">
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
        </div> */}

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
            const offPosition = player ? isOffPosition(player, slot) : false
            const style = { left: slot.x + '%', top: slot.y + '%' }
            const key = `slot:${slot.id}`
            return (
              <div className={`al-slot${dropClass(key)}`} key={slot.id} style={style} data-drop={key}>
                {player ? (
                  <LineupCard
                    player={player}
                    pos={slot.pos}
                    offPosition={offPosition}
                    stats={statsByPlayerId[player.id] || null}
                    showStatus={!jugado}
                    statsLoading={statsLoading}
                    onPointerDown={(e) => startPointer(e, key, player, slot.pos, offPosition)}
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
              {suplentes.map((p) => {
                const key = `bench:${p.id}`
                const pos = (p.positions || [])[0] || '—'
                return (
                  <div key={p.id} className={`al-bench-item${dropClass(key)}`} data-drop={key}>
                    <LineupCard
                      player={p}
                      pos={pos}
                      stats={statsByPlayerId[p.id] || null}
                      showStatus={!jugado}
                      statsLoading={statsLoading}
                      onPointerDown={(e) => startPointer(e, key, p, pos, false)}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Copia flotante de la carta que se arrastra. Va en un portal sobre
          document.body para que el BottomSheet (overflow: hidden) no la
          recorte; las clases .al-card no dependen del contenedor. */}
      {dragging &&
        createPortal(
          <div
            ref={ghostRef}
            className="al-drag-ghost"
            style={{
              width: dragging.width,
              transform: `translate(${dragging.x - dragging.offsetX}px, ${dragging.y - dragging.offsetY}px)`,
            }}
          >
            <LineupCard
              player={dragging.player}
              pos={dragging.pos}
              offPosition={dragging.offPosition}
              stats={statsByPlayerId[dragging.player.id] || null}
              showStatus={!jugado}
              statsLoading={statsLoading}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
