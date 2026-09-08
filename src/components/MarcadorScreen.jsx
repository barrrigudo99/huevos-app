import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchClub, fetchEstadisticasPersonales, fetchLeague } from '../api'
import { computeStandings, displayTeamName, isOurMatch, matchesForTeam, OUR_TEAM } from '../data/league'
import PlayerAvatar from './PlayerAvatar'

const OUT_COLOR = { G: '#D8B970', E: '#B7202A', P: '#8C8783' }
const OUT_LABEL = { G: 'Victoria', E: 'Empate', P: 'Derrota' }

// Resultado (G/E/P) de un partido de /league desde la óptica de `team`.
function outcomeFor(match, team) {
  const home = match.equipo_local === team
  const gf = home ? match.resultado.goles_local : match.resultado.goles_visitante
  const gc = home ? match.resultado.goles_visitante : match.resultado.goles_local
  if (gf > gc) return 'G'
  if (gf === gc) return 'E'
  return 'P'
}

// Marca visual de cada tipo de suceso (mismo lenguaje que el resto del rediseño).
const MARK = {
  gol: { label: 'Gol', cls: 'mk-mark-dot mk-mark-gol' },
  asistencia: { label: 'Asistencia', cls: 'mk-mark-dot mk-mark-asis' },
  amarilla: { label: 'Amarilla', cls: 'mk-mark-card mk-mark-amarilla' },
  roja: { label: 'Roja', cls: 'mk-mark-card mk-mark-roja' },
}
const MARK_ORDER = { gol: 0, asistencia: 1, amarilla: 2, roja: 3 }

// Una fila por suceso (un gol = una fila; una tarjeta = una fila) a partir de
// los `jugadores` que devuelve /estadisticas-personales para el partido.
function eventRows(jugadores) {
  const rows = []
  for (const j of jugadores || []) {
    for (let i = 0; i < (j.goles || 0); i++) rows.push({ key: `${j.id}-g-${i}`, player: j, kind: 'gol' })
    for (let i = 0; i < (j.asistencias || 0); i++) rows.push({ key: `${j.id}-a-${i}`, player: j, kind: 'asistencia' })
    if (j.tarjetaAmarilla) rows.push({ key: `${j.id}-am`, player: j, kind: 'amarilla' })
    if (j.tarjetaRoja) rows.push({ key: `${j.id}-ro`, player: j, kind: 'roja' })
  }
  return rows.sort((a, b) => MARK_ORDER[a.kind] - MARK_ORDER[b.kind])
}

