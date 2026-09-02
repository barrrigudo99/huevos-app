// Migración de una sola vez: JSON/SQLite distribuidos -> PostgreSQL (Supabase).
// Lee las fuentes actuales en modo SOLO LECTURA y hace upsert (idempotente)
// contra las tablas creadas por los_huevos_fc_schema.sql.
//
// Las fuentes JSON originales ya no las usa server/index.js (migrado por
// completo a Supabase) — se conservan solo como backup en _legacy-json/,
// que es de donde las sigue leyendo este script si hace falta re-migrar
// algo (p. ej. tras corregir un dato de origen).
//
// Requisito previo: haber ejecutado los_huevos_fc_schema.sql en el SQL
// Editor de Supabase (incluye los UNIQUE de positions.short_code,
// clubs.name y players.phone que hacen posible el upsert idempotente, y el
// INSERT semilla de seasons/competitions).
//
// Uso: npm run migrate   (carga huevos-app/.env con --env-file-if-exists)

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import ws from 'ws'
import { POSITIONS } from '../src/data/players.js'
import { OUR_TEAM } from '../src/data/league.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const LEGACY_JSON = path.join(ROOT, '_legacy-json')

const DB_PATH = path.join(LEGACY_JSON, 'server', 'db.json')
const CONVOCATORIAS_AUT_PATH = path.join(LEGACY_JSON, 'server', 'db_convocatorias_aut.json')
const EQUIPOS_SIMULADOS_PATH = path.join(LEGACY_JSON, 'simulador', '1_equipos.json')
const CALENDARIO_PATH = path.join(LEGACY_JSON, 'simulador', '2_calendario.json')
const RESULTADOS_PATH = path.join(LEGACY_JSON, 'simulador', 'resultados.json')
const ESTADISTICAS_PERSONALES_PATH = path.join(LEGACY_JSON, 'simulador', 'estadisticas_personales.json')
const PUBLIC_PLAYERS_DIR = path.join(ROOT, 'public')

// ---------- Supabase ----------

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '✗ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (revisa huevos-app/.env).'
  )
  process.exit(1)
}

// Node 20 no trae WebSocket nativo; supabase-js inicializa su cliente de
// Realtime en el constructor aunque este script no lo use, así que hay que
// darle un transporte explícito para que no falle al arrancar.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
})

// ---------- Utilidades ----------

const warnings = []
function warn(msg) {
  warnings.push(msg)
  console.warn(`  ⚠ ${msg}`)
}

function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits || null
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'))
  } catch (err) {
    if (fallback !== undefined) return fallback
    throw new Error(`No se pudo leer ${filePath}: ${err.message}`)
  }
}

// Mismo criterio que aplanarResultados() en server/index.js: desenvuelve el
// formato anidado por jornada a partidos sueltos con la forma del formato
// plano. Se duplica aquí (en vez de importarlo) porque server/index.js
// arranca un servidor Express al cargarse y no exporta nada reutilizable.
function aplanarResultados(resultadosRaw) {
  return resultadosRaw.flatMap((entrada) => {
    if (!Array.isArray(entrada.partidos)) return [entrada]
    return entrada.partidos.map((p) => ({
      jornada: entrada.jornada,
      fecha: p.fecha,
      equipo_local: p.local,
      equipo_visitante: p.visitante,
      resultado: { goles_local: p.goles_local, goles_visitante: p.goles_visitante },
      jugado: true,
      campo: p.campo ?? null,
    }))
  })
}

const summary = {}

