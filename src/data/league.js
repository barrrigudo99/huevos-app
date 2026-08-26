function emptyStats(team) {
  return { team, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 }
}

function accumulate(stats, golesFavor, golesContra) {
  stats.pj += 1
  stats.gf += golesFavor
  stats.gc += golesContra
  if (golesFavor > golesContra) stats.pg += 1
  else if (golesFavor === golesContra) stats.pe += 1
  else stats.pp += 1
}

function statsFromMatches(teams, partidos) {
  const table = new Map(teams.map((team) => [team, emptyStats(team)]))
  for (const p of partidos) {
    if (!p.jugado || !p.resultado) continue
    const local = table.get(p.equipo_local)
    const visitante = table.get(p.equipo_visitante)
    if (local) accumulate(local, p.resultado.goles_local, p.resultado.goles_visitante)
    if (visitante) accumulate(visitante, p.resultado.goles_visitante, p.resultado.goles_local)
  }
  return table
}

function withPoints(stats) {
  return { ...stats, pts: stats.pg * 3 + stats.pe, dg: stats.gf - stats.gc }
}

// Orden: 1º puntos desc, 2º enfrentamiento directo entre empatados (puntos
// obtenidos solo en los partidos jugados entre ellos), 3º goles a favor desc.
export function computeStandings(equipos, partidos) {
  const base = [...statsFromMatches(equipos, partidos).values()].map(withPoints)

  const groups = []
  for (const row of base.sort((a, b) => b.pts - a.pts)) {
    const last = groups[groups.length - 1]
    if (last && last[0].pts === row.pts) last.push(row)
    else groups.push([row])
  }

  const ranked = groups.flatMap((group) => {
    if (group.length === 1) return group
    const names = group.map((r) => r.team)
    const h2h = [...statsFromMatches(
      names,
      partidos.filter((p) => names.includes(p.equipo_local) && names.includes(p.equipo_visitante))
    ).values()].map(withPoints)
    const h2hPoints = new Map(h2h.map((r) => [r.team, r.pts]))
    return [...group].sort((a, b) => {
      const diff = (h2hPoints.get(b.team) ?? 0) - (h2hPoints.get(a.team) ?? 0)
      if (diff !== 0) return diff
      return b.gf - a.gf
    })
  })

  return ranked
}

export function matchesForTeam(partidos, team) {
  return partidos
    .filter((p) => p.jugado && (p.equipo_local === team || p.equipo_visitante === team))
    .sort((a, b) => a.jornada - b.jornada)
}

// Igual que matchesForTeam pero sin filtrar por "jugado": se usa para
// navegar por todas las jornadas del calendario (2_calendario.json), donde
// ese campo no debe condicionar qué partidos se pueden ver/anotar.
export function sortedMatchesForTeam(partidos, team) {
  return partidos
    .filter((p) => p.equipo_local === team || p.equipo_visitante === team)
    .sort((a, b) => a.jornada - b.jornada)
}

// Nuestro equipo real dentro de la simulación de liga. Debe coincidir con
// el "nombre" del equipo id=1 en simulador/1_equipos.json (MI_EQUIPO_ID en
// los generadores del simulador) — hoy es el nombre del club, no "Equipo 1".
export const OUR_TEAM = 'LOS HUEVOS FC'

export function isOurMatch(partido) {
  return partido.equipo_local === OUR_TEAM || partido.equipo_visitante === OUR_TEAM
}

export function displayTeamName(team, clubName) {
  return team === OUR_TEAM && clubName ? clubName : team
}

export function teamResultCounts(partidos, team) {
  const matches = matchesForTeam(partidos, team)
  let wins = 0
  let draws = 0
  let losses = 0
  for (const m of matches) {
    const isLocal = m.equipo_local === team
    const gf = isLocal ? m.resultado.goles_local : m.resultado.goles_visitante
    const gc = isLocal ? m.resultado.goles_visitante : m.resultado.goles_local
    if (gf > gc) wins += 1
    else if (gf === gc) draws += 1
    else losses += 1
  }
  return { wins, draws, losses }
}
