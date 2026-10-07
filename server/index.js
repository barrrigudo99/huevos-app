import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import ws from 'ws'
import {
  createPollMessage,
  fetchPollVotes,
  isMockVotesActive,
  sendTextMessage,
  setMockPlayerPhonesProvider,
} from './whatsappPollService.js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (revisa .env).')
}
// Node 20 no trae WebSocket nativo; supabase-js inicializa su cliente de
// Realtime en el constructor aunque no se use, así que hay que darle un
// transporte explícito para que no falle al arrancar (mismo motivo que en
// server/migrate-to-supabase.mjs).
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
})

const app = express()

// Orígenes permitidos para llamar a esta API: el frontend en Vercel (producción
// y previews) y el Vite dev server local.
app.use(
  cors({
    origin: [
      'https://huevos-app-three.vercel.app',
      /^https:\/\/huevos-app-git-[a-z0-9-]+-carlos-projects-e13f8134\.vercel\.app$/,
      'http://localhost:5173',
      /^https:\/\/huevos-[a-z0-9-]+-carlos-projects-e13f8134\.vercel\.app$/,
    ],
  })
)

// Health check para Render: sin autenticación, hace una consulta mínima a
// Supabase para comprobar que la API puede llegar a la base de datos.
app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const { error } = await supabase.from('seasons').select('id').limit(1)
    if (error) throw new Error(error.message)
    res.json({ status: 'ok', supabase: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'error', supabase: 'unreachable', error: err.message })
  }
})
// Límite por defecto (100kb) se queda corto para la foto de perfil en
// base64 (hasta 5MB de archivo => ~6.8MB en base64).
app.use(express.json({ limit: '8mb' }))

// Convierte una fila de la tabla `users` de Supabase a la forma que ya
// espera el frontend ({id, name, email, role, player_id}), sin exponer
// password_hash. player_id (opcional, puede ser NULL) permite al frontend
// saber qué jugador de la plantilla es este usuario sin emparejar por
// nombre — lo usa RatingPanel para excluir la fila del propio jugador.
function publicUser(row) {
  return { id: row.id, name: row.full_name, email: row.email, role: row.role, player_id: row.player_id ?? null }
}

let currentSeasonCache = null
async function getCurrentSeason() {
  if (currentSeasonCache) return currentSeasonCache
  const { data, error } = await supabase.from('seasons').select('id, name').eq('is_current', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('No hay ninguna temporada con is_current = true en Supabase.')
  currentSeasonCache = data
  return data
}


function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits || null
}