// Upsert genérico: antes de escribir, mira qué claves ya existían para
// poder distinguir "insertada" de "actualizada" en el resumen final.
// Devuelve las filas resultantes (con su id generado) para poder resolver
// FKs en los pasos siguientes.
async function upsertBatch({ label, table, rows, conflictColumns, describeRow }) {
  if (rows.length === 0) {
    console.log(`— ${label}: 0 filas para migrar`)
    summary[label] = { inserted: 0, updated: 0 }
    return []
  }

  const conflictCols = conflictColumns.split(',')
  const { data: existing, error: selErr } = await supabase.from(table).select(conflictCols.join(','))
  if (selErr) throw new Error(`No se pudo leer ${table} antes del upsert: ${selErr.message}`)
  const existingKeys = new Set((existing || []).map((r) => conflictCols.map((c) => r[c]).join('||')))

  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictColumns })
    .select()
  if (error) throw new Error(`Error en upsert de ${table}: ${error.message}`)

  let inserted = 0
  let updated = 0
  for (const row of data) {
    const key = conflictCols.map((c) => row[c]).join('||')
    const isNew = !existingKeys.has(key)
    if (isNew) inserted += 1
    else updated += 1
    if (describeRow) {
      console.log(`  ${isNew ? '＋' : '↻'} ${table}: ${describeRow(row)}`)
    }
  }
  console.log(`✓ ${label}: ${inserted} insertadas, ${updated} actualizadas`)
  summary[label] = { inserted, updated }
  return data
}

// ---------- Preflight ----------

async function preflight() {
  const { error } = await supabase.from('positions').select('id').limit(1)
  if (error) {
    console.error(
      '✗ No se encuentra la tabla `positions` en Supabase.\n' +
        '  Ejecuta primero los_huevos_fc_schema.sql en el SQL Editor de Supabase\n' +
        '  (incluye los UNIQUE de positions/clubs/players y la semilla de seasons/competitions).'
    )
    process.exit(1)
  }

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()
  if (seasonErr || !season) {
    console.error('✗ No hay ninguna fila en `seasons` con is_current = true. Revisa el INSERT semilla del schema.sql.')
    process.exit(1)
  }

  const { data: competition, error: compErr } = await supabase
    .from('competitions')
    .select('id, name')
    .limit(1)
    .maybeSingle()
  if (compErr || !competition) {
    console.error('✗ No hay ninguna fila en `competitions`. Revisa el INSERT semilla del schema.sql.')
    process.exit(1)
  }

  console.log(`✓ Esquema encontrado. Temporada activa: "${season.name}" (id ${season.id}). Competición: "${competition.name}" (id ${competition.id}).\n`)
  return { seasonId: season.id, competitionId: competition.id }
}

// ---------- Pasos de migración ----------

async function migratePositions() {
  const rows = POSITIONS.map((p) => ({ short_code: p.code, name: p.label }))
  const data = await upsertBatch({
    label: 'positions',
    table: 'positions',
    rows,
    conflictColumns: 'short_code',
    describeRow: (r) => `${r.short_code} (${r.name})`,
  })
  return new Map(data.map((r) => [r.short_code, r.id]))
}

async function migrateClubs(db, equiposData) {
  const ourName = db.club?.name?.trim() || 'Huevos FC'
  const equipos = equiposData.equipos || []

  const rows = [{ name: ourName, is_own: true }]
  for (const e of equipos) {
    if (e.nombre === OUR_TEAM) continue // sustituido por el nombre real del club (ourName)
    rows.push({ name: e.nombre, is_own: false })
  }

  const data = await upsertBatch({
    label: 'clubs',
    table: 'clubs',
    rows,
    conflictColumns: 'name',
    describeRow: (r) => `${r.name}${r.is_own ? ' (propio)' : ''}`,
  })

  const clubIdByName = new Map(data.map((r) => [r.name, r.id]))
  // Mapa por el nombre que usan los archivos del simulador (1_equipos.json,
  // 2_calendario.json, resultados.json): "LOS HUEVOS FC" -> id del club propio.
  const clubIdBySimName = new Map()
  for (const e of equipos) {
    clubIdBySimName.set(e.nombre, e.nombre === OUR_TEAM ? clubIdByName.get(ourName) : clubIdByName.get(e.nombre))
  }
  // Alias conocidos: resultados.json escribe "LOS HUEVOS F.C" (con puntos)
  // en algunas jornadas y "LOS HUEVOS FC" (sin puntos, igual que OUR_TEAM)
  // en otras — inconsistencia real del propio archivo fuente, no un typo de
  // esta migración. Se resuelve al mismo club propio.
  clubIdBySimName.set('LOS HUEVOS F.C', clubIdByName.get(ourName))
  return clubIdBySimName
}