export default function MarcadorScreen() {
  const [league, setLeague] = useState(null)
  const [clubName, setClubName] = useState('')
  const [stats, setStats] = useState([])
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
    // Detalle jugador a jugador de los partidos de nuestro club, para el feed
    // de "Sucesos del partido"; si falla, la pantalla sigue funcionando sin él.
    fetchEstadisticasPersonales()
      .then((res) => setStats(Array.isArray(res) ? res : []))
      .catch(() => setStats([]))
  }, [])

  const rows = useMemo(
    () => (league ? computeStandings(league.equipos, league.partidos) : []),
    [league]
  )

  const matchEvents = useMemo(() => {
    if (!league || !selectedMatch || !isOurMatch(selectedMatch)) return []
    const rival =
      selectedMatch.equipo_local === OUR_TEAM
        ? selectedMatch.equipo_visitante
        : selectedMatch.equipo_local
    const entry = stats.find((e) => e.jornada === selectedMatch.jornada && e.rival === rival)
    return entry ? eventRows(entry.jugadores) : []
  }, [league, selectedMatch, stats])

  if (loading) return <p className="hint">Cargando clasificación...</p>
  if (error) return <p className="auth-error">No se pudo cargar la liga: {error}</p>
  if (!league) return null

  const view = selectedMatch ? 'match' : selectedTeam ? 'team' : 'table'
  const teamName = selectedTeam ? displayTeamName(selectedTeam, clubName) : ''

  const eyebrow =
    view === 'team'
      ? 'Balance del equipo'
      : view === 'match'
        ? `Jornada ${selectedMatch.jornada}`
        : `Liga ${league.temporada} · Jornada ${league.jornadas_simuladas}/${league.total_jornadas}`
  const title = view === 'team' ? teamName : view === 'match' ? 'Detalle del partido' : 'Clasificación'

  const goBack = () => (selectedMatch ? setSelectedMatch(null) : setSelectedTeam(null))

  const formOf = (team) =>
    matchesForTeam(league.partidos, team)
      .slice(-4)
      .map((m) => outcomeFor(m, team))

  return (
    <div className="mk">
      <div className="mk-head">
        <span className="mk-head-stripe mk-head-stripe-red" />
        <span className="mk-head-stripe mk-head-stripe-gold" />
        <div className="mk-head-row">
          {view !== 'table' && (
            <button type="button" className="mk-head-back" title="Atrás" onClick={goBack}>
              <ChevronLeft size={16} />
            </button>
          )}
          <div className="mk-head-titles">
            <span className="mk-head-eyebrow">{eyebrow}</span>
            <span className="mk-head-title">{title}</span>
          </div>
        </div>
      </div>

      {view === 'table' && (
        <div className="mk-body">
          <div className="mk-th">
            <span className="mk-th-pos">#</span>
            <span className="mk-th-team">Equipo</span>
            <span className="mk-th-form">Forma</span>
            <span className="mk-th-dg">DG</span>
            <span className="mk-th-pts">Pts</span>
          </div>
          <div className="mk-rows">
            {rows.map((row, i) => {
              const ours = row.team === OUR_TEAM
              const zone =
                i === 0
                  ? '#D8B970'
                  : i < 3
                    ? '#7d6c48'
                    : i >= rows.length - 2
                      ? '#3a3733'
                      : '#262220'
              const dgColor = row.dg > 0 ? '#D8B970' : row.dg < 0 ? '#8C8783' : '#8C8783'
              return (
                <button
                  type="button"
                  key={row.team}
                  className={`mk-row ${ours ? 'ours' : ''}`}
                  onClick={() => setSelectedTeam(row.team)}
                >
                  <span className="mk-row-zone" style={{ background: zone }} />
                  <span className={`mk-row-pos ${ours ? 'gold' : ''}`}>{i + 1}</span>
                  <span className="mk-row-name">{displayTeamName(row.team, clubName)}</span>
                  <span className="mk-row-form">
                    {formOf(row.team).map((o, k) => (
                      <span className="mk-form-cell" key={k} title={OUT_LABEL[o]}>
                        <span className="mk-form-letter">{o}</span>
                        <span className="mk-form-bar" style={{ background: OUT_COLOR[o] }} />
                      </span>
                    ))}
                  </span>
                  <span className="mk-row-dg" style={{ color: dgColor }}>
                    {row.dg > 0 ? `+${row.dg}` : row.dg}
                  </span>
                  <span className="mk-row-pts">{row.pts}</span>
                </button>
              )
            })}
          </div>
          <div className="mk-legend">
            <span>
              <span className="mk-legend-bar" style={{ background: '#D8B970' }} /> Ganado
            </span>
            <span>
              <span className="mk-legend-bar" style={{ background: '#B7202A' }} /> Empate
            </span>
            <span>
              <span className="mk-legend-bar" style={{ background: '#8C8783' }} /> Perdido
            </span>
          </div>
        </div>
      )}

      {view === 'team' &&
        (() => {
          const row = rows.find((r) => r.team === selectedTeam) || {
            pj: 0,
            pg: 0,
            pe: 0,
            pp: 0,
            gf: 0,
            gc: 0,
            dg: 0,
            pts: 0,
          }
          const total = Math.max(row.pj, 1)
          const wEnd = (row.pg / total) * 360
          const dEnd = wEnd + (row.pe / total) * 360
          const donut = `conic-gradient(#D8B970 0deg ${wEnd}deg, #B7202A ${wEnd}deg ${dEnd}deg, #8C8783 ${dEnd}deg 360deg)`
          const teamMatches = matchesForTeam(league.partidos, selectedTeam)
          return (
            <div className="mk-body">
              <div className="mk-team-card">
                <div className="mk-donut" style={{ backgroundImage: donut }}>
                  <div className="mk-donut-hole">
                    <span className="mk-donut-pts">{row.pts}</span>
                    <span className="mk-donut-label">Puntos</span>
                  </div>
                </div>
                <div className="mk-team-legend">
                  {[
                    { label: 'Victorias', value: row.pg, color: '#D8B970' },
                    { label: 'Empates', value: row.pe, color: '#B7202A' },
                    { label: 'Derrotas', value: row.pp, color: '#8C8783' },
                  ].map((l) => (
                    <span className="mk-team-legend-row" key={l.label}>
                      <span className="mk-team-legend-dot" style={{ background: l.color }} />
                      <span className="mk-team-legend-label">{l.label}</span>
                      <span className="mk-team-legend-value">{l.value}</span>
                    </span>
                  ))}
                  <span className="mk-team-goals">
                    {row.gf} goles a favor · {row.gc} en contra · DG{' '}
                    {row.dg > 0 ? `+${row.dg}` : row.dg}
                  </span>
                </div>
              </div>

              <p className="mk-section-label">Partidos disputados</p>
              <div className="mk-matches">
                {teamMatches.length === 0 && (
                  <p className="mk-empty">Este equipo todavía no ha jugado.</p>
                )}
                {teamMatches.map((m, i) => {
                  const o = outcomeFor(m, selectedTeam)
                  const home = m.equipo_local === selectedTeam
                  const rival = home ? m.equipo_visitante : m.equipo_local
                  const involvesUs = m.equipo_local === OUR_TEAM || m.equipo_visitante === OUR_TEAM
                  return (
                    <button
                      type="button"
                      key={`${m.jornada}-${rival}-${i}`}
                      className={`mk-match-btn ${involvesUs ? 'ours' : ''}`}
                      onClick={() => setSelectedMatch(m)}
                    >
                      <span
                        className={`mk-res mk-res-${o.toLowerCase()}`}
                        style={{ background: OUT_COLOR[o] }}
                      >
                        {o}
                      </span>
                      <span className="mk-match-info">
                        <span className="mk-match-label">
                          {home ? 'vs ' : 'en '}
                          {displayTeamName(rival, clubName)}
                        </span>
                        <span className="mk-match-meta">
                          Jornada {m.jornada} · {home ? 'Casa' : 'Fuera'}
                        </span>
                      </span>
                      <span className="mk-match-score">
                        {m.resultado.goles_local} - {m.resultado.goles_visitante}
                      </span>
                      <ChevronRight size={14} className="mk-match-chev" />
                    </button>
                  )
                })}
              </div>

              <button type="button" className="mk-foot-btn" onClick={() => setSelectedTeam(null)}>
                Volver a la clasificación
              </button>
            </div>
          )
        })()}

      {view === 'match' &&
        (() => {
          const m = selectedMatch
          const ours = isOurMatch(m)
          const homeIsUs = m.equipo_local === OUR_TEAM
          const awayIsUs = m.equipo_visitante === OUR_TEAM
          return (
            <div className="mk-body">
              <div className="mk-score-card">
                <span className="mk-score-stripe mk-score-stripe-red" />
                <span className="mk-score-stripe mk-score-stripe-gold" />
                <div className="mk-score-row">
                  <span className={`mk-score-team right ${homeIsUs ? 'gold' : ''}`}>
                    {displayTeamName(m.equipo_local, clubName)}
                  </span>
                  <span className="mk-score-mid">
                    <span className="mk-score-num">
                      {m.resultado.goles_local} – {m.resultado.goles_visitante}
                    </span>
                    <span className="mk-score-tag">Jornada {m.jornada}</span>
                  </span>
                  <span className={`mk-score-team ${awayIsUs ? 'gold' : ''}`}>
                    {displayTeamName(m.equipo_visitante, clubName)}
                  </span>
                </div>
              </div>

              {ours ? (
                <div className="mk-events-wrap">
                  <div className="mk-events-head">
                    <span>Sucesos del partido</span>
                    <span>{matchEvents.length} sucesos</span>
                  </div>
                  <div className="mk-events">
                    {matchEvents.length === 0 && (
                      <p className="mk-empty">Todavía no hay sucesos registrados.</p>
                    )}
                    {matchEvents.map((ev) => {
                      const mark = MARK[ev.kind]
                      return (
                        <div className="mk-event" key={ev.key}>
                          <span className="mk-event-photo">
                            <PlayerAvatar player={ev.player} fallback="initials" />
                          </span>
                          <span className="mk-event-name">{ev.player.name}</span>
                          <span className="mk-event-mark">
                            <span className={mark.cls} />
                            <span
                              className="mk-event-label"
                              style={{
                                color:
                                  ev.kind === 'gol'
                                    ? '#F2EAD8'
                                    : ev.kind === 'asistencia'
                                      ? '#D8B970'
                                      : ev.kind === 'amarilla'
                                        ? '#E3B833'
                                        : '#D7343C',
                              }}
                            >
                              {mark.label}
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="mk-body-pad">
                  <p className="mk-note">
                    Solo guardamos el detalle de sucesos de los partidos de{' '}
                    {clubName || 'nuestro club'}.
                  </p>
                </div>
              )}

              <button type="button" className="mk-foot-btn" onClick={() => setSelectedMatch(null)}>
                Volver a {teamName || 'la clasificación'}
              </button>
            </div>
          )
        })()}

      {view === 'table' && (
        <p className="mk-foot-hint">Toca un equipo para ver su balance y sus partidos.</p>
      )}
    </div>
  )
}
