import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { fetchClub, fetchLeague } from '../api'
import {
  computeStandings,
  displayTeamName,
  isOurMatch,
  matchesForTeam,
  teamResultCounts,
} from '../data/league'
import DonutChart from './DonutChart'

// A partir de los "jugadores" del partido (simulador/4_resultados.json) arma
// una fila por cada suceso (gol/asistencia/tarjeta) para el feed de abajo.
function matchEventRows(match) {
  const rows = []
  for (const j of match.jugadores || []) {
    for (let i = 0; i < (j.goles || 0); i++) rows.push({ key: `${j.id}-gol-${i}`, name: j.name, label: 'Gol' })
    for (let i = 0; i < (j.asistencias || 0); i++) {
      rows.push({ key: `${j.id}-asis-${i}`, name: j.name, label: 'Asistencia' })
    }
    if (j.tarjetaAmarilla) rows.push({ key: `${j.id}-amarilla`, name: j.name, label: 'Amarilla' })
    if (j.tarjetaRoja) rows.push({ key: `${j.id}-roja`, name: j.name, label: 'Roja' })
  }
  return rows
}

export default function MarcadorScreen() {
  const [league, setLeague] = useState(null)
  const [clubName, setClubName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [selectedMatch, setSelectedMatch] = useState(null)

  useEffect(() => {
    fetchLeague()
      .then(setLeague)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    fetchClub()
      .then((c) => setClubName(c?.name || ''))
      .catch(() => {})
  }, [])

  if (loading) return <p className="hint">Cargando clasificación...</p>
  if (error) return <p className="auth-error">No se pudo cargar la liga: {error}</p>
  if (!league) return null

  if (selectedMatch) {
    const ourMatch = isOurMatch(selectedMatch)
    const events = matchEventRows(selectedMatch)
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
            <div className="feed">
              {events.length === 0 && <p className="empty">Todavía no hay sucesos registrados.</p>}
              {events.map((ev) => (
                <div className="feed-row" key={ev.key}>
                  <span>
                    {ev.name} · {ev.label}
                  </span>
                </div>
              ))}
            </div>
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
