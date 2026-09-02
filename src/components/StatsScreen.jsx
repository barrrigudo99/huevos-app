import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { fetchCalendario, fetchClub, fetchEstadisticasPersonales, fetchAsistentesConvocatoria } from '../api'
import { OUR_TEAM, displayTeamName, sortedMatchesForTeam } from '../data/league'
import MatchStatsPanel from './MatchStatsPanel'
import MatchResultPanel from './MatchResultPanel'

export default function StatsScreen({
  players,
  playerMatchStats,
  currentUser,
  refreshPlayerMatchStats,
  openMatchId,
  onOpenMatchHandled,
}) {
  const isEntrenador = currentUser?.role === 'entrenador'

  // Los partidos disponibles para anotar estadísticas salen de
  // 2_calendario.json, sin filtrar por su campo "jugado" (ese campo solo
  // controla el botón "Marcar partido como jugado" y no condiciona qué
  // jornadas se pueden ver o anotar), y aparte de resultados.json — eso
  // mantiene el registro de estadísticas personales independiente de la
  // clasificación de Marcador.
  const [calendario, setCalendario] = useState(null)
  const [clubName, setClubName] = useState('')
  const [estadisticasPersonales, setEstadisticasPersonales] = useState([])
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [loadingMatches, setLoadingMatches] = useState(isEntrenador)
  const [matchesError, setMatchesError] = useState('')
  const [calledPlayerIds, setCalledPlayerIds] = useState(null)
  const [calledError, setCalledError] = useState('')

  useEffect(() => {
    if (!isEntrenador) return
    Promise.all([fetchCalendario(), fetchClub(), fetchEstadisticasPersonales()])
      .then(([cal, club, estadisticas]) => {
        setCalendario(cal)
        setClubName(club?.name || '')
        setEstadisticasPersonales(estadisticas)
      })
      .catch((err) => setMatchesError(err.message))
      .finally(() => setLoadingMatches(false))
  }, [isEntrenador])

  // Al venir del botón "Anotar estadísticas" de NextMatchCard, en cuanto
  // tengamos los partidos cargados saltamos directo a la jornada que se
  // estaba viendo en la tarjeta, sin pasar por el selector. Solo salta una
  // vez: el padre baja el id después, así que volver a esta pestaña por la
  // barra inferior muestra el selector normal.
  useEffect(() => {
    if (!openMatchId || !calendario) return
    const match = calendario.find((p) => p.id === openMatchId)
    if (match) {
      setSelectedMatch(match)
    }
    onOpenMatchHandled?.()
  }, [openMatchId, calendario])

  // Al elegir un partido, se calcula qué jugadores votaron "Sí" en su
  // convocatoria (call_ups.attended = true) para no listarlos a todos en
  // MatchStatsPanel. Si falla la consulta, se opta por no mostrar a nadie
  // en vez de mostrar la plantilla completa sin filtrar.
  useEffect(() => {
    if (!selectedMatch) return
    setCalledPlayerIds(null)
    setCalledError('')
    fetchAsistentesConvocatoria(selectedMatch.id)
      .then((res) => setCalledPlayerIds(new Set(res.playerIds)))
      .catch((err) => {
        setCalledError(err.message)
        setCalledPlayerIds(new Set())
      })
  }, [selectedMatch])

  function refrescarEstadisticas() {
    return Promise.all([fetchEstadisticasPersonales(), refreshPlayerMatchStats?.()]).then(([estadisticas]) => {
      setEstadisticasPersonales(estadisticas)
    })
  }

  const statsFor = (id) => playerMatchStats[id] || {}

  const goals = players.reduce((sum, p) => sum + (statsFor(p.id).goles || 0), 0)
  const cards = players.reduce(
    (sum, p) => sum + (statsFor(p.id).tarjetasAmarillas || 0) + (statsFor(p.id).tarjetasRojas || 0),
    0
  )

  const scorers = players
    .map((p) => ({ ...p, goals: statsFor(p.id).goles || 0 }))
    .filter((p) => p.goals > 0)
    .sort((a, b) => b.goals - a.goals)

  if (isEntrenador && selectedMatch) {
    const entradaGuardada = estadisticasPersonales.find((e) => e.id === selectedMatch.id)
    const jugadoresGuardados = entradaGuardada?.jugadores || []
    const rivalDelPartido =
      selectedMatch.equipo_local === OUR_TEAM ? selectedMatch.equipo_visitante : selectedMatch.equipo_local
    return (
      <div className="stats">
        <button className="btn-outline small" onClick={() => setSelectedMatch(null)}>
          <ChevronLeft size={14} /> Volver a los partidos
        </button>
        <p className="hint">
          {displayTeamName(selectedMatch.equipo_local, clubName)} vs{' '}
          {displayTeamName(selectedMatch.equipo_visitante, clubName)}
        </p>
        {selectedMatch.jugado && (
          <>
            <MatchResultPanel
              matchId={selectedMatch.id}
              rival={rivalDelPartido}
              currentUser={currentUser}
              resultadoGuardado={entradaGuardada?.resultado}
              onSaved={refrescarEstadisticas}
            />
            {calledError && <p className="auth-error">{calledError}</p>}
          </>
        )}
        <MatchStatsPanel
          matchId={selectedMatch.id}
          players={players}
          currentUser={currentUser}
          jugadoresGuardados={jugadoresGuardados}
          calledPlayerIds={calledPlayerIds}
          jugado={selectedMatch.jugado}
          onMarked={() => setSelectedMatch((prev) => (prev ? { ...prev, jugado: true } : prev))}
          onSaved={refrescarEstadisticas}
        />
      </div>
    )
  }

  return (
    <div className="stats">
      <div className="metrics">
        <div className="metric">
          <p className="metric-label">Goles</p>
          <p className="metric-value">{goals}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Tarjetas</p>
          <p className="metric-value">{cards}</p>
        </div>
      </div>
      <p className="hint">Máximos goleadores</p>
      <div className="feed">
        {scorers.length === 0 && <p className="empty">Todavía no hay goles registrados.</p>}
        {scorers.map((p) => (
          <div className="feed-row" key={p.id}>
            <span>{p.name}</span>
            <span className="muted">{p.goals} goles</span>
          </div>
        ))}
      </div>

      {isEntrenador && (
        <>
          <p className="hint">Estadísticas por partido</p>
          {loadingMatches && <p className="hint">Cargando partidos...</p>}
          {matchesError && <p className="auth-en supabas error">{matchesError}</p>}
          {calendario && (
            <div className="stats-match-picker">
              {sortedMatchesForTeam(calendario, OUR_TEAM).length === 0 && (
                <p className="empty">Todavía no hay partidos en el calendario.</p>
              )}
              {sortedMatchesForTeam(calendario, OUR_TEAM).map((m) => (
                <div
                  className={`stats-match-picker-item${m.jugado ? ' stats-match-picker-item-played' : ''}`}
                  key={m.id}
                  onClick={() => setSelectedMatch(m)}
                >
                  <span>
                    {displayTeamName(m.equipo_local, clubName)} vs {displayTeamName(m.equipo_visitante, clubName)}
                  </span>
                  <span className="muted">{m.fecha}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