async function migratePlayers(db, positionsMap) {
  const rows = []
  for (const p of db.players) {
    const codes = p.positions || []
    if (codes.length > 1) {
      warn(`jugador "${p.name}" tiene ${codes.length} posiciones (${codes.join(', ')}) — se migra solo la primera (${codes[0]})`)
    }
    const primaryCode = codes[0]
    const positionId = primaryCode ? positionsMap.get(primaryCode) ?? null : null
    if (primaryCode && positionId == null) {
      warn(`jugador "${p.name}": código de posición "${primaryCode}" no existe en el catálogo positions`)
    }

    const phone = normalizePhone(p.phone)
    if (!phone) {
      warn(`jugador "${p.name}" (id ${p.id}) no tiene teléfono — no se puede garantizar idempotencia para esta fila en re-ejecuciones`)
    }

    if (p.photo) {
      const filePath = path.join(PUBLIC_PLAYERS_DIR, p.photo.replace(/^\//, ''))
      if (!existsSync(filePath)) {
        warn(`jugador "${p.name}": photo_url "${p.photo}" no corresponde a ningún fichero real en public/players/`)
      }
    }

    rows.push({
      full_name: p.name,
      birth_date: p.birthDate || null,
      position_id: positionId,
      phone,
      photo_url: p.photo || null,
      active: true,
    })
  }

  const data = await upsertBatch({
    label: 'players',
    table: 'players',
    rows,
    conflictColumns: 'phone',
    describeRow: (r) => `${r.full_name} (${r.phone})`,
  })

  const playerIdByPhone = new Map(data.filter((r) => r.phone).map((r) => [r.phone, r.id]))
  const playerIdByName = new Map(data.map((r) => [r.full_name.trim().toLowerCase(), r.id]))
  return { playerIdByPhone, playerIdByName }
}

async function migratePlayerSeasonRoster(db, seasonId, playerIdByPhone) {
  const rows = []
  for (const p of db.players) {
    const phone = normalizePhone(p.phone)
    const playerId = phone ? playerIdByPhone.get(phone) : null
    if (!playerId) {
      warn(`jugador "${p.name}": sin player_id resuelto, no se crea su fila de player_season_roster`)
      continue
    }
    rows.push({ player_id: playerId, season_id: seasonId, dorsal_number: p.number ?? null })
  }

  await upsertBatch({
    label: 'player_season_roster',
    table: 'player_season_roster',
    rows,
    conflictColumns: 'player_id,season_id',
    describeRow: (r) => `player_id ${r.player_id}, dorsal ${r.dorsal_number}`,
  })
}

async function migrateUsers(db, playerIdByName) {
  const rows = []
  for (const u of db.users) {
    if (!['jugador', 'entrenador'].includes(u.role)) {
      warn(`usuario "${u.name}" tiene role "${u.role}", no reconocido — se omite`)
      continue
    }
    const playerId = playerIdByName.get(u.name.trim().toLowerCase()) ?? null
    if (!playerId) {
      warn(`usuario "${u.name}" (${u.email}) no tiene ningún jugador con el mismo nombre — player_id queda NULL`)
    }
    rows.push({
      email: String(u.email).trim().toLowerCase(),
      password_hash: bcrypt.hashSync(String(u.password), 10),
      full_name: u.name,
      role: u.role,
      player_id: playerId,
    })
  }

  await upsertBatch({
    label: 'users',
    table: 'users',
    rows,
    conflictColumns: 'email',
    describeRow: (r) => `${r.email} (${r.role}${r.player_id ? `, player_id ${r.player_id}` : ''})`,
  })
}

async function migrateMatchdays(calendario, resultadosFlat, dbConvocatoriasAut, clubIdBySimName, seasonId, competitionId) {
  // Resultados simulados que nos involucran, indexados por jornada, para
  // enriquecer venue y detectar el conflicto jugado=false vs resultado ya
  // simulado.
  const simuladoPorJornada = new Map()
  for (const p of resultadosFlat) {
    if (p.equipo_local === OUR_TEAM || p.equipo_visitante === OUR_TEAM) {
      simuladoPorJornada.set(p.jornada, p)
    }
  }

  const pollByMatchId = new Map(dbConvocatoriasAut.map((r) => [r.matchId, r]))

  const rows = []
  const jornadaToCalendarioId = new Map()
  for (const c of calendario) {
    jornadaToCalendarioId.set(c.jornada, c.id)
    const isHome = c.equipo_local === OUR_TEAM
    const rivalName = isHome ? c.equipo_visitante : c.equipo_local
    const opponentClubId = clubIdBySimName.get(rivalName) ?? null
    if (!opponentClubId) {
      warn(`jornada ${c.jornada}: rival "${rivalName}" no está en el catálogo de clubs — opponent_club_id queda NULL`)
    }

    const simulado = simuladoPorJornada.get(c.jornada)
    if (simulado && !c.jugado) {
      warn(`jornada ${c.jornada}: hay resultado simulado disponible pero 2_calendario.json la marca jugado=false — revisa si hay que actualizarlo`)
    }

    const poll = pollByMatchId.get(c.id)

    rows.push({
      season_id: seasonId,
      competition_id: competitionId,
      jornada_number: c.jornada,
      match_date: c.fecha,
      opponent_club_id: opponentClubId,
      is_home: isHome,
      venue: simulado?.campo ?? null,
      status: c.jugado ? 'played' : 'scheduled',
      whatsapp_poll_id: poll?.whatsappPollId || null,
    })
  }

  const data = await upsertBatch({
    label: 'matchdays',
    table: 'matchdays',
    rows,
    conflictColumns: 'season_id,competition_id,jornada_number',
    describeRow: (r) => `jornada ${r.jornada_number} (${r.status})`,
  })

  const matchdayIdByCalendarioId = new Map()
  for (const row of data) {
    const calendarioId = jornadaToCalendarioId.get(row.jornada_number)
    if (calendarioId != null) matchdayIdByCalendarioId.set(calendarioId, row.id)
  }
  return { matchdayIdByCalendarioId, simuladoPorJornada }
}

async function migrateMatches(calendario, estadisticasPersonales, simuladoPorJornada, matchdayIdByCalendarioId) {
  const manualById = new Map(estadisticasPersonales.filter((e) => e.resultado).map((e) => [e.id, e]))

  const rows = []
  for (const c of calendario) {
    const matchdayId = matchdayIdByCalendarioId.get(c.id)
    if (!matchdayId) continue // no debería pasar: toda jornada del calendario se migra en el paso anterior

    const manual = manualById.get(c.id)
    const simulado = simuladoPorJornada.get(c.jornada)

    let goalsFor
    let goalsAgainst
    let source
    if (manual) {
      source = 'manual'
      goalsFor = manual.resultado.golesNosotros
      goalsAgainst = manual.resultado.golesRival
    } else if (simulado) {
      source = 'simulado'
      const esLocal = simulado.equipo_local === OUR_TEAM
      goalsFor = esLocal ? simulado.resultado.goles_local : simulado.resultado.goles_visitante
      goalsAgainst = esLocal ? simulado.resultado.goles_visitante : simulado.resultado.goles_local
    } else {
      continue // sin resultado manual ni simulado: la jornada aún no se ha jugado/simulado
    }

    rows.push({ matchday_id: matchdayId, goals_for: goalsFor, goals_against: goalsAgainst, source })
  }

  const data = await upsertBatch({
    label: 'matches',
    table: 'matches',
    rows,
    conflictColumns: 'matchday_id',
    describeRow: (r) => `matchday_id ${r.matchday_id}: ${r.goals_for}-${r.goals_against} (${r.source})`,
  })

  return new Map(data.map((r) => [r.matchday_id, r.id]))
}

async function migratePlayerMatchStats(estadisticasPersonales, matchdayIdByCalendarioId, matchIdByMatchdayId, playerIdByPhone, playerIdByName) {
  warn('player_match_stats: "started" y "minutes_played" no tienen fuente de datos en estadisticas_personales.json — quedan en su valor por defecto (false / 0)')

  const rows = []
  for (const entrada of estadisticasPersonales) {
    const matchdayId = matchdayIdByCalendarioId.get(entrada.id)
    const matchId = matchdayId ? matchIdByMatchdayId.get(matchdayId) : null
    if (!matchId) {
      warn(`estadísticas personales del partido id=${entrada.id} (rival ${entrada.rival}): no se pudo resolver un match migrado — se omiten sus ${entrada.jugadores?.length ?? 0} filas de jugadores`)
      continue
    }
    for (const j of entrada.jugadores || []) {
      const phone = normalizePhone(j.phone)
      const playerId = (phone && playerIdByPhone.get(phone)) ?? playerIdByName.get(String(j.name).trim().toLowerCase())
      if (!playerId) {
        warn(`estadísticas del partido id=${entrada.id}: jugador "${j.name}" (phone ${j.phone}) no coincide con ningún jugador migrado`)
        continue
      }
      const yellow = typeof j.amarillas === 'number' ? j.amarillas : j.tarjetaAmarilla ? 1 : 0
      rows.push({
        match_id: matchId,
        player_id: playerId,
        goals: j.goles || 0,
        assists: j.asistencias || 0,
        yellow_cards: yellow,
        red_cards: j.tarjetaRoja ? 1 : 0,
      })
    }
  }

  await upsertBatch({
    label: 'player_match_stats',
    table: 'player_match_stats',
    rows,
    conflictColumns: 'match_id,player_id',
    describeRow: (r) => `match_id ${r.match_id}, player_id ${r.player_id}: ${r.goals}g ${r.assists}a`,
  })
}

function logEmptyTable(label, reason) {
  console.log(`— ${label}: 0 filas (${reason})`)
  summary[label] = { inserted: 0, updated: 0 }
}

async function migrateCallUps(db, dbConvocatoriasAut, matchdayIdByCalendarioId, playerIdByPhone) {
  const rows = []
  const knownPhones = new Set(db.players.map((p) => normalizePhone(p.phone)).filter(Boolean))

  for (const record of dbConvocatoriasAut) {
    const matchdayId = matchdayIdByCalendarioId.get(record.matchId)
    if (!matchdayId) {
      warn(`convocatoria matchId=${record.matchId} (rival "${record.rival}", fecha ${record.date}) no corresponde a ninguna jornada migrada — se omite`)
      continue
    }
    const votes = record.votes || {}

    for (const p of db.players) {
      const phone = normalizePhone(p.phone)
      const playerId = phone ? playerIdByPhone.get(phone) : null
      if (!playerId) continue // ya avisado en el paso de players
      const vote = phone ? votes[phone] : undefined
      const attended = vote === 'Si' ? true : vote === 'No' ? false : null // 'Duda' o sin respuesta -> NULL
      rows.push({ matchday_id: matchdayId, player_id: playerId, called: true, attended, role_in_squad: null })
    }

    for (const [phone, vote] of Object.entries(votes)) {
      if (!knownPhones.has(normalizePhone(phone))) {
        warn(`voto de teléfono ${phone} ("${vote}") en partido vs "${record.rival}" no coincide con ningún jugador — no migrado`)
      }
    }
  }

  await upsertBatch({
    label: 'call_ups',
    table: 'call_ups',
    rows,
    conflictColumns: 'matchday_id,player_id',
    describeRow: (r) => `matchday_id ${r.matchday_id}, player_id ${r.player_id}: attended=${r.attended}`,
  })
}

// simulador/resultados.json (formato anidado) trae fechas "DD/MM/YYYY" como
// string, distinto del ISO que usa 2_calendario.json — ver
// migration-diagnosis.md §4. Se convierte antes de insertar en una columna
// TIMESTAMP para no confiar en el parseo ambiguo de Postgres.
function fechaSimuladorAIso(fecha) {
  if (!fecha) return null
  const [d, m, y] = String(fecha).split('/')
  if (!d || !m || !y) return fecha
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// Liga completa simulada (todos los equipos, no solo Los Huevos FC) ->
// league_fixtures. Independiente de matchdays/matches (que son solo
// nuestro calendario real).
async function migrateLeagueFixtures(resultadosFlat, clubIdBySimName, seasonId, competitionId) {
  const rows = []
  for (const p of resultadosFlat) {
    const homeId = clubIdBySimName.get(p.equipo_local)
    const awayId = clubIdBySimName.get(p.equipo_visitante)
    if (!homeId || !awayId) {
      warn(`liga: jornada ${p.jornada} "${p.equipo_local}" vs "${p.equipo_visitante}" tiene un equipo no reconocido en clubs — se omite`)
      continue
    }
    rows.push({
      season_id: seasonId,
      competition_id: competitionId,
      jornada_number: p.jornada,
      match_date: fechaSimuladorAIso(p.fecha),
      home_club_id: homeId,
      away_club_id: awayId,
      goals_home: p.resultado.goles_local,
      goals_away: p.resultado.goles_visitante,
      venue: p.campo ?? null,
    })
  }

  await upsertBatch({
    label: 'league_fixtures',
    table: 'league_fixtures',
    rows,
    conflictColumns: 'season_id,competition_id,jornada_number,home_club_id,away_club_id',
    describeRow: (r) => `jornada ${r.jornada_number}: club ${r.home_club_id} ${r.goals_home}-${r.goals_away} club ${r.away_club_id}`,
  })
}

// ---------- Orquestación ----------

async function main() {
  console.log('== Migración JSON/SQLite -> Supabase (Los Huevos FC) ==\n')
  const { seasonId, competitionId } = await preflight()

  const [db, equiposData, calendario, resultadosRaw, estadisticasPersonales, dbConvocatoriasAut] = await Promise.all([
    readJson(DB_PATH),
    readJson(EQUIPOS_SIMULADOS_PATH, { equipos: [] }),
    readJson(CALENDARIO_PATH, []),
    readJson(RESULTADOS_PATH, []),
    readJson(ESTADISTICAS_PERSONALES_PATH, []),
    readJson(CONVOCATORIAS_AUT_PATH, []),
  ])
  const resultadosFlat = aplanarResultados(resultadosRaw)

  console.log('--- positions ---')
  const positionsMap = await migratePositions()

  console.log('\n--- clubs ---')
  const clubIdBySimName = await migrateClubs(db, equiposData)

  console.log('\n--- players ---')
  const { playerIdByPhone, playerIdByName } = await migratePlayers(db, positionsMap)

  console.log('\n--- player_season_roster ---')
  await migratePlayerSeasonRoster(db, seasonId, playerIdByPhone)

  console.log('\n--- users ---')
  await migrateUsers(db, playerIdByName)

  console.log('\n--- matchdays ---')
  const { matchdayIdByCalendarioId, simuladoPorJornada } = await migrateMatchdays(
    calendario,
    resultadosFlat,
    dbConvocatoriasAut,
    clubIdBySimName,
    seasonId,
    competitionId
  )

  console.log('\n--- matches ---')
  const matchIdByMatchdayId = await migrateMatches(calendario, estadisticasPersonales, simuladoPorJornada, matchdayIdByCalendarioId)

  console.log('\n--- player_match_stats ---')
  await migratePlayerMatchStats(estadisticasPersonales, matchdayIdByCalendarioId, matchIdByMatchdayId, playerIdByPhone, playerIdByName)

  console.log('\n--- player_ratings / team_ratings / team_match_stats ---')
  logEmptyTable('player_ratings', 'sin fuente de datos en el JSON actual')
  logEmptyTable('team_ratings', 'sin fuente de datos en el JSON actual')
  logEmptyTable('team_match_stats', 'sin fuente de datos en el JSON actual')

  console.log('\n--- call_ups ---')
  await migrateCallUps(db, dbConvocatoriasAut, matchdayIdByCalendarioId, playerIdByPhone)

  console.log('\n--- league_fixtures ---')
  await migrateLeagueFixtures(resultadosFlat, clubIdBySimName, seasonId, competitionId)

  // ---------- Resumen ----------
  console.log('\n\n== Resumen ==')
  for (const [label, { inserted, updated }] of Object.entries(summary)) {
    console.log(`${label.padEnd(22)} ${String(inserted).padStart(3)} insertadas / ${String(updated).padStart(3)} actualizadas`)
  }

  console.log(`\nAdvertencias (${warnings.length}):`)
  if (warnings.length === 0) {
    console.log('  (ninguna)')
  } else {
    warnings.forEach((w) => console.log(`  - ${w}`))
  }
}

main().catch((err) => {
  console.error('\n✗ Migración abortada:', err.message)
  process.exit(1)
})
