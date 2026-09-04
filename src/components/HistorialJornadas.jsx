import { useState } from 'react'
import useLongPress from '../hooks/useLongPress'
import BottomSheet from './BottomSheet'

function iniciales(nombre) {
  return (nombre || '')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

function formatFechaCorta(fecha) {
  if (!fecha) return ''
  return new Date(fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

// V = victoria (--gold), D = derrota (--accent), E = empate (--text-muted).
// Se reutiliza tanto para el badge como para la "estela" de color que
// enmarca la tarjeta (ver JornadaCard) — mismo criterio, un único sitio.
function resultadoInfo(golesNosotros, golesRival) {
  if (golesNosotros > golesRival) return { resultado: 'V', clase: 'victoria' }
  if (golesNosotros < golesRival) return { resultado: 'D', clase: 'derrota' }
  return { resultado: 'E', clase: 'empate' }
}

function ResultBadge({ resultado }) {
  return <span className={`historial-jornada-badge historial-jornada-badge-${resultado.clase}`}>{resultado.resultado}</span>
}

// esEntrenador: solo el entrenador puede mantener pulsado una tarjeta para
// abrir su menú de acciones — "Marcar partido como finalizado" en la
// pendiente, "Editar estadísticas del partido" en las ya jugadas.
function JornadaCard({ partido, clubName, onSelect, esEntrenador, onRequestMenu }) {
  const jugado = Boolean(partido.jugado)
  // "00:00" es el valor por defecto de partidos sin hora real configurada
  // todavía (mismo criterio que NextMatchCard) — se trata como "sin hora".
  const horaMostrada = partido.hora && partido.hora !== '00:00' ? partido.hora : null
  const resultado = jugado ? resultadoInfo(partido.golesNosotros ?? 0, partido.golesRival ?? 0) : null

  const longPress = useLongPress(() => onRequestMenu?.(partido))
  const longPressProps = esEntrenador ? longPress : {}

  return (
    <div
      className={`historial-jornada-card${jugado ? ' historial-jornada-card-jugada' : ''}${
        resultado ? ` historial-jornada-card-${resultado.clase}` : ''
      }`}
      onClick={onSelect ? () => onSelect(partido) : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      {...longPressProps}
    >
      <div className="historial-jornada-header">
        <span className="historial-jornada-meta">
          {partido.competicion}
          {partido.jornada ? ` · Jornada ${partido.jornada}` : ''}
        </span>
        {resultado && <ResultBadge resultado={resultado} />}
      </div>

      <div className="historial-jornada-body">
        <div className="historial-jornada-team">
          <div className="historial-jornada-crest">{iniciales(clubName)}</div>
          <span className="historial-jornada-team-name">{clubName}</span>
        </div>

        <span className="historial-jornada-score">
          {jugado ? `${partido.golesNosotros ?? 0} - ${partido.golesRival ?? 0}` : horaMostrada || '—'}
        </span>

        <div className="historial-jornada-team historial-jornada-team-rival">
          <span className="historial-jornada-team-name">{partido.rival}</span>
          <div className="historial-jornada-crest">{iniciales(partido.rival)}</div>
        </div>
      </div>

      {partido.fecha && <span className="historial-jornada-fecha">{formatFechaCorta(partido.fecha)}</span>}
    </div>
  )
}

// Historial de jornadas: calendario completo en formato de tarjeta, de la
// jornada más reciente a la más antigua. Presentacional en su mayoría —
// recibe los partidos ya normalizados (Stats los construye a partir de
// /api/calendario + estadísticas personales) — salvo por el action sheet de
// long-press, que vive aquí porque solo tiene sentido ligado a la propia
// tarjeta; las mutaciones/navegación reales las hace el padre vía
// onMarkAsPlayed/onEditStats.
//
// partidos: [{ id, competicion, jornada, rival, golesNosotros, golesRival,
//              fecha, hora, jugado }]
//
// Uso:
//   <HistorialJornadas partidos={historial} clubName={clubName}
//                       onSelectPartido={(p) => abrirPartido(p.id)}
//                       esEntrenador={currentUser?.role === 'entrenador'}
//                       onMarkAsPlayed={(p) => marcarComoJugado(p.id)}
//                       onEditStats={(p) => abrirEdicionStats(p.id)}
//                       onUnmarkAsPlayed={(p) => desmarcarComoJugado(p.id)} />
export default function HistorialJornadas({
  partidos = [],
  clubName = 'Nosotros',
  onSelectPartido,
  esEntrenador = false,
  onMarkAsPlayed,
  onEditStats,
  onUnmarkAsPlayed,
}) {
  const [menuPartido, setMenuPartido] = useState(null)
  const ordenados = [...partidos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
  // Dos grupos separados por su campo "jugado" (ya normalizado en Stats a
  // partir de matchdays.status === 'played' — ver server/index.js), con un
  // divisor "Jugados" entre ambos solo si hay partidos en los dos grupos.
  const pendientes = ordenados.filter((p) => !p.jugado)
  const jugados = ordenados.filter((p) => p.jugado)

  function renderCard(p) {
    return (
      <JornadaCard
        key={p.id ?? `${p.jornada}-${p.rival}`}
        partido={p}
        clubName={clubName}
        onSelect={onSelectPartido}
        esEntrenador={esEntrenador}
        onRequestMenu={setMenuPartido}
      />
    )
  }

  return (
    <div className="historial-jornadas">
      {ordenados.length === 0 && <p className="empty">Todavía no hay jornadas en el calendario.</p>}

      {pendientes.map(renderCard)}

      {pendientes.length > 0 && jugados.length > 0 && (
        <div className="historial-jornadas-divider">
          <span>Jugados</span>
        </div>
      )}

      {jugados.map(renderCard)}

      {menuPartido && (
        <BottomSheet title={`Jornada ${menuPartido.jornada}`} onClose={() => setMenuPartido(null)}>
          <p className="hint">
            {clubName} vs {menuPartido.rival}
          </p>
          {menuPartido.jugado ? (
            <>
              <button
                type="button"
                className="btn-primary full-width"
                onClick={() => {
                  onEditStats?.(menuPartido)
                  setMenuPartido(null)
                }}
              >
                Editar estadísticas del partido
              </button>
              <button
                type="button"
                className="btn-outline full-width"
                onClick={() => {
                  onUnmarkAsPlayed?.(menuPartido)
                  setMenuPartido(null)
                }}
              >
                Desmarcar como jugado
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary full-width"
              onClick={() => {
                onMarkAsPlayed?.(menuPartido)
                setMenuPartido(null)
              }}
            >
              Marcar partido como finalizado
            </button>
          )}
          <button type="button" className="btn-outline full-width" onClick={() => setMenuPartido(null)}>
            Cancelar
          </button>
        </BottomSheet>
      )}
    </div>
  )
}
