import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { addMatchEvent, deleteMatchEvent, fetchClub, fetchLeague, fetchMatchEvents } from '../api'
import {
  computeStandings,
  displayTeamName,
  isOurMatch,
  matchesForTeam,
  teamResultCounts,
} from '../data/league'
import DonutChart from './DonutChart'

const EVENT_TYPES = [
  { code: 'gol', label: 'Gol' },
  { code: 'asistencia', label: 'Asistencia' },
  { code: 'tarjeta_amarilla', label: 'Amarilla' },
  { code: 'tarjeta_roja', label: 'Roja' },
]

function eventTypeLabel(code) {
  return EVENT_TYPES.find((t) => t.code === code)?.label || code
}

export default function MarcadorScreen({ players, currentUser }) {
  const [league, setLeague] = useState(null)
  const [clubName, setClubName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [selectedMatch, setSelectedMatch] = useState(null)

  const [matchEvents, setMatchEvents] = useState({})
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [eventPlayerId, setEventPlayerId] = useState('')
  const [eventSaving, setEventSaving] = useState(false)

  const isEntrenador = currentUser?.role === 'entrenador'

  useEffect(() => {
    fetchLeague()
      .then(setLeague)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    fetchClub()
      .then((c) => setClubName(c?.name || ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedMatch || !isOurMatch(selectedMatch)) return
    setEventsLoading(true)
    setEventsError('')
    fetchMatchEvents()
      .then(setMatchEvents)
      .catch((err) => setEventsError(err.message))
      .finally(() => setEventsLoading(false))
  }, [selectedMatch])

  async function handleAddEvent(type) {
    if (!selectedMatch || !eventPlayerId) return
    setEventSaving(true)
    setEventsError('')
    try {
      const list = await addMatchEvent(
        selectedMatch.id,
        { playerId: Number(eventPlayerId), type },
        currentUser.id
      )
      setMatchEvents((prev) => ({ ...prev, [selectedMatch.id]: list }))
    } catch (err) {
      setEventsError(err.message)
    } finally {
      setEventSaving(false)
    }
  }

  async function handleDeleteEvent(eventId) {
    if (!selectedMatch) return
    setEventsError('')
    try {
      const list = await deleteMatchEvent(selectedMatch.id, eventId, currentUser.id)
      setMatchEvents((prev) => ({ ...prev, [selectedMatch.id]: list }))
    } catch (err) {
      setEventsError(err.message)
    }
  }

  if (loading) return <p className="hint">Cargando clasificación...</p>
  if (error) return <p className="auth-error">No se pudo cargar la liga: {error}</p>
  if (!league) return null

  if (selectedMatch) {
    const ourMatch = isOurMatch(selectedMatch)
    const events = matchEvents[selectedMatch.id] || []
    return (
      <div className="match">
        <button className="btn-outline small" onClick={() => setSelectedMatch(null)}>
          <ChevronLeft size={14} /> Volver a {displayTeamName(selectedTeam, clubName)}
        </button>
        <div className="scoreboard">
          <span>{displayTeamName(selectedMatch.equipo_local, clubName)}</span>
          <span className="score">
            {selectedMatch.resultado.goles_local} - {selectedMatch.resultado.goles_visitante}
          </span>
          <span>{displayTeamName(selectedMatch.equipo_visitante, clubName)}</span>
        </div>

        {ourMatch && (
          <>
            <p className="hint">Sucesos del partido</p>
            {eventsLoading && <p className="hint">Cargando sucesos...</p>}
            {eventsError && <p className="auth-error">{eventsError}</p>}
            {!eventsLoading && (
              <div className="feed">
                {events.length === 0 && <p className="empty">Todavía no hay sucesos registrados.</p>}
                {events.map((ev) => {
                  const player = players.find((p) => p.id === ev.playerId)
                  return (
                    <div className="feed-row" key={ev.id}>
                      <span>
                        {player?.name || 'Jugador'} · {eventTypeLabel(ev.type)}
                      </span>
                      {isEntrenador && (
                        <button className="btn-outline small" onClick={() => handleDeleteEvent(ev.id)}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {isEntrenador && (
              <div className="card form">
                <select value={eventPlayerId} onChange={(e) => setEventPlayerId(e.target.value)}>
                  <option value="">Selecciona jugador</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="event-grid">
                  {EVENT_TYPES.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      className="event-btn"
                      disabled={!eventPlayerId || eventSaving}
                      onClick={() => handleAddEvent(t.code)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (selectedTeam) {
    const matches = matchesForTeam(league.partidos, selectedTeam)
    const { wins, draws, losses } = teamResultCounts(league.partidos, selectedTeam)
    return (
      <div className="stats">
        <button className="btn-outline small" onClick={() => setSelectedTeam(null)}>
          <ChevronLeft size={14} /> Volver a la clasificación
        </button>
        <p className="hint">{displayTeamName(selectedTeam, clubName)} · partidos disputados</p>

        {matches.length > 0 && (
          <DonutChart
            segments={[
              { label: 'Victorias', value: wins, color: 'var(--accent)' },
              { label: 'Empates', value: draws, color: '#c9a227' },
              { label: 'Derrotas', value: losses, color: '#e74c3c' },
            ]}
          />
        )}

        <div className="feed">
          {matches.length === 0 && <p className="empty">Este equipo todavía no ha jugado.</p>}
          {matches.map((m) => (
            <div className="feed-row clickable" key={m.id} onClick={() => setSelectedMatch(m)}>
              <span>
                {displayTeamName(m.equipo_local, clubName)} vs {displayTeamName(m.equipo_visitante, clubName)}
              </span>
              <span className="muted">
                {m.resultado.goles_local} - {m.resultado.goles_visitante}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const standings = computeStandings(league.equipos, league.partidos)

  return (
    <div className="stats">
      <p className="hint">
        Liga {league.temporada} · Jornada {league.jornadas_simuladas}/{league.total_jornadas}
      </p>
      <div className="table-scroll">
        <table className="standings">
          <thead>
            <tr>
              <th className="standings-team">Equipo</th>
              <th>PJ</th>
              <th>PG</th>
              <th>PE</th>
              <th>PP</th>
              <th>GF</th>
              <th>GC</th>
              <th>DG</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={row.team} onClick={() => setSelectedTeam(row.team)}>
                <td className="standings-team">
                  {i + 1}. {displayTeamName(row.team, clubName)}
                </td>
                <td>{row.pj}</td>
                <td>{row.pg}</td>
                <td>{row.pe}</td>
                <td>{row.pp}</td>
                <td>{row.gf}</td>
                <td>{row.gc}</td>
                <td>{row.dg}</td>
                <td className="standings-pts">{row.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