// Requiere que la petición identifique (cabecera X-User-Id) a un usuario
// existente con rol "entrenador". No hay tokens/sesión en esta app todavía,
// así que esto es la validación de rol server-side pedida en la Tarea 1:
// evita que la acción se ejecute aunque se llame directamente al endpoint
// saltándose el botón (con un id de jugador, o sin cabecera, se rechaza).
function requireEntrenador() {
  return async (req, res, next) => {
    const userId = Number(req.get('X-User-Id'))
    if (!userId) {
      return res.status(401).json({ error: 'Falta identificar al usuario (X-User-Id).' })
    }
    const { data: user, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle()
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    if (!user || user.role !== 'entrenador') {
      return res.status(403).json({ error: 'Solo un entrenador puede realizar esta acción.' })
    }
    req.currentUser = user
    next()
  }
}

// Permite la acción si quien llama es entrenador, o si es el propio jugador
// (users.player_id === :id de la ruta) — para que cada jugador pueda editar
// su propio perfil sin que haga falta que lo haga un entrenador por él.
function requireSelfOrEntrenador() {
  return async (req, res, next) => {
    const playerId = Number(req.params.id)
    const user = await getUserByHeader(req)
    if (!user) {
      return res.status(401).json({ error: 'Falta identificar al usuario (X-User-Id).' })
    }
    if (user.role !== 'entrenador' && user.player_id !== playerId) {
      return res.status(403).json({ error: 'Solo puedes editar tu propio perfil.' })
    }
    req.currentUser = user
    next()
  }
}

// Reconstruye la forma que ya espera el frontend ({id, name, positions:
// [code], number, phone, photo}) a partir de players + positions +
// player_season_roster (el dorsal es por temporada; se usa la activa).
async function fetchPlayersFromSupabase() {
  const season = await getCurrentSeason()
  const [{ data: players, error: playersErr }, { data: positions, error: posErr }, { data: roster, error: rosterErr }] =
    await Promise.all([
      supabase.from('players').select('id, full_name, phone, photo_url, position_id'),
      supabase.from('positions').select('id, short_code'),
      supabase.from('player_season_roster').select('player_id, dorsal_number').eq('season_id', season.id),
    ])
  if (playersErr) throw new Error(playersErr.message)
  if (posErr) throw new Error(posErr.message)
  if (rosterErr) throw new Error(rosterErr.message)

  const codeById = new Map(positions.map((p) => [p.id, p.short_code]))
  const dorsalByPlayerId = new Map(roster.map((r) => [r.player_id, r.dorsal_number]))

  return players.map((p) => ({
    id: p.id,
    name: p.full_name,
    positions: p.position_id && codeById.has(p.position_id) ? [codeById.get(p.position_id)] : [],
    number: dorsalByPlayerId.get(p.id) ?? 0,
    phone: p.phone,
    photo: p.photo_url,
  }))
}

// El modo simulación de votos (WHAPI_MOCK_VOTES) vive ahora entero en
// whatsappPollService.js (fetchPollVotes lo comprueba internamente); esto
// solo le da la forma de obtener los teléfonos de la plantilla para su
// variante 'all-si', ya que ese módulo no conoce Supabase.
setMockPlayerPhonesProvider(async () => {
  const players = await fetchPlayersFromSupabase()
  return players.filter((p) => p.phone).map((p) => p.phone)
})

app.get('/api/players', async (req, res) => {
  try {
    res.json(await fetchPlayersFromSupabase())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Las 5 posiciones del catálogo (id + short_code + name), para el
// desplegable de "Posición" en PlayerProfileScreen. Solo lectura.
app.get('/api/positions', async (req, res) => {
  const { data, error } = await supabase.from('positions').select('id, name, short_code').order('id')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data.map((p) => ({ id: p.id, code: p.short_code, label: p.name })))
})

app.post('/api/players', requireEntrenador(), async (req, res) => {
  const { name, positions, number, phone, birthDate } = req.body
  if (!name || !Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'Datos de jugador incompletos.' })
  }
  // El esquema solo admite una posición principal por jugador; se usa la
  // primera de la lista (ver migration-diagnosis.md, punto 3a).
  const primaryCode = positions[0]
  const { data: positionRow, error: posErr } = await supabase
    .from('positions')
    .select('id')
    .eq('short_code', primaryCode)
    .maybeSingle()
  if (posErr) return res.status(500).json({ error: posErr.message })
  if (!positionRow) return res.status(400).json({ error: `Código de posición "${primaryCode}" no reconocido.` })

  const { data: player, error: insertErr } = await supabase
    .from('players')
    .insert({
      full_name: name,
      position_id: positionRow.id,
      phone: normalizePhone(phone),
      birth_date: birthDate || null,
      photo_url: null,
      active: true,
    })
    .select()
    .single()
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  const season = await getCurrentSeason()
  const dorsal = Number(number) || 0
  const { error: rosterErr } = await supabase
    .from('player_season_roster')
    .insert({ player_id: player.id, season_id: season.id, dorsal_number: dorsal })
  if (rosterErr) return res.status(500).json({ error: rosterErr.message })

  res.status(201).json({
    id: player.id,
    name: player.full_name,
    positions: [primaryCode],
    number: dorsal,
    phone: player.phone,
    photo: player.photo_url,
  })
})

async function getSeasonMatchdayIds(seasonId) {
  const { data, error } = await supabase.from('matchdays').select('id').eq('season_id', seasonId)
  if (error) throw new Error(error.message)
  return data.map((m) => m.id)
}

// Jornadas de la temporada que el equipo YA ha jugado (matchdays.status =
// 'played'). Es el denominador del % de asistencia a convocatorias: ese
// porcentaje se mide siempre contra las jornadas jugadas por el EQUIPO, no
// contra las veces que se convocó a cada jugador.
async function getPlayedMatchdayIds(seasonId) {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id')
    .eq('season_id', seasonId)
    .eq('status', 'played')
  if (error) throw new Error(error.message)
  return data.map((m) => m.id)
}

// Asistencias a convocatoria por jugador dentro de un conjunto de jornadas:
// cuenta las jornadas en las que el entrenador lo convocó (call_ups.called =
// true). El voto de WhatsApp (call_ups.vote) no cuenta: votar Sí y no ser
// convocado cuenta como No. Devuelve Map player_id -> nº de jornadas
// convocado. El % se calcula fuera dividiendo entre
// getPlayedMatchdayIds().length.
async function contarAsistenciasPorJugador(matchdayIds) {
  if (matchdayIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('call_ups')
    .select('player_id')
    .eq('called', true)
    .in('matchday_id', matchdayIds)
  if (error) throw new Error(error.message)
  const porJugador = new Map()
  for (const r of data) porJugador.set(r.player_id, (porJugador.get(r.player_id) || 0) + 1)
  return porJugador
}

// Cuenta, para cada jugador, en cuántos partidos de `matchdayIds` fue el más
// votado en match_mvp_votes. Si dos o más jugadores empatan a más votos en un
// partido, ese partido no cuenta como MVP para nadie (decisión de producto: no
// hay un criterio de desempate no arbitrario entre compañeros). Devuelve un
// Map player_id -> número de MVPs.
async function contarMvpsPorJugador(matchdayIds) {
  if (matchdayIds.length === 0) return new Map()
  const { data: matches, error: matchesErr } = await supabase.from('matches').select('id').in('matchday_id', matchdayIds)
  if (matchesErr) throw new Error(matchesErr.message)
  const matchIds = matches.map((m) => m.id)
  if (matchIds.length === 0) return new Map()

  const { data: votos, error: votosErr } = await supabase
    .from('match_mvp_votes')
    .select('match_id, player_id')
    .in('match_id', matchIds)
  if (votosErr) throw new Error(votosErr.message)

  const votosPorMatch = new Map()
  for (const v of votos) {
    if (!votosPorMatch.has(v.match_id)) votosPorMatch.set(v.match_id, new Map())
    const porJugador = votosPorMatch.get(v.match_id)
    porJugador.set(v.player_id, (porJugador.get(v.player_id) || 0) + 1)
  }

  const mvpsPorJugador = new Map()
  for (const porJugador of votosPorMatch.values()) {
    let max = 0
    let ganadores = []
    for (const [pid, n] of porJugador) {
      if (n > max) {
        max = n
        ganadores = [pid]
      } else if (n === max) {
        ganadores.push(pid)
      }
    }
    if (ganadores.length === 1) {
      mvpsPorJugador.set(ganadores[0], (mvpsPorJugador.get(ganadores[0]) || 0) + 1)
    }
  }
  return mvpsPorJugador
}

// MVPs ganados por un solo jugador en `matchdayIds` (ver contarMvpsPorJugador).
async function contarMvpsGanados(matchdayIds, playerId) {
  return (await contarMvpsPorJugador(matchdayIds)).get(playerId) || 0
}

// Ficha completa de un jugador para PlayerProfileScreen: datos personales +
// stats de la temporada activa (vista season_player_stats), % asistencia a
// convocatorias (call_ups) y MVPs recibidos. Solo lectura, cualquiera
// logueado puede consultar la de un compañero (se usa también al pinchar un
// jugador desde Plantilla).
app.get('/api/players/:id/profile', async (req, res) => {
  const playerId = Number(req.params.id)
  try {
    const [{ data: player, error: playerErr }, season] = await Promise.all([
      supabase
        .from('players')
        .select('id, full_name, birth_date, position_id, phone, photo_url')
        .eq('id', playerId)
        .maybeSingle(),
      getCurrentSeason(),
    ])
    if (playerErr) throw new Error(playerErr.message)
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' })

    const position = player.position_id
      ? (await supabase.from('positions').select('name, short_code').eq('id', player.position_id).maybeSingle()).data
      : null

    const [matchdayIds, playedMatchdayIds] = await Promise.all([
      getSeasonMatchdayIds(season.id),
      getPlayedMatchdayIds(season.id),
    ])

    const [{ data: statsRow, error: statsErr }, asistenciasPorJugador] = await Promise.all([
      supabase
        .from('season_player_stats')
        .select(
          'matches_played, total_goals, total_assists, total_yellow_cards, total_red_cards, avg_esfuerzo, avg_equipo, avg_liderazgo, avg_impacto'
        )
        .eq('player_id', playerId)
        .eq('season_id', season.id)
        .maybeSingle(),
      contarAsistenciasPorJugador(playedMatchdayIds),
    ])
    if (statsErr) throw new Error(statsErr.message)

    // % sobre las jornadas jugadas por el equipo: null solo mientras el equipo
    // no ha jugado ninguna; en cuanto hay partidos, un jugador que no asistió a
    // ninguno es 0 %, no "sin datos".
    const attendancePct =
      playedMatchdayIds.length > 0
        ? Math.round(((asistenciasPorJugador.get(playerId) || 0) / playedMatchdayIds.length) * 100)
        : null

    const mvpsRecibidos = await contarMvpsGanados(matchdayIds, playerId)

    res.json({
      id: player.id,
      name: player.full_name,
      birthDate: player.birth_date,
      positionCode: position?.short_code || null,
      positionLabel: position?.name || null,
      phone: player.phone,
      photo: player.photo_url,
      stats: {
        matchesPlayed: statsRow?.matches_played ?? 0,
        goals: statsRow?.total_goals ?? 0,
        assists: statsRow?.total_assists ?? 0,
        yellowCards: statsRow?.total_yellow_cards ?? 0,
        redCards: statsRow?.total_red_cards ?? 0,
        avgEsfuerzo: statsRow?.avg_esfuerzo ?? null,
        avgEquipo: statsRow?.avg_equipo ?? null,
        avgLiderazgo: statsRow?.avg_liderazgo ?? null,
        avgImpacto: statsRow?.avg_impacto ?? null,
        attendancePct,
        mvpsRecibidos,
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Histórico de notas por jornada + últimos 8 partidos con nota, para las
// secciones "Evolución por jornada" y "Últimos partidos" del perfil.
//
// player_ratings NO tiene columna `score`: la nota de un voto es la media de
// (impacto + esfuerzo + equipo + liderazgo) / 4, y puede haber varios
// votantes por partido y jugador, así que primero se promedia por (partido,
// jugador) y luego se agrega. `teamRating` incluye al propio jugador en la
// media del equipo (si algún día se quiere "el resto del equipo", filtrar
// player_id <> playerId en la media de `all`).
app.get('/api/players/:id/ratings-history', async (req, res) => {
  const playerId = Number(req.params.id)
  try {
    const season = req.query.season ? { id: Number(req.query.season) } : await getCurrentSeason()

    const { data: mdRows, error: mdErr } = await supabase
      .from('matchdays')
      .select('id, jornada_number, match_date, opponent_club_id, is_home')
      .eq('season_id', season.id)
    if (mdErr) throw new Error(mdErr.message)
    const matchdayById = new Map(mdRows.map((m) => [m.id, m]))
    const seasonMatchdayIds = mdRows.map((m) => m.id)
    if (seasonMatchdayIds.length === 0) return res.json({ evolution: [], lastMatches: [] })

    const { data: matchRows, error: matchErr } = await supabase
      .from('matches')
      .select('id, matchday_id, goals_for, goals_against')
      .in('matchday_id', seasonMatchdayIds)
    if (matchErr) throw new Error(matchErr.message)
    const matchById = new Map(matchRows.map((m) => [m.id, m]))
    const matchIds = matchRows.map((m) => m.id)
    if (matchIds.length === 0) return res.json({ evolution: [], lastMatches: [] })

    // player_ratings -> nota media por (match, player) (varios votantes).
    const { data: ratingRows, error: ratErr } = await supabase
      .from('player_ratings')
      .select('match_id, player_id, impacto, esfuerzo, equipo, liderazgo')
      .in('match_id', matchIds)
      .not('impacto', 'is', null)
    if (ratErr) throw new Error(ratErr.message)

    const votos = new Map() // `${match}|${player}` -> { sum, n }
    for (const r of ratingRows) {
      const nota = (r.impacto + r.esfuerzo + r.equipo + r.liderazgo) / 4
      const k = `${r.match_id}|${r.player_id}`
      const acc = votos.get(k) || { sum: 0, n: 0 }
      acc.sum += nota
      acc.n += 1
      votos.set(k, acc)
    }
    const notaPorPartido = new Map() // match_id -> Map(player_id -> nota media)
    for (const [k, acc] of votos) {
      const [mid, pid] = k.split('|').map(Number)
      if (!notaPorPartido.has(mid)) notaPorPartido.set(mid, new Map())
      notaPorPartido.get(mid).set(pid, acc.sum / acc.n)
    }

    const round2 = (x) => Math.round(x * 100) / 100
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length

    // §1 evolución: agrupar por (jornada, fecha); HAVING el jugador tiene nota.
    const grupos = new Map()
    for (const [mid, porJugador] of notaPorPartido) {
      const md = matchdayById.get(matchById.get(mid)?.matchday_id)
      if (!md) continue
      const gk = `${md.jornada_number}|${md.match_date}`
      if (!grupos.has(gk)) grupos.set(gk, { matchday: md.jornada_number, date: md.match_date, player: [], all: [] })
      const g = grupos.get(gk)
      for (const [pid, nota] of porJugador) {
        g.all.push(nota)
        if (pid === playerId) g.player.push(nota)
      }
    }
    const evolution = [...grupos.values()]
      .filter((g) => g.player.length > 0)
      .map((g) => ({
        matchday: g.matchday,
        date: g.date,
        rating: round2(mean(g.player)),
        teamRating: round2(mean(g.all)),
      }))
      .sort((a, b) => a.matchday - b.matchday)

    // §2 últimos partidos: solo aquellos con player_match_stats del jugador.
    const { data: pmsRows, error: pmsErr } = await supabase
      .from('player_match_stats')
      .select('match_id, goals, assists, yellow_cards, red_cards')
      .eq('player_id', playerId)
      .in('match_id', matchIds)
    if (pmsErr) throw new Error(pmsErr.message)
    const pmsByMatch = new Map(pmsRows.map((r) => [r.match_id, r]))

    const { data: mvpRows, error: mvpErr } = await supabase
      .from('match_mvp_votes')
      .select('match_id, player_id')
      .in('match_id', matchIds)
    if (mvpErr) throw new Error(mvpErr.message)
    const mvpCounts = new Map()
    for (const v of mvpRows) {
      if (!mvpCounts.has(v.match_id)) mvpCounts.set(v.match_id, new Map())
      const c = mvpCounts.get(v.match_id)
      c.set(v.player_id, (c.get(v.player_id) || 0) + 1)
    }
    const mvpByMatch = new Map()
    for (const [mid, c] of mvpCounts) {
      let best = null
      let bestN = 0
      for (const [pid, n] of c) {
        if (n > bestN) {
          bestN = n
          best = pid
        }
      }
      mvpByMatch.set(mid, best)
    }

    const clubIds = [...new Set(mdRows.map((m) => m.opponent_club_id).filter(Boolean))]
    const { data: clubRows, error: clubErr } = clubIds.length
      ? await supabase.from('clubs').select('id, name').in('id', clubIds)
      : { data: [], error: null }
    if (clubErr) throw new Error(clubErr.message)
    const clubNameById = new Map(clubRows.map((c) => [c.id, c.name]))

    const lastMatches = matchRows
      .filter((m) => pmsByMatch.has(m.id))
      .map((m) => {
        const md = matchdayById.get(m.matchday_id)
        const pms = pmsByMatch.get(m.id) || {}
        const notas = notaPorPartido.get(m.id)
        const miNota = notas && notas.has(playerId) ? notas.get(playerId) : null
        const gf = m.goals_for
        const ga = m.goals_against
        return {
          matchday: md?.jornada_number ?? null,
          date: md?.match_date ?? null,
          opponent: md ? clubNameById.get(md.opponent_club_id) || null : null,
          home: md?.is_home ?? null,
          goalsFor: gf,
          goalsAgainst: ga,
          result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
          rating: miNota != null ? round2(miNota) : null,
          goals: pms.goals || 0,
          assists: pms.assists || 0,
          yellowCards: pms.yellow_cards || 0,
          redCards: pms.red_cards || 0,
          mvp: mvpByMatch.get(m.id) === playerId,
        }
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 8)

    res.json({ evolution, lastMatches })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualiza los datos personales de un jugador (nombre, fecha de
// nacimiento, posición, teléfono). Solo el propio jugador o un entrenador.
app.put('/api/players/:id', requireSelfOrEntrenador(), async (req, res) => {
  const playerId = Number(req.params.id)
  const { name, birthDate, positionCode, phone } = req.body
  try {
    const updates = {}
    if (name !== undefined) updates.full_name = name
    if (birthDate !== undefined) updates.birth_date = birthDate || null
    if (phone !== undefined) updates.phone = normalizePhone(phone)
    if (positionCode !== undefined) {
      const { data: positionRow, error: posErr } = await supabase
        .from('positions')
        .select('id')
        .eq('short_code', positionCode)
        .maybeSingle()
      if (posErr) throw new Error(posErr.message)
      if (!positionRow) return res.status(400).json({ error: `Código de posición "${positionCode}" no reconocido.` })
      updates.position_id = positionRow.id
    }

    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', playerId)
      .select('id, full_name, birth_date, position_id, phone, photo_url')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return res.status(404).json({ error: 'Jugador no encontrado.' })

    res.json({
      id: data.id,
      name: data.full_name,
      birthDate: data.birth_date,
      phone: data.phone,
      photo: data.photo_url,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sube la foto de perfil a Supabase Storage (bucket "player-photos",
// público) y guarda la URL pública en players.photo_url. Va en base64 dentro
// del JSON en vez de multipart: así no hace falta montar un parser aparte
// (multer/busboy) en una API que hasta ahora es JSON puro de punta a punta.
app.post('/api/players/:id/photo', requireSelfOrEntrenador(), async (req, res) => {
  const playerId = Number(req.params.id)
  const { photoBase64, contentType } = req.body
  if (!photoBase64 || !contentType) {
    return res.status(400).json({ error: 'Falta la foto (photoBase64/contentType).' })
  }
  const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
  const ext = extByType[contentType]
  if (!ext) return res.status(400).json({ error: 'Formato de imagen no soportado (usa PNG, JPG o WEBP).' })

  try {
    const buffer = Buffer.from(photoBase64, 'base64')
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La foto pesa más de 5MB.' })
    }
    const path = `players/${playerId}-${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('player-photos')
      .upload(path, buffer, { contentType, upsert: false })
    if (uploadErr) throw new Error(uploadErr.message)

    const {
      data: { publicUrl },
    } = supabase.storage.from('player-photos').getPublicUrl(path)

    const { error: updErr } = await supabase.from('players').update({ photo_url: publicUrl }).eq('id', playerId)
    if (updErr) throw new Error(updErr.message)

    res.json({ photo: publicUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/register', async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Rellena todos los campos.' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' })
  }
  if (!['jugador', 'entrenador'].includes(role)) {
    return res.status(400).json({ error: 'Rol no válido.' })
  }
  const normalizedEmail = String(email).trim().toLowerCase()

  const { data: existing, error: existErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (existErr) return res.status(500).json({ error: existErr.message })
  if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' })

  // Vincula la cuenta con un jugador de la plantilla que se llame igual
  // (mismo criterio por nombre que usa server/migrate-to-supabase.mjs). Si
  // no hay coincidencia, player_id queda NULL y el frontend cae al
  // emparejado por nombre.
  const { data: matchingPlayer } = await supabase
    .from('players')
    .select('id, full_name')
    .ilike('full_name', name.trim())
    .maybeSingle()

  const { data: user, error: insertErr } = await supabase
    .from('users')
    .insert({
      email: normalizedEmail,
      password_hash: bcrypt.hashSync(password, 10),
      full_name: name,
      role,
      player_id: matchingPlayer?.id ?? null,
    })
    .select('id, email, full_name, role, player_id')
    .single()
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  res.status(201).json(publicUser(user))
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  const normalizedEmail = String(email || '').trim().toLowerCase()

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, player_id, password_hash')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!user || !bcrypt.compareSync(password, user.password_hash || '')) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
  }
  res.json(publicUser(user))
})

// Cambia la contraseña del propio usuario. Solo el propio usuario puede
// hacerlo (nunca un entrenador en su nombre) y hace falta acertar la
// contraseña actual — no hay sesión/token en esta app (solo X-User-Id por
// cabecera), así que sin esta comprobación cualquiera que supiera/adivinara
// el id de otro usuario podría cambiarle la contraseña llamando al endpoint
// directamente.
app.put('/api/users/:id/password', async (req, res) => {
  const userId = Number(req.params.id)
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Faltan la contraseña actual y la nueva.' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' })
  }
  const requesterId = Number(req.get('X-User-Id'))
  if (!requesterId || requesterId !== userId) {
    return res.status(403).json({ error: 'Solo puedes cambiar tu propia contraseña.' })
  }
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash || '')) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' })
    }
    const { error: updErr } = await supabase
      .from('users')
      .update({ password_hash: bcrypt.hashSync(newPassword, 10) })
      .eq('id', userId)
    if (updErr) throw new Error(updErr.message)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Todo lo relativo a "próximo partido configurado a mano" + su encuesta de
// WhatsApp vive ahora en matchdays.whatsapp_poll_id (columna) +
// app_state.active_matchday_id (el puntero al partido activo — sustituye al
// "registro con updatedAt más reciente" que antes se calculaba sobre
// server/db_convocatorias_aut.json) + call_ups (snapshot de votos, escrito
// solo al archivar un partido que deja de ser el activo).

async function getActiveMatchdayId() {
  const { data, error } = await supabase.from('app_state').select('active_matchday_id').eq('id', true).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.active_matchday_id ?? null
}

async function setActiveMatchdayId(matchdayId) {
  const { error } = await supabase.from('app_state').update({ active_matchday_id: matchdayId }).eq('id', true)
  if (error) throw new Error(error.message)
}

// opponent_club_id ya es "el rival" independientemente de is_home, así que
// no hace falta reconstruir equipo_local/visitante para esto.
function matchdayRivalDate(m, clubNameById) {
  return {
    rival: clubNameById.get(m.opponent_club_id) || '',
    date: m.match_date ? String(m.match_date).slice(0, 10) : '',
    // match_date es timestamp sin zona horaria: guarda hora real si se
    // configuró, si no queda a 00:00 (ver PUT /api/next-match).
    time: m.match_date ? String(m.match_date).slice(11, 16) : '',
  }
}

// date+time -> valor listo para match_date (timestamp sin zona horaria). Sin
// hora configurada, se guarda a medianoche (comportamiento previo).
function combinarFechaHora(date, time) {
  return date ? `${date}T${time || '00:00'}:00` : null
}

// 'YYYY-MM-DD' -> límites [desde, hasta) del día completo para filtrar
// match_date (timestamp sin zona horaria): desde las 00:00 de ese día hasta
// las 00:00 del siguiente. Devuelve null si la fecha no es válida.
function rangoDia(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const [y, mo, d] = fecha.split('-').map(Number)
  const inicio = new Date(Date.UTC(y, mo - 1, d))
  if (inicio.getUTCMonth() !== mo - 1 || inicio.getUTCDate() !== d) return null
  const siguiente = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10)
  return { desde: `${fecha}T00:00:00`, hasta: `${siguiente}T00:00:00` }
}

async function getMatchdayById(matchdayId) {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, opponent_club_id, match_date, whatsapp_poll_id, status, callup_status, callup_opened_at, callup_closed_at, callup_closed_by')
    .eq('id', matchdayId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// Crea una jornada nueva para un rival que no está en el calendario de la
// temporada (rival introducido a mano), con el siguiente jornada_number
// libre. Da de alta el club rival si tampoco existe en `clubs` todavía. No
// se conoce la localía de un partido "a mano", así que se asume local por
// defecto (el diseño anterior tampoco la guardaba para estos casos).
async function crearMatchdayAdHoc({ rival, date, time }) {
  const season = await getCurrentSeason()
  const { data: maxRow } = await supabase
    .from('matchdays')
    .select('jornada_number')
    .eq('season_id', season.id)
    .order('jornada_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextJornada = (maxRow?.jornada_number ?? 0) + 1

  let opponentClubId = null
  if (rival) {
    const { data: club } = await supabase.from('clubs').select('id').eq('name', rival).maybeSingle()
    opponentClubId = club?.id ?? null
    if (!opponentClubId) {
      const { data: nuevoClub, error } = await supabase
        .from('clubs')
        .insert({ name: rival, is_own: false })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      opponentClubId = nuevoClub.id
    }
  }

  const { data: competition } = await supabase.from('competitions').select('id').limit(1).maybeSingle()
  const { data: nueva, error } = await supabase
    .from('matchdays')
    .insert({
      season_id: season.id,
      competition_id: competition?.id ?? null,
      jornada_number: nextJornada,
      match_date: combinarFechaHora(date, time),
      opponent_club_id: opponentClubId,
      is_home: true,
      status: 'scheduled',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return nueva.id
}

// Resuelve qué matchday debe pasar a ser el activo. Orden de prioridad:
// 1) matchId explícito (lo manda PlantillaScreen cuando rival/fecha vienen
//    precargados de /api/next-match/auto o de la navegación por el
//    calendario — ver AlineacionScreen/PlantillaScreen), sin comparar texto.
// 2) si rival/fecha no han cambiado respecto al partido ya activo, se
//    conserva el mismo (igual que hacía mismoPartido() con el id sintético).
// 3) si coincide con una jornada real del calendario por texto, esa.
// 4) si no, se crea una jornada nueva ad-hoc.
async function resolverMatchdayActivo({ matchId, rival, date, time, actual }) {
  if (matchId != null) {
    const { data, error } = await supabase.from('matchdays').select('id').eq('id', matchId).maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data.id
  }

  if (actual && actual.rival === rival && actual.date === date) {
    return actual.id
  }

  const reconstruido = await fetchMatchdaysReconstructed()
  const encontrado = reconstruido.find((p) => p.fecha === date && (p.equipo_local === rival || p.equipo_visitante === rival))
  if (encontrado) return encontrado.id

  return crearMatchdayAdHoc({ rival, date, time })
}

app.get('/api/next-match', async (req, res) => {
  try {
    const activeId = await getActiveMatchdayId()
    if (!activeId) return res.json(null)
    const m = await getMatchdayById(activeId)
    if (!m) return res.json(null)
    const { rival, date, time } = matchdayRivalDate(m, await getClubNameById())
    res.json({ matchId: m.id, rival, date, time, whatsappPollId: m.whatsapp_poll_id || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/next-match', requireEntrenador(), async (req, res) => {
  try {
    const matchIdBody = req.body.matchId != null ? Number(req.body.matchId) : null
    // whatsappPollId del body se ignora a propósito: el id de la encuesta
    // solo lo escribe el servidor al generarla (POST /api/matchdays/:id/poll).
    // Aceptarlo desde el formulario permitía que una jornada heredara la
    // encuesta de otra.
    const { rival, date, time } = req.body
    const clubNameById = await getClubNameById()

    const activeId = await getActiveMatchdayId()
    let actual = null
    if (activeId) {
      const m = await getMatchdayById(activeId)
      if (m) actual = { id: m.id, whatsappPollId: m.whatsapp_poll_id, ...matchdayRivalDate(m, clubNameById) }
    }

    const rivalFinal = rival ?? actual?.rival ?? ''
    const dateFinal = date ?? actual?.date ?? ''
    const timeFinal = time ?? actual?.time ?? ''

    const matchdayId = await resolverMatchdayActivo({
      matchId: matchIdBody,
      rival: rivalFinal,
      date: dateFinal,
      time: timeFinal,
      actual,
    })

    // Cambiar de partido activo ya no copia votos a call_ups: call_ups solo
    // se escribe al guardar la convocatoria final (PUT
    // /api/matchdays/:id/convocatoria).

    // match_date también se actualiza aquí para una jornada ya existente del
    // calendario (no solo al crearla ad-hoc). whatsapp_poll_id no se toca:
    // cada jornada conserva la encuesta que tuviera (antes, al cambiar de
    // partido activo, se le ponía '' -> NULL y perdía la suya).
    if (dateFinal) {
      const { error: updErr } = await supabase
        .from('matchdays')
        .update({ match_date: combinarFechaHora(dateFinal, timeFinal) })
        .eq('id', matchdayId)
      if (updErr) throw new Error(updErr.message)
    }

    await setActiveMatchdayId(matchdayId)

    const final = await getMatchdayById(matchdayId)
    const { rival: rivalOut, date: dateOut, time: timeOut } = matchdayRivalDate(final, clubNameById)
    res.json({ matchId: final.id, rival: rivalOut, date: dateOut, time: timeOut, whatsappPollId: final.whatsapp_poll_id || '' })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code })
  }
})

// Historial de convocatorias finales (jornadas con callup_status =
// 'cerrada'), con la forma que ya espera AlineacionScreen/calculateAttendance:
// votes[phone] = 'Si' si el entrenador lo convocó (called), 'No' si no. El
// voto de WhatsApp (call_ups.vote) no se usa aquí: no cuenta para asistencia.
app.get('/api/convocatoria-history', async (req, res) => {
  try {
    const [{ data: callUps, error: cuErr }, { data: players, error: playersErr }, { data: matchdays, error: mdErr }] =
      await Promise.all([
        supabase.from('call_ups').select('matchday_id, player_id, called'),
        supabase.from('players').select('id, phone'),
        supabase
          .from('matchdays')
          .select('id, opponent_club_id, match_date, whatsapp_poll_id')
          .eq('callup_status', 'cerrada'),
      ])
    if (cuErr) throw new Error(cuErr.message)
    if (playersErr) throw new Error(playersErr.message)
    if (mdErr) throw new Error(mdErr.message)

    const phoneById = new Map(players.map((p) => [p.id, p.phone]))
    const matchdayById = new Map(matchdays.map((m) => [m.id, m]))
    const clubNameById = await getClubNameById()

    const porPartido = new Map()
    for (const cu of callUps) {
      if (!matchdayById.has(cu.matchday_id)) continue
      const phone = phoneById.get(cu.player_id)
      if (!phone) continue
      if (!porPartido.has(cu.matchday_id)) porPartido.set(cu.matchday_id, {})
      porPartido.get(cu.matchday_id)[phone] = cu.called ? 'Si' : 'No'
    }

    const historial = [...porPartido.entries()].map(([matchdayId, votes]) => {
      const m = matchdayById.get(matchdayId)
      const { rival, date } = m ? matchdayRivalDate(m, clubNameById) : { rival: '', date: '' }
      return {
        id: matchdayId,
        rival,
        date,
        whatsappPollId: m?.whatsapp_poll_id || '',
        votes,
        // No se guarda un timestamp de archivado separado (campo no leído
        // por ningún componente del frontend hoy, ver migration-diagnosis.md).
        archivedAt: null,
      }
    })
    res.json(historial)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Jugadores de la convocatoria final de una jornada concreta (call_ups.called
// = true, lo decide el entrenador). Lo usan MatchStatsPanel y la Alineación
// de StatsScreen para listar solo a los convocados.
app.get('/api/call-ups/:matchdayId', async (req, res) => {
  const matchdayId = Number(req.params.matchdayId)
  try {
    const { data, error } = await supabase
      .from('call_ups')
      .select('player_id')
      .eq('matchday_id', matchdayId)
      .eq('called', true)
    if (error) throw new Error(error.message)
    res.json({ playerIds: data.map((row) => row.player_id) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Genera de verdad la encuesta de WhatsApp (Sí/No/Duda) para la jornada
// :id — la que se está viendo en NextMatchCard, NO el partido activo — y
// guarda el id del mensaje en matchdays.whatsapp_poll_id (el campo que usan
// GET /api/next-match/poll y /api/convocatoria-por-fecha para consultar
// después los votos vía fetchPollVotes). Sustituye a POST
// /api/next-match/poll, que siempre generaba la encuesta del partido activo.
// Si la jornada ya tiene encuesta, exige { confirmarReemplazo: true } en el
// body: regenerarla deja inaccesibles los votos de la anterior. Con la
// convocatoria ya cerrada no se puede: hay que reabrirla antes. Deja la
// jornada en callup_status = 'inscripcion'.
app.post('/api/matchdays/:id/poll', requireEntrenador(), async (req, res) => {
  const matchdayId = Number(req.params.id)
  if (!Number.isInteger(matchdayId) || matchdayId <= 0) {
    return res.status(400).json({ error: 'Id de jornada no válido.', code: 'ID_INVALIDO' })
  }
  try {
    const { data: m, error } = await supabase
      .from('matchdays')
      .select('id, opponent_club_id, match_date, whatsapp_poll_id, status, callup_status')
      .eq('id', matchdayId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!m) return res.status(404).json({ error: 'Jornada no encontrada.', code: 'NO_ENCONTRADA' })
    if (m.status === 'played') {
      return res.status(409).json({ error: 'Este partido ya está jugado.', code: 'PARTIDO_JUGADO' })
    }
    if (m.callup_status === 'cerrada') {
      return res.status(409).json({
        error: 'La convocatoria final ya está cerrada. Reábrela antes de generar otra inscripción.',
        code: 'CONVOCATORIA_CERRADA',
      })
    }
    if (m.whatsapp_poll_id && req.body?.confirmarReemplazo !== true) {
      return res.status(409).json({ error: 'Esta jornada ya tiene una encuesta.', code: 'POLL_EXISTS' })
    }

    const { rival, date } = matchdayRivalDate(m, await getClubNameById())
    if (!rival) {
      return res.status(400).json({ error: 'Esta jornada no tiene rival configurado.', code: 'SIN_RIVAL' })
    }

    const titulo = `Convocatoria vs ${rival}${date ? ` (${date})` : ''} — ¿Vienes?`
    let messageId
    try {
      messageId = await createPollMessage({ title: titulo, options: ['Si', 'No', 'Duda'] })
    } catch (err) {
      return res.status(502).json({ error: err.message, code: 'WHAPI_ERROR' })
    }
    const { error: updErr } = await supabase
      .from('matchdays')
      .update({ whatsapp_poll_id: messageId, callup_status: 'inscripcion', callup_opened_at: new Date().toISOString() })
      .eq('id', matchdayId)
    if (updErr) throw new Error(updErr.message)

    res.json({ matchId: matchdayId, rival, date, whatsappPollId: messageId, status: 'inscripcion' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------- Convocatoria final (ver docs/plan-convocatoria-final.md) ----------
//
// Cada jornada tiene su convocatoria con callup_status:
//   sin_encuesta -> inscripcion (POST /api/matchdays/:id/poll) -> cerrada
//   (PUT /api/matchdays/:id/convocatoria) -> inscripcion otra vez (reabrir).
// call_ups solo se escribe al guardar la convocatoria final: called = lo que
// decide el entrenador (lo único que cuenta para asistencia), vote = voto de
// WhatsApp en ese momento (solo informativo).

const VOTOS_VALIDOS = new Set(['Si', 'No', 'Duda'])

function errorHttp(status, code, message) {
  const e = new Error(message)
  e.status = status
  e.code = code
  return e
}

// Votos de la encuesta de una jornada como {phone: 'Si'|'No'|'Duda'}. Si no se
// pueden leer, error 502 WHAPI_ERROR (quien llama no debe escribir nada).
async function leerVotosEncuesta(pollId) {
  try {
    return await fetchPollVotes(pollId)
  } catch (err) {
    throw errorHttp(502, 'WHAPI_ERROR', `No se pudieron leer los votos de la encuesta: ${err.message}`)
  }
}

async function getCallUpsDeJornada(matchdayId) {
  const { data, error } = await supabase.from('call_ups').select('player_id, called, vote').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return new Map(data.map((r) => [r.player_id, r]))
}

// Estado completo de la convocatoria de una jornada, para el panel:
// - sin_encuesta: nadie votado ni convocado.
// - inscripcion: votos en directo de Whapi; called es la propuesta — lo que
//   ya hubiera guardado el entrenador si se reabrió, si no, los que votaron Sí.
// - cerrada: todo sale de call_ups, sin llamar a Whapi.
async function construirConvocatoria(m) {
  const players = await fetchPlayersFromSupabase()
  const filas = m.callup_status === 'sin_encuesta' ? new Map() : await getCallUpsDeJornada(m.id)
  const votes = m.callup_status === 'inscripcion' ? await leerVotosEncuesta(m.whatsapp_poll_id) : null

  const jugadores = players.map((p) => {
    const fila = filas.get(p.id)
    let vote = null
    let called = false
    if (m.callup_status === 'inscripcion') {
      const v = p.phone ? votes[p.phone] : undefined
      vote = VOTOS_VALIDOS.has(v) ? v : null
      called = fila ? fila.called : vote === 'Si'
    } else if (m.callup_status === 'cerrada') {
      vote = fila?.vote ?? null
      called = fila?.called ?? false
    }
    return { playerId: p.id, name: p.name, number: p.number, phone: p.phone || '', vote, called }
  })

  return {
    matchId: m.id,
    status: m.callup_status,
    jugado: m.status === 'played',
    whatsappPollId: m.whatsapp_poll_id || '',
    openedAt: m.callup_opened_at,
    closedAt: m.callup_closed_at,
    closedBy: m.callup_closed_by,
    jugadores,
    jugadoresSinTelefono: players.filter((p) => !p.phone).map((p) => p.id),
  }
}

// "2026-10-11" -> "domingo 11 de octubre"
function fechaLarga(date) {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function mensajeConvocatoria({ rival, date, time }, convocados) {
  const hora = time && time !== '00:00' ? ` ${time}` : ''
  const lineas = convocados.map((p, i) => `${i + 1}. ${p.name}${p.number ? ` (${p.number})` : ''}`)
  return [
    `Convocatoria vs ${rival || 'rival por confirmar'} — ${fechaLarga(date)}${hora}`.trim(),
    ...lineas,
    `Total: ${convocados.length} convocados`,
  ].join('\n')
}

function matchdayIdDeParams(req) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw errorHttp(400, 'ID_INVALIDO', 'Id de jornada no válido.')
  return id
}

function responderError(res, err) {
  res.status(err.status || 500).json({ error: err.message, code: err.code })
}

app.get('/api/matchdays/:id/convocatoria', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const m = await getMatchdayById(matchdayIdDeParams(req))
    if (!m) throw errorHttp(404, 'NO_ENCONTRADA', 'Jornada no encontrada.')
    res.json(await construirConvocatoria(m))
  } catch (err) {
    responderError(res, err)
  }
})

// Guarda (o edita) la convocatoria final y la deja cerrada. Body:
// { convocados: [playerId], enviarAlGrupo?: bool, confirmarEdicionJugado?: bool }.
// Escribe una fila por jugador de la plantilla (called + vote). Si falla la
// lectura de votos no escribe nada; si falla el envío al grupo, la
// convocatoria queda guardada igualmente y se devuelve `aviso`.
app.put('/api/matchdays/:id/convocatoria', requireEntrenador(), async (req, res) => {
  try {
    const matchdayId = matchdayIdDeParams(req)
    const { convocados, enviarAlGrupo = false, confirmarEdicionJugado = false } = req.body || {}
    if (!Array.isArray(convocados) || !convocados.every((id) => Number.isInteger(id))) {
      throw errorHttp(400, 'IDS_INVALIDOS', 'convocados debe ser una lista de ids de jugador.')
    }

    const m = await getMatchdayById(matchdayId)
    if (!m) throw errorHttp(404, 'NO_ENCONTRADA', 'Jornada no encontrada.')
    if (m.callup_status === 'sin_encuesta') {
      throw errorHttp(409, 'SIN_ENCUESTA', 'Primero genera la inscripción de esta jornada.')
    }
    if (m.status === 'played' && confirmarEdicionJugado !== true) {
      throw errorHttp(409, 'PARTIDO_JUGADO', 'Este partido ya está jugado.')
    }

    const players = await fetchPlayersFromSupabase()
    const idsPlantilla = new Set(players.map((p) => p.id))
    const desconocidos = convocados.filter((id) => !idsPlantilla.has(id))
    if (desconocidos.length > 0) {
      throw errorHttp(400, 'IDS_INVALIDOS', `Jugadores no encontrados: ${desconocidos.join(', ')}.`)
    }

    // Votos: en inscripción se leen de Whapi (si falla, 502 y nada escrito);
    // al editar una ya cerrada se conservan los guardados.
    let voteDe
    if (m.callup_status === 'inscripcion') {
      const votes = await leerVotosEncuesta(m.whatsapp_poll_id)
      voteDe = (p) => {
        const v = p.phone ? votes[p.phone] : undefined
        return VOTOS_VALIDOS.has(v) ? v : null
      }
    } else {
      const filas = await getCallUpsDeJornada(matchdayId)
      voteDe = (p) => filas.get(p.id)?.vote ?? null
    }

    const ahora = new Date().toISOString()
    const seleccion = new Set(convocados)
    const rows = players.map((p) => ({
      matchday_id: matchdayId,
      player_id: p.id,
      called: seleccion.has(p.id),
      vote: voteDe(p),
      attended: null,
      role_in_squad: null,
      updated_at: ahora,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from('call_ups').upsert(rows, { onConflict: 'matchday_id,player_id' })
      if (error) throw new Error(error.message)
    }

    const { error: updErr } = await supabase
      .from('matchdays')
      .update({ callup_status: 'cerrada', callup_closed_at: ahora, callup_closed_by: Number(req.get('X-User-Id')) })
      .eq('id', matchdayId)
    if (updErr) throw new Error(updErr.message)

    let aviso
    if (enviarAlGrupo === true) {
      const datos = matchdayRivalDate(m, await getClubNameById())
      const lista = players.filter((p) => seleccion.has(p.id)).sort((a, b) => (a.number || 0) - (b.number || 0))
      try {
        await sendTextMessage({ body: mensajeConvocatoria(datos, lista) })
      } catch (err) {
        aviso = `La convocatoria se ha guardado, pero no se pudo enviar la lista al grupo: ${err.message}`
      }
    }

    // Ya cerrada: construirConvocatoria lee de call_ups, sin volver a Whapi.
    const final = await getMatchdayById(matchdayId)
    res.json({ ...(await construirConvocatoria(final)), ...(aviso ? { aviso } : {}) })
  } catch (err) {
    responderError(res, err)
  }
})

// Vuelve a abrir la inscripción sin borrar call_ups: al volver a abrir el
// panel se propone lo que ya había guardado el entrenador. No se permite con
// el partido jugado (ahí se edita directamente la convocatoria cerrada).
// Responde solo el estado nuevo: el panel vuelve a pedir el GET, y así un
// fallo de Whapi al leer votos no se confunde con un fallo al reabrir.
app.put('/api/matchdays/:id/convocatoria/reabrir', requireEntrenador(), async (req, res) => {
  try {
    const matchdayId = matchdayIdDeParams(req)
    const m = await getMatchdayById(matchdayId)
    if (!m) throw errorHttp(404, 'NO_ENCONTRADA', 'Jornada no encontrada.')
    if (m.callup_status !== 'cerrada') throw errorHttp(409, 'NO_CERRADA', 'La convocatoria no está cerrada.')
    if (m.status === 'played') {
      throw errorHttp(409, 'PARTIDO_JUGADO', 'El partido ya está jugado: edita la convocatoria en lugar de reabrirla.')
    }
    const { error } = await supabase
      .from('matchdays')
      .update({ callup_status: 'inscripcion', callup_closed_at: null, callup_closed_by: null })
      .eq('id', matchdayId)
    if (error) throw new Error(error.message)
    res.json({ matchId: matchdayId, status: 'inscripcion' })
  } catch (err) {
    responderError(res, err)
  }
})

// Consulta en tiempo real (sin caché) el estado de la encuesta de WhatsApp
// asociada a la convocatoria activa.
app.get('/api/next-match/poll', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const activeId = await getActiveMatchdayId()
    if (!activeId) return res.json({ pollConfigured: false, votes: {} })
    const m = await getMatchdayById(activeId)
    const pollId = m?.whatsapp_poll_id
    // Sin encuesta real y sin modo mock, no hay nada que consultar — se
    // corta aquí para no convertir "todavía no configurada" en un error.
    // Con el mock activo se sigue adelante aunque no haya pollId: lo
    // resuelve fetchPollVotes internamente.
    if (!pollId && !isMockVotesActive()) return res.json({ pollConfigured: false, votes: {} })

    const votes = await fetchPollVotes(pollId)
    res.json({ pollConfigured: true, votes })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Clave de comparación heredada del simulador (igual que OUR_TEAM en
// src/data/league.js): matchdays.opponent_club_id apunta al rival, así que
// "nuestro" lado hay que reponerlo con este literal en vez del nombre
// amigable de clubs.name (que para el club propio es "Huevos FC", no esto).
const OUR_TEAM = 'LOS HUEVOS FC'

async function getClubNameById() {
  const { data, error } = await supabase.from('clubs').select('id, name, is_own')
  if (error) throw new Error(error.message)
  return new Map(data.map((c) => [c.id, c.is_own ? OUR_TEAM : c.name]))
}

// Reconstruye la forma de 2_calendario.json ({id, jornada, fecha,
// equipo_local, equipo_visitante, resultado, ganador, jugado}) a partir de
// una fila de matchdays. resultado/ganador se quedan siempre en null: en el
// JSON original tampoco se llegaron a rellenar nunca (ver
// migration-diagnosis.md, §4) y ningún componente del frontend los lee.
function reconstruirPartidoCalendario(m, clubNameById) {
  const rivalName = clubNameById.get(m.opponent_club_id) || null
  return {
    id: m.id,
    jornada: m.jornada_number,
    fecha: m.match_date ? String(m.match_date).slice(0, 10) : null,
    hora: m.match_date ? String(m.match_date).slice(11, 16) : null,
    equipo_local: m.is_home ? OUR_TEAM : rivalName,
    equipo_visitante: m.is_home ? rivalName : OUR_TEAM,
    resultado: null,
    ganador: null,
    jugado: m.status === 'played',
  }
}

async function fetchMatchdaysReconstructed() {
  const [mdRes, clubNameById] = await Promise.all([
    supabase
      .from('matchdays')
      .select('id, jornada_number, match_date, opponent_club_id, is_home, status')
      .order('jornada_number'),
    getClubNameById(),
  ])
  if (mdRes.error) throw new Error(mdRes.error.message)
  return mdRes.data.map((m) => reconstruirPartidoCalendario(m, clubNameById))
}

// Calendario completo de la temporada (todas las jornadas, jugadas o no),
// para el filtro de fecha de Plantilla. Solo lectura.
app.get('/api/calendario', async (req, res) => {
  try {
    res.json(await fetchMatchdaysReconstructed())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Próximo partido calculado automáticamente a partir de matchdays: el
// primero (por fecha) cuya fecha sea hoy o futura; si ya han pasado todas
// las fechas, se muestra la última. matchdays ya son solo nuestros partidos
// (igual que 2_calendario.json), así que no hace falta filtrar por equipo.
// El campo "jugado" NO se tiene en cuenta aquí (ver NextMatchCard, que
// permite navegar manualmente por todas las jornadas independientemente de
// ese campo). A diferencia de GET /api/next-match (que devuelve lo que el
// entrenador haya guardado a mano), este no requiere configurar nada.
app.get('/api/next-match/auto', async (req, res) => {
  try {
    const nuestros = (await fetchMatchdaysReconstructed()).sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const siguiente = nuestros.find((p) => new Date(p.fecha) >= hoy) || nuestros[nuestros.length - 1]
    if (!siguiente) {
      return res.json(null)
    }

    const esLocal = siguiente.equipo_local === OUR_TEAM
    res.json({
      matchId: siguiente.id,
      jornada: siguiente.jornada,
      rival: esLocal ? siguiente.equipo_visitante : siguiente.equipo_local,
      date: siguiente.fecha,
      time: siguiente.hora,
      esLocal,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Marca un partido como jugado, para que /api/next-match/auto avance al
// siguiente y el banner de "próximo partido" deje de mostrar uno que el
// entrenador ya ha dado por disputado. Ya no copia votos a call_ups: los
// convocados salen de la convocatoria final. Por eso exige que esté
// cerrada (409 CONVOCATORIA_NO_CERRADA), salvo con { forzar: true } en el
// body — entonces el partido queda jugado sin convocados hasta que el
// entrenador guarde su convocatoria final.
app.put('/api/calendario/:matchId/jugado', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  try {
    const actual = await getMatchdayById(matchId)
    if (!actual) return res.status(404).json({ error: 'Partido no encontrado en el calendario.' })
    if (actual.callup_status !== 'cerrada' && req.body?.forzar !== true) {
      return res.status(409).json({
        error: 'La convocatoria final de este partido no está cerrada.',
        code: 'CONVOCATORIA_NO_CERRADA',
      })
    }
    const { data, error } = await supabase
      .from('matchdays')
      .update({ status: 'played' })
      .eq('id', matchId)
      .select('id, jornada_number, match_date, opponent_club_id, is_home, status')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return res.status(404).json({ error: 'Partido no encontrado en el calendario.' })
    res.json(reconstruirPartidoCalendario(data, await getClubNameById()))
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code })
  }
})

// Deshace lo anterior: vuelve a dejar el partido como "scheduled" (el
// estado con el que nace toda jornada, ver crearMatchdayAdHoc), por si el
// entrenador lo marcó como jugado por error o quiere reabrirlo para
// retocar convocatoria/alineación antes de darlo por bueno otra vez. No
// intenta desarchivar los votos de la encuesta: son un archivo histórico,
// no un estado que haya que revertir aquí.
app.put('/api/calendario/:matchId/no-jugado', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  const { data, error } = await supabase
    .from('matchdays')
    .update({ status: 'scheduled' })
    .eq('id', matchId)
    .select('id, jornada_number, match_date, opponent_club_id, is_home, status')
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Partido no encontrado en el calendario.' })
  res.json(reconstruirPartidoCalendario(data, await getClubNameById()))
})

// Votos de convocatoria para una fecha concreta del calendario (no
// necesariamente la activa), para el filtro histórico de AlineacionScreen.
app.get('/api/convocatoria-por-fecha', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const fecha = req.query.fecha
  if (!fecha) {
    return res.status(400).json({ error: 'Falta el parámetro fecha.' })
  }
  const dia = rangoDia(fecha)
  if (!dia) {
    return res.status(400).json({ error: 'El parámetro fecha debe tener formato YYYY-MM-DD.' })
  }

  try {
    // match_date lleva hora, así que se filtra por el día completo en vez de
    // igualdad exacta. Si hubiera dos jornadas el mismo día, se toma la
    // primera en lugar de fallar.
    const { data: m, error } = await supabase
      .from('matchdays')
      .select('whatsapp_poll_id')
      .gte('match_date', dia.desde)
      .lt('match_date', dia.hasta)
      .order('match_date', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const pollId = m?.whatsapp_poll_id
    // Ver comentario equivalente en GET /api/next-match/poll. hasPoll dice si
    // la jornada tiene encuesta real (pollConfigured también es true con el
    // mock activo); lo usa PlantillaScreen para "Generar"/"Regenerar".
    const hasPoll = Boolean(pollId)
    if (!pollId && !isMockVotesActive()) {
      return res.json({ pollConfigured: false, hasPoll, votes: {} })
    }
    const votes = await fetchPollVotes(pollId)
    res.json({ pollConfigured: true, hasPoll, votes })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Datos de la liga completa (los N equipos, no solo Los Huevos FC), a
// partir de league_fixtures. Solo lectura.
app.get('/api/league', async (req, res) => {
  try {
    const [season, clubsRes, fixturesRes, matchdaysCount] = await Promise.all([
      getCurrentSeason(),
      supabase.from('clubs').select('id, name, is_own'),
      supabase.from('league_fixtures').select('jornada_number, match_date, home_club_id, away_club_id, goals_home, goals_away'),
      supabase.from('matchdays').select('id', { count: 'exact', head: true }),
    ])
    if (clubsRes.error) throw new Error(clubsRes.error.message)
    if (fixturesRes.error) throw new Error(fixturesRes.error.message)
    if (matchdaysCount.error) throw new Error(matchdaysCount.error.message)

    const clubNameById = new Map(clubsRes.data.map((c) => [c.id, c.is_own ? OUR_TEAM : c.name]))
    const equipos = clubsRes.data.map((c) => (c.is_own ? OUR_TEAM : c.name))

    const partidos = fixturesRes.data
      .filter((f) => f.goals_home != null && f.goals_away != null)
      .map((f) => ({
        jornada: f.jornada_number,
        fecha: f.match_date ? String(f.match_date).slice(0, 10) : null,
        equipo_local: clubNameById.get(f.home_club_id) || null,
        equipo_visitante: clubNameById.get(f.away_club_id) || null,
        resultado: { goles_local: f.goals_home, goles_visitante: f.goals_away },
        jugado: true,
      }))

    const jornadasSimuladas = partidos.reduce((max, p) => Math.max(max, p.jornada), 0)

    res.json({
      temporada: season.name,
      total_jornadas: matchdaysCount.count ?? 0,
      equipos,
      partidos,
      jornadas_simuladas: jornadasSimuladas,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Estadísticas de jugador (goles, asistencias, tarjetas, minutos) agregadas
// a partir de player_match_stats. Solo lectura.
app.get('/api/player-match-stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('player_match_stats')
      .select('player_id, minutes_played, goals, assists, yellow_cards, red_cards')
    if (error) throw new Error(error.message)

    const stats = {}
    for (const row of data) {
      const s = stats[row.player_id] || {
        partidosJugados: 0,
        minutosJugados: 0,
        goles: 0,
        asistencias: 0,
        tarjetasAmarillas: 0,
        tarjetasRojas: 0,
      }
      s.partidosJugados += 1
      s.minutosJugados += row.minutes_played || 0
      s.goles += row.goals || 0
      s.asistencias += row.assists || 0
      s.tarjetasAmarillas += row.yellow_cards || 0
      s.tarjetasRojas += row.red_cards || 0
      stats[row.player_id] = s
    }
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Ranking de toda la plantilla de una temporada (la activa por defecto, o
// ?season=<id>) para TeamRankingCard en StatsScreen: una fila por jugador
// activo del roster de esa temporada con goles, asistencias, % de
// convocatorias asistidas, MVPs y valoración media (media de los 4 atributos
// valorables; null si el jugador aún no tiene votos). Ordena por valoración
// desc, los null al final. Solo lectura.
app.get('/api/stats/ranking', async (req, res) => {
  try {
    const season = req.query.season ? { id: Number(req.query.season) } : await getCurrentSeason()

    const [rosterRes, statsRes, matchdayIds, playedMatchdayIds] = await Promise.all([
      supabase.from('player_season_roster').select('player_id').eq('season_id', season.id),
      supabase
        .from('season_player_stats')
        .select('player_id, total_goals, total_assists, avg_impacto, avg_esfuerzo, avg_equipo, avg_liderazgo')
        .eq('season_id', season.id),
      getSeasonMatchdayIds(season.id),
      getPlayedMatchdayIds(season.id),
    ])
    if (rosterRes.error) throw new Error(rosterRes.error.message)
    if (statsRes.error) throw new Error(statsRes.error.message)

    const rosterIds = rosterRes.data.map((r) => r.player_id)
    if (rosterIds.length === 0) return res.json([])

    const [{ data: players, error: playersErr }, mvpsPorJugador, asistenciasPorJugador] = await Promise.all([
      supabase.from('players').select('id, full_name, photo_url').in('id', rosterIds).eq('active', true),
      contarMvpsPorJugador(matchdayIds),
      contarAsistenciasPorJugador(playedMatchdayIds),
    ])
    if (playersErr) throw new Error(playersErr.message)

    const statsById = new Map(statsRes.data.map((s) => [s.player_id, s]))

    // % de asistencia sobre las jornadas jugadas por el equipo (igual criterio
    // que /api/players/:id/profile). null solo si el equipo no ha jugado aún.
    const attendancePctDe = (playerId) =>
      playedMatchdayIds.length > 0
        ? Math.round(((asistenciasPorJugador.get(playerId) || 0) / playedMatchdayIds.length) * 100)
        : null

    const rows = players.map((p) => {
      const s = statsById.get(p.id)
      const rating =
        s && s.avg_impacto != null
          ? Math.round(
              ((Number(s.avg_impacto) + Number(s.avg_esfuerzo) + Number(s.avg_equipo) + Number(s.avg_liderazgo)) / 4) * 100
            ) / 100
          : null
      return {
        id: p.id,
        name: p.full_name,
        photo: p.photo_url,
        goals: Number(s?.total_goals ?? 0),
        assists: Number(s?.total_assists ?? 0),
        attendancePct: attendancePctDe(p.id),
        mvps: mvpsPorJugador.get(p.id) ?? 0,
        rating,
      }
    })

    rows.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Reconstruye la forma de simulador/estadisticas_personales.json ({id,
// jugado, jornada, rival, fecha, esLocal, resultado, jugadores: [...]}) a
// partir de matches + matchdays + player_match_stats + players. Cada
// jugadores[] lleva una copia de los datos del jugador (igual que antes),
// resuelta en el momento de leer, no denormalizada al guardar.
async function fetchEstadisticasPersonalesFromSupabase() {
  const [matchesRes, pmsRes, matchdaysRes] = await Promise.all([
    supabase.from('matches').select('id, matchday_id, goals_for, goals_against'),
    supabase.from('player_match_stats').select('match_id, player_id, goals, assists, yellow_cards, red_cards'),
    supabase.from('matchdays').select('id, jornada_number, match_date, opponent_club_id, is_home'),
  ])
  if (matchesRes.error) throw new Error(matchesRes.error.message)
  if (pmsRes.error) throw new Error(pmsRes.error.message)
  if (matchdaysRes.error) throw new Error(matchdaysRes.error.message)

  const [players, clubNameById] = await Promise.all([fetchPlayersFromSupabase(), getClubNameById()])
  const playerById = new Map(players.map((p) => [p.id, p]))
  const matchdayById = new Map(matchdaysRes.data.map((m) => [m.id, m]))

  const pmsByMatchId = new Map()
  for (const row of pmsRes.data) {
    if (!pmsByMatchId.has(row.match_id)) pmsByMatchId.set(row.match_id, [])
    pmsByMatchId.get(row.match_id).push(row)
  }

  return matchesRes.data.map((match) => {
    const md = matchdayById.get(match.matchday_id)
    const jugadores = (pmsByMatchId.get(match.id) || []).map((row) => {
      const base = playerById.get(row.player_id) || {
        id: row.player_id,
        name: '',
        positions: [],
        number: 0,
        phone: null,
        photo: null,
      }
      return {
        ...base,
        goles: row.goals || 0,
        asistencias: row.assists || 0,
        amarillas: row.yellow_cards || 0,
        tarjetaAmarilla: (row.yellow_cards || 0) > 0,
        tarjetaRoja: !!row.red_cards,
      }
    })
    return {
      id: match.matchday_id,
      jugado: true,
      jornada: md?.jornada_number ?? null,
      rival: md ? clubNameById.get(md.opponent_club_id) || null : null,
      fecha: md?.match_date ? String(md.match_date).slice(0, 10) : null,
      esLocal: md?.is_home ?? null,
      resultado: { golesNosotros: match.goals_for, golesRival: match.goals_against },
      jugadores,
    }
  })
}

// Detalle jugador a jugador de cada partido con estadísticas personales
// registradas. Solo lectura; lo usa MatchStatsPanel para precargar lo ya
// guardado de un partido concreto antes de editar.
app.get('/api/estadisticas-personales', async (req, res) => {
  try {
    res.json(await fetchEstadisticasPersonalesFromSupabase())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Asegura que existe una fila en `matches` para esta jornada (necesaria
// como FK de player_match_stats), sin pisar un resultado ya guardado.
async function asegurarMatch(matchdayId) {
  const { data: existente, error: selErr } = await supabase
    .from('matches')
    .select('id')
    .eq('matchday_id', matchdayId)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)
  if (existente) return existente.id

  const { data: nuevo, error: insErr } = await supabase
    .from('matches')
    .insert({ matchday_id: matchdayId, source: 'manual' })
    .select('id')
    .single()
  if (insErr) throw new Error(insErr.message)
  return nuevo.id
}

// Guarda (sustituye) las estadísticas personales de un partido:
// goles/asistencias/amarillas/roja por jugador, tal como las introduce el
// entrenador en MatchStatsPanel. Solo se guardan los jugadores con algo que
// reportar (si un jugador se deja a 0 en todo, desaparece de la lista del
// partido en vez de quedar como una fila vacía).
app.put('/api/estadisticas-personales/:matchId', requireEntrenador(), async (req, res) => {
  const matchdayId = Number(req.params.matchId)
  const { jugadores } = req.body
  if (!Array.isArray(jugadores)) {
    return res.status(400).json({ error: 'Falta la lista de jugadores.' })
  }
  try {
    const matchId = await asegurarMatch(matchdayId)

    const players = await fetchPlayersFromSupabase()
    const knownPlayerIds = new Set(players.map((p) => p.id))

    const { error: delErr } = await supabase.from('player_match_stats').delete().eq('match_id', matchId)
    if (delErr) throw new Error(delErr.message)

    const rows = []
    for (const j of jugadores) {
      const playerId = Number(j.playerId)
      if (!knownPlayerIds.has(playerId)) continue
      const amarillas = Math.min(2, Math.max(0, Number(j.amarillas) || 0))
      rows.push({
        match_id: matchId,
        player_id: playerId,
        goals: Math.max(0, Number(j.goles) || 0),
        assists: Math.max(0, Number(j.asistencias) || 0),
        yellow_cards: amarillas,
        red_cards: j.roja ? 1 : 0,
      })
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('player_match_stats').insert(rows)
      if (insErr) throw new Error(insErr.message)
    }

    const estadisticas = await fetchEstadisticasPersonalesFromSupabase()
    res.json(estadisticas.find((e) => e.id === matchdayId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Guarda el resultado final (goles a favor / en contra) de un partido, en
// `matches` (source='manual' — manda siempre sobre un resultado simulado
// que hubiera para esa misma jornada). Deliberadamente independiente de
// league_fixtures (la simulación de la clasificación de Marcador): este
// marcador lo anota el entrenador a mano y no debe alterar esa simulación.
app.put('/api/estadisticas-personales/:matchId/resultado', requireEntrenador(), async (req, res) => {
  const matchdayId = Number(req.params.matchId)
  const golesNosotros = Math.max(0, Number(req.body.golesNosotros) || 0)
  const golesRival = Math.max(0, Number(req.body.golesRival) || 0)

  try {
    const { error } = await supabase
      .from('matches')
      .upsert(
        { matchday_id: matchdayId, goals_for: golesNosotros, goals_against: golesRival, source: 'manual' },
        { onConflict: 'matchday_id' }
      )
    if (error) throw new Error(error.message)

    const estadisticas = await fetchEstadisticasPersonalesFromSupabase()
    res.json(estadisticas.find((e) => e.id === matchdayId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Valoraciones de jugador tras un partido jugado: 4 criterios independientes
// (impacto, esfuerzo, equipo, liderazgo), cada uno 1..5, más el voto de MVP
// del partido (un jugador por votante). Cualquier usuario identificado puede
// valorar (no solo el entrenador); cada uno guarda su propia fila por
// jugador y partido (UNIQUE match_id, player_id, rater_user_id) y su propio
// voto de MVP (UNIQUE match_id, rater_user_id). :matchId es el id de
// matchday; se resuelve/crea su fila en `matches` con el mismo helper que
// las estadísticas.
const CRITERIOS_RATING = ['impacto', 'esfuerzo', 'equipo', 'liderazgo']

async function getUserByHeader(req) {
  const userId = Number(req.get('X-User-Id'))
  if (!userId) return null
  const { data, error } = await supabase
    .from('users')
    .select('id, role, player_id')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

// Entero 1..5, o null si el criterio no se puntuó / no es válido.
function criterioValido(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

function normalizarRatingRow(r) {
  return {
    impacto: r.impacto ?? 0,
    esfuerzo: r.esfuerzo ?? 0,
    equipo: r.equipo ?? 0,
    liderazgo: r.liderazgo ?? 0,
  }
}

// Valoraciones + MVP que ya puso ESTE usuario para el partido.
app.get('/api/player-ratings/:matchId', async (req, res) => {
  const matchdayId = Number(req.params.matchId)
  try {
    const user = await getUserByHeader(req)
    if (!user) return res.status(401).json({ error: 'Falta identificar al usuario (X-User-Id).' })

    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .select('id')
      .eq('matchday_id', matchdayId)
      .maybeSingle()
    if (matchErr) throw new Error(matchErr.message)
    if (!match) return res.json({ ratings: {}, mvpPlayerId: null })

    const [rowsRes, mvpRes] = await Promise.all([
      supabase
        .from('player_ratings')
        .select('player_id, impacto, esfuerzo, equipo, liderazgo')
        .eq('match_id', match.id)
        .eq('rater_user_id', user.id),
      supabase
        .from('match_mvp_votes')
        .select('player_id')
        .eq('match_id', match.id)
        .eq('rater_user_id', user.id)
        .maybeSingle(),
    ])
    if (rowsRes.error) throw new Error(rowsRes.error.message)
    if (mvpRes.error) throw new Error(mvpRes.error.message)

    const ratings = {}
    for (const r of rowsRes.data) ratings[r.player_id] = normalizarRatingRow(r)
    res.json({ ratings, mvpPlayerId: mvpRes.data?.player_id ?? null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Guarda (sustituye) las valoraciones + MVP de este usuario para el partido.
// Body: { ratings: [{ playerId, impacto, esfuerzo, equipo, liderazgo }], mvpPlayerId }.
// Un criterio fuera de 1..5 se guarda como NULL; si un jugador queda con los
// 4 criterios a NULL se borra su fila. Un jugador no puede valorarse ni
// votarse MVP a sí mismo.
app.post('/api/player-ratings/:matchId', async (req, res) => {
  const matchdayId = Number(req.params.matchId)
  const { ratings, mvpPlayerId } = req.body
  if (!Array.isArray(ratings)) {
    return res.status(400).json({ error: 'Falta la lista de valoraciones.' })
  }
  try {
    const user = await getUserByHeader(req)
    if (!user) return res.status(401).json({ error: 'Falta identificar al usuario (X-User-Id).' })

    const matchId = await asegurarMatch(matchdayId)
    const players = await fetchPlayersFromSupabase()
    const knownPlayerIds = new Set(players.map((p) => p.id))
    const ratedBy = user.role === 'entrenador' ? 'entrenador' : 'companeros'
    const esUnoMismo = (playerId) => user.player_id && playerId === user.player_id

    const rows = []
    const toDelete = []
    for (const r of ratings) {
      const playerId = Number(r.playerId)
      if (!knownPlayerIds.has(playerId) || esUnoMismo(playerId)) continue
      const valores = {}
      let alguno = false
      for (const c of CRITERIOS_RATING) {
        const v = criterioValido(r[c])
        valores[c] = v
        if (v !== null) alguno = true
      }
      if (alguno) {
        rows.push({ match_id: matchId, player_id: playerId, rater_user_id: user.id, rated_by: ratedBy, ...valores })
      } else {
        // sin ningún criterio puntuado = el usuario ha borrado su valoración
        toDelete.push(playerId)
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from('player_ratings')
        .upsert(rows, { onConflict: 'match_id,player_id,rater_user_id' })
      if (error) throw new Error(error.message)
    }
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from('player_ratings')
        .delete()
        .eq('match_id', matchId)
        .eq('rater_user_id', user.id)
        .in('player_id', toDelete)
      if (error) throw new Error(error.message)
    }

    // MVP: jugador conocido y distinto de uno mismo => upsert; en cualquier
    // otro caso (null, inválido) se borra el voto de MVP de este usuario.
    const mvpId = Number(mvpPlayerId)
    if (knownPlayerIds.has(mvpId) && !esUnoMismo(mvpId)) {
      const { error } = await supabase
        .from('match_mvp_votes')
        .upsert(
          { match_id: matchId, rater_user_id: user.id, player_id: mvpId },
          { onConflict: 'match_id,rater_user_id' }
        )
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase
        .from('match_mvp_votes')
        .delete()
        .eq('match_id', matchId)
        .eq('rater_user_id', user.id)
      if (error) throw new Error(error.message)
    }

    const [savedRes, savedMvpRes] = await Promise.all([
      supabase
        .from('player_ratings')
        .select('player_id, impacto, esfuerzo, equipo, liderazgo')
        .eq('match_id', matchId)
        .eq('rater_user_id', user.id),
      supabase
        .from('match_mvp_votes')
        .select('player_id')
        .eq('match_id', matchId)
        .eq('rater_user_id', user.id)
        .maybeSingle(),
    ])
    if (savedRes.error) throw new Error(savedRes.error.message)
    if (savedMvpRes.error) throw new Error(savedMvpRes.error.message)

    const savedRatings = {}
    for (const r of savedRes.data) savedRatings[r.player_id] = normalizarRatingRow(r)
    res.json({ ok: true, ratings: savedRatings, mvpPlayerId: savedMvpRes.data?.player_id ?? null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/club', async (req, res) => {
  const { data, error } = await supabase.from('clubs').select('name').eq('is_own', true).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || { name: '' })
})

app.put('/api/club', requireEntrenador(), async (req, res) => {
  const { name } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre del club no puede estar vacío.' })
  }
  const { data, error } = await supabase
    .from('clubs')
    .update({ name: String(name).trim() })
    .eq('is_own', true)
    .select('name')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT} (Supabase: ${process.env.SUPABASE_URL})`)
})


