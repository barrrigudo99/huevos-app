import { BarChart2, Calendar, ChevronLeft, ChevronRight, Users } from 'lucide-react'

function iniciales(nombre) {
  return (nombre || '')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

function formatFechaLarga(fecha) {
  if (!fecha) return ''
  return new Date(fecha).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function diasRestantes(fecha) {
  if (!fecha) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const objetivo = new Date(fecha)
  objetivo.setHours(0, 0, 0, 0)
  return Math.round((objetivo - hoy) / (1000 * 60 * 60 * 24))
}

function etiquetaCuentaAtras(dias) {
  if (dias === null) return ''
  if (dias < 0) return 'Ya jugado'
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  return `Faltan ${dias} días`
}

// Tarjeta destacada con el próximo partido: rival, fecha y (si se le pasan
// jugadores + votos) cuántos han confirmado asistencia. Pensada para ir
// arriba del todo de PlantillaScreen, antes de la lista de jugadores.
//
// Uso:
//   <NextMatchCard nextMatch={nextMatch} clubName={club?.name} votes={votes} players={players}
//                  currentUser={currentUser} onOpenStats={() => setScreen('stats')}
//                  onPrevMatch={...} onNextMatch={...} hasPrevMatch hasNextMatch />
export default function NextMatchCard({
  nextMatch,
  clubName,
  votes = {},
  players = [],
  currentUser,
  onOpenStats,
  onPrevMatch,
  onNextMatch,
  hasPrevMatch = false,
  hasNextMatch = false,
}) {
  const isEntrenador = currentUser?.role === 'entrenador'
  const puedeNavegar = (onPrevMatch || onNextMatch) && (hasPrevMatch || hasNextMatch)

  const navegacion = puedeNavegar && (
    <div className="next-match-nav">
      <button
        type="button"
        className="next-match-nav-btn"
        onClick={onPrevMatch}
        disabled={!hasPrevMatch}
        aria-label="Jornada anterior"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="next-match-tag">
        {nextMatch?.jornada ? `Jornada ${nextMatch.jornada}` : 'Próximo partido'}
      </span>
      <button
        type="button"
        className="next-match-nav-btn"
        onClick={onNextMatch}
        disabled={!hasNextMatch}
        aria-label="Jornada siguiente"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )

  if (!nextMatch || !nextMatch.rival) {
    return (
      <div className="next-match-card next-match-card-empty">
        {navegacion}
        <p className="next-match-empty-text">Todavía no hay próximo partido configurado.</p>
        {isEntrenador && (
          <button type="button" className="next-match-stats-btn" onClick={onOpenStats}>
            <BarChart2 size={14} /> Anotar estadísticas
          </button>
        )}
      </div>
    )
  }

  const dias = diasRestantes(nextMatch.date)
  const confirmados = players.filter((p) => p.phone && votes[p.phone] === 'Si').length

  return (
    <div className="next-match-card">
      {navegacion || <span className="next-match-tag">Próximo partido</span>}

      <div className="next-match-teams">
        <div className="next-match-team">
          <div className="next-match-crest next-match-crest-us">{iniciales(clubName || 'Nosotros')}</div>
          <span className="next-match-team-name">{clubName || 'Nosotros'}</span>
        </div>
        <span className="next-match-vs">VS</span>
        <div className="next-match-team">
          <div className="next-match-crest next-match-crest-rival">{iniciales(nextMatch.rival)}</div>
          <span className="next-match-team-name">{nextMatch.rival}</span>
        </div>
      </div>

      <div className="next-match-meta">
        {nextMatch.date && (
          <span className="next-match-meta-item">
            <Calendar size={14} />
            {formatFechaLarga(nextMatch.date)}
          </span>
        )}
        {players.length > 0 && (
          <span className="next-match-meta-item">
            <Users size={14} />
            {confirmados}/{players.length} confirmados
          </span>
        )}
      </div>

      {dias !== null && <span className="next-match-countdown">{etiquetaCuentaAtras(dias)}</span>}

      {isEntrenador && (
        <button type="button" className="next-match-stats-btn" onClick={onOpenStats}>
          <BarChart2 size={14} /> Anotar estadísticas
        </button>
      )}
    </div>
  )
}
