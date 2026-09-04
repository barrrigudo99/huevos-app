import { useEffect, useState } from 'react'
import {
  fetchCalendario,
  fetchClub,
  fetchEstadisticasPersonales,
  fetchAsistentesConvocatoria,
  markMatchAsPlayed,
  unmarkMatchAsPlayed,
} from '../api'
import { OUR_TEAM, displayTeamName, sortedMatchesForTeam } from '../data/league'
import MatchStatsPanel from './MatchStatsPanel'
import MatchResultPanel from './MatchResultPanel'
import HistorialJornadas from './HistorialJornadas'
import BottomSheet from './BottomSheet'
import AlineacionScreen from './AlineacionScreen'
import PlayerAvatar from './PlayerAvatar'

export default function StatsScreen({
  players,
  playerMatchStats,
  currentUser,
  refreshPlayerMatchStats,
  openMatchId,
  onOpenMatchHandled,
}) {
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
  // Partido para el que se abre el panel de anotar estadísticas
  // individuales (MatchResultPanel/MatchStatsPanel), justo después de
  // marcarlo como finalizado desde el action sheet de HistorialJornadas.
  // Independiente de selectedMatch (ese abre la pizarra de Alineación).
  const [statsMatch, setStatsMatch] = useState(null)
  const [loadingMatches, setLoadingMatches] = useState(true)
  const [matchesError, setMatchesError] = useState('')
  const [calledPlayerIds, setCalledPlayerIds] = useState(null)
  const [calledError, setCalledError] = useState('')

  // El historial de jornadas (calendario + resultados) ya no es exclusivo
  // del entrenador: /api/calendario, /api/club y /api/estadisticas-personales
  // se pueden leer con cualquier rol (solo sus PUT/POST están restringidos
  // en el servidor), así que se cargan para todos los usuarios.
  useEffect(() => {
    Promise.all([fetchCalendario(), fetchClub(), fetchEstadisticasPersonales()])
      .then(([cal, club, estadisticas]) => {
        setCalendario(cal)
        setClubName(club?.name || '')
        setEstadisticasPersonales(estadisticas)
      })
      .catch((err) => setMatchesError(err.message))
      .finally(() => setLoadingMatches(false))
  }, [])

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

  // Al elegir un partido (selectedMatch, para Alineación, o statsMatch, para
  // anotar estadísticas) se calcula qué jugadores votaron "Sí" en su
  // convocatoria (call_ups.attended = true), para no listarlos a todos en
  // AlineacionScreen/MatchStatsPanel. Si falla la consulta, se opta por no
  // mostrar a nadie en vez de mostrar la plantilla completa sin filtrar.
  const matchIdParaConvocados = selectedMatch?.id ?? statsMatch?.id
  useEffect(() => {
    if (!matchIdParaConvocados) return
    setCalledPlayerIds(null)
    setCalledError('')
    fetchAsistentesConvocatoria(matchIdParaConvocados)
      .then((res) => setCalledPlayerIds(new Set(res.playerIds)))
      .catch((err) => {
        setCalledError(err.message)
        setCalledPlayerIds(new Set())
      })
  }, [matchIdParaConvocados])

  function refrescarEstadisticas() {
    return Promise.all([fetchEstadisticasPersonales(), refreshPlayerMatchStats?.()]).then(([estadisticas]) => {
      setEstadisticasPersonales(estadisticas)
    })
  }

  // Long-press del entrenador sobre una jornada aún no jugada en
  // HistorialJornadas -> action sheet -> "Marcar partido como finalizado".
  // El endpoint (PUT /api/calendario/:id/jugado) ya existe y es
  // requireEntrenador() en el servidor. Tras marcarlo, se refresca el
  // calendario (la tarjeta pasa a "jugada") y se abre directamente el panel
  // de anotar estadísticas individuales para ese partido.
  function marcarPartidoComoJugado(partido) {
    if (!currentUser?.id) return
    return markMatchAsPlayed(partido.id, currentUser.id)
      .then(() => fetchCalendario())
      .then((cal) => {
        setCalendario(cal)
        const match = cal.find((m) => m.id === partido.id)
        if (match) {
          setSelectedMatch(null)
          setStatsMatch(match)
        }
      })
      .catch((err) => setMatchesError(err.message))
  }

  // Long-press del entrenador sobre una jornada YA jugada -> action sheet ->
  // "Editar estadísticas del partido". Aquí el partido ya está marcado, así
  // que no hace falta llamar a markMatchAsPlayed: solo abrir el mismo sheet
  // de estadísticas que abre marcarPartidoComoJugado tras marcar una nueva.
  function editarEstadisticasPartido(partido) {
    if (!calendario) return
    const match = calendario.find((m) => m.id === partido.id)
    if (match) {
      setSelectedMatch(null)
      setStatsMatch(match)
    }
  }

  // Mismo action sheet, botón "Desmarcar como jugado": deshace
  // markMatchAsPlayed (vuelve el partido a 'scheduled') y refresca el
  // calendario para que la tarjeta pase a pendiente otra vez. No abre
  // ningún sheet nuevo — cierra los que hubiera abiertos para ese partido.
  function desmarcarPartidoComoJugado(partido) {
    if (!currentUser?.id) return
    return unmarkMatchAsPlayed(partido.id, currentUser.id)
      .then(() => fetchCalendario())
      .then((cal) => {
        setCalendario(cal)
        setSelectedMatch((prev) => (prev?.id === partido.id ? null : prev))
        setStatsMatch((prev) => (prev?.id === partido.id ? null : prev))
      })
      .catch((err) => setMatchesError(err.message))
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

  // HistorialJornadas solo debe listar los partidos ya jugados más el
  // próximo por jugar (el no jugado más cercano por fecha) — el resto de
  // jornadas futuras del calendario no se muestran.
  const proximoPartido = calendario
    ? sortedMatchesForTeam(calendario, OUR_TEAM)
        .filter((m) => !m.jugado)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0]
    : null

  // Normaliza el calendario para HistorialJornadas: el resultado final no
  // viaja en /api/calendario (siempre null ahí, ver server/index.js), sale
  // de estadisticasPersonales (mismo origen que usa MatchResultPanel).
  const historial = calendario
    ? sortedMatchesForTeam(calendario, OUR_TEAM)
        .filter((m) => m.jugado || m.id === proximoPartido?.id)
        .map((m) => {
          const resultado = estadisticasPersonales.find((e) => e.id === m.id)?.resultado
          return {
            id: m.id,
            competicion: 'Liga · Fútbol 7',
            jornada: m.jornada,
            rival: m.equipo_local === OUR_TEAM ? m.equipo_visitante : m.equipo_local,
            golesNosotros: resultado?.golesNosotros,
            golesRival: resultado?.golesRival,
            fecha: m.fecha,
            hora: m.hora,
            jugado: m.jugado,
          }
        })
    : []

  // Jornada ya jugada elegida en HistorialJornadas: se abre en un
  // BottomSheet (sheet-body) con la pizarra de alineación de esa jornada
  // (AlineacionScreen), reutilizando calledPlayerIds ya cargado arriba como
  // convocados. No toca la anotación de estadísticas individuales
  // (MatchResultPanel/MatchStatsPanel), que sigue intacta en sus archivos.
  const rivalDelPartidoSeleccionado = selectedMatch
    ? selectedMatch.equipo_local === OUR_TEAM
      ? selectedMatch.equipo_visitante
      : selectedMatch.equipo_local
    : null
  const convocadosDelPartidoSeleccionado = calledPlayerIds ? players.filter((p) => calledPlayerIds.has(p.id)) : []

  // Partido para el panel de anotar estadísticas (statsMatch).
  const rivalDelPartidoStats = statsMatch
    ? statsMatch.equipo_local === OUR_TEAM
      ? statsMatch.equipo_visitante
      : statsMatch.equipo_local
    : null
  const entradaStatsMatch = statsMatch ? estadisticasPersonales.find((e) => e.id === statsMatch.id) : null
  const jugadoresGuardadosStatsMatch = entradaStatsMatch?.jugadores || []

  return (
    <>
      <div className="stats stats-groups">
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

        <div>
          <p className="stats-section-title">Máximos goleadores</p>
          {scorers.length === 0 ? (
            <p className="empty">Todavía no hay goles registrados.</p>
          ) : (
            <div className="scorers-card">
              {scorers.map((p) => (
                <div className="scorer-row" key={p.id}>
                  <PlayerAvatar player={p} size="sm" />
                  <span className="scorer-name">{p.name}</span>
                  <span className="scorer-goals">
                    {p.goals} {p.goals === 1 ? 'gol' : 'goles'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="stats-section-title">Estadísticas por partido</p>
          {loadingMatches && <p className="hint">Cargando partidos...</p>}
          {matchesError && <p className="auth-en supabas error">{matchesError}</p>}
          {calendario && (
            <HistorialJornadas
              partidos={historial}
              clubName={clubName || 'Nosotros'}
              onSelectPartido={(p) => {
                const match = calendario.find((m) => m.id === p.id)
                if (match) {
                  setStatsMatch(null)
                  setSelectedMatch(match)
                }
              }}
              esEntrenador={currentUser?.role === 'entrenador'}
              onMarkAsPlayed={marcarPartidoComoJugado}
              onEditStats={editarEstadisticasPartido}
              onUnmarkAsPlayed={desmarcarPartidoComoJugado}
            />
          )}
        </div>
      </div>

      {selectedMatch && (
        <BottomSheet
          title={`Jornada ${selectedMatch.jornada} · ${displayTeamName(rivalDelPartidoSeleccionado, clubName)}`}
          onClose={() => setSelectedMatch(null)}
        >
          <p className="hint">
            {displayTeamName(selectedMatch.equipo_local, clubName)} vs{' '}
            {displayTeamName(selectedMatch.equipo_visitante, clubName)}
          </p>
          <AlineacionScreen
            players={players}
            convocadosDelPartido={convocadosDelPartidoSeleccionado}
            currentUser={currentUser}
            matchId={selectedMatch.id}
            jugado={!!selectedMatch.jugado}
            jornada={selectedMatch.jornada}
            rival={rivalDelPartidoSeleccionado}
          />
          {calledError && <p className="auth-error">{calledError}</p>}
        </BottomSheet>
      )}

      {statsMatch && (
        <BottomSheet
          title={`Jornada ${statsMatch.jornada} · ${displayTeamName(rivalDelPartidoStats, clubName)}`}
          onClose={() => setStatsMatch(null)}
        >
          <p className="hint">
            {displayTeamName(statsMatch.equipo_local, clubName)} vs{' '}
            {displayTeamName(statsMatch.equipo_visitante, clubName)}
          </p>
          <MatchResultPanel
            matchId={statsMatch.id}
            rival={rivalDelPartidoStats}
            currentUser={currentUser}
            resultadoGuardado={entradaStatsMatch?.resultado}
            onSaved={refrescarEstadisticas}
          />
          {calledError && <p className="auth-error">{calledError}</p>}
          <MatchStatsPanel
            matchId={statsMatch.id}
            players={players}
            currentUser={currentUser}
            jugadoresGuardados={jugadoresGuardadosStatsMatch}
            calledPlayerIds={calledPlayerIds}
            jugado={statsMatch.jugado}
            onMarked={() => setStatsMatch((prev) => (prev ? { ...prev, jugado: true } : prev))}
            onSaved={refrescarEstadisticas}
          />
        </BottomSheet>
      )}
    </>
  )
}
