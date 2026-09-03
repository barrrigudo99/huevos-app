import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import ws from 'ws'
import {
  createPollMessage,
  fetchPollVotes,
  isMockVotesActive,
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

// Orígenes permitidos para llamar a esta API: el frontend en Vercel, el
// Vite dev server local, y cualquier subdominio de trycloudflare.com (la
// URL del túnel de Cloudflare cambia cada vez que se reinicia, así que se
// permite por regex en lugar de fijar una URL concreta).
app.use(
  cors({
    origin: [
      'https://huevos-app-three.vercel.app',
      'http://localhost:5173',
      /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/,
    ],
  })
)
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

// Cuenta en cuántos partidos de `matchdayIds` fue `playerId` el más votado en
// match_mvp_votes. Si dos o más jugadores empatan a más votos en un partido,
// ese partido no cuenta como MVP para nadie (decisión de producto: no hay un
// criterio de desempate no arbitrario entre compañeros).
async function contarMvpsGanados(matchdayIds, playerId) {
  if (matchdayIds.length === 0) return 0
  const { data: matches, error: matchesErr } = await supabase.from('matches').select('id').in('matchday_id', matchdayIds)
  if (matchesErr) throw new Error(matchesErr.message)
  const matchIds = matches.map((m) => m.id)
  if (matchIds.length === 0) return 0

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

  let count = 0
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
    if (ganadores.length === 1 && ganadores[0] === playerId) count++
  }
  return count
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

    const matchdayIds = await getSeasonMatchdayIds(season.id)

    const [{ data: statsRow, error: statsErr }, { data: callUps, error: callUpsErr }] = await Promise.all([
      supabase
        .from('season_player_stats')
        .select(
          'matches_played, total_goals, total_assists, total_yellow_cards, total_red_cards, avg_esfuerzo, avg_equipo, avg_liderazgo, avg_impacto'
        )
        .eq('player_id', playerId)
        .eq('season_id', season.id)
        .maybeSingle(),
      matchdayIds.length > 0
        ? supabase.from('call_ups').select('attended').eq('player_id', playerId).in('matchday_id', matchdayIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (statsErr) throw new Error(statsErr.message)
    if (callUpsErr) throw new Error(callUpsErr.message)

    const attendancePct =
      callUps.length > 0 ? Math.round((callUps.filter((c) => c.attended === true).length / callUps.length) * 100) : null

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

async function getMatchdayById(matchdayId) {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, opponent_club_id, match_date, whatsapp_poll_id')
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

// Convierte {phone: 'Si'|'No'|'Duda'} en filas de call_ups: una por cada
// jugador de la plantilla, called=true siempre. 'Duda' o ausencia de voto
// se guarda como attended=NULL — sin equivalente booleano, ver
// migration-diagnosis.md §3c.
async function guardarCallUpsDesdeVotos(matchdayId, votes) {
  const players = await fetchPlayersFromSupabase()
  const rows = players.map((p) => {
    const vote = p.phone ? votes[p.phone] : undefined
    const attended = vote === 'Si' ? true : vote === 'No' ? false : null
    return { matchday_id: matchdayId, player_id: p.id, called: true, attended, role_in_squad: null }
  })
  if (rows.length === 0) return
  const { error } = await supabase.from('call_ups').upsert(rows, { onConflict: 'matchday_id,player_id' })
  if (error) throw new Error(error.message)
}

// Se llama al dejar de ser el partido activo: guarda un último snapshot de
// sus votos en call_ups antes de perder el puntero — mismo papel que antes
// cumplía el snapshot votes/votesUpdatedAt en db_convocatorias_aut.json.
async function archivarVotos(matchdayId, pollId) {
  let votes = {}
  try {
    votes = await fetchPollVotes(pollId)
  } catch {
    votes = {}
  }
  await guardarCallUpsDesdeVotos(matchdayId, votes)
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
    const { rival, date, time, whatsappPollId } = req.body
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

    // Si cambiamos a un partido distinto y el que deja de ser el activo
    // tenía encuesta configurada, se archiva antes de perder el puntero.
    // También se archiva sin encuesta real si el modo mock está activo, para
    // que call_ups salga consistente con los votos simulados que ya ve
    // PlantillaScreen (si no, con el mock activo pero sin whatsapp_poll_id,
    // esto nunca se ejecutaría y call_ups se quedaría vacía).
    if (actual && actual.id !== matchdayId && (actual.whatsappPollId || isMockVotesActive())) {
      await archivarVotos(actual.id, actual.whatsappPollId)
    }

    const nuevoPollId = whatsappPollId ?? (actual?.id === matchdayId ? actual?.whatsappPollId : '') ?? ''
    // match_date también se actualiza aquí para una jornada ya existente del
    // calendario (no solo al crearla ad-hoc): antes este endpoint solo
    // tocaba whatsapp_poll_id, así que cambiar la hora (o la fecha) de un
    // partido ya presente en el calendario nunca se guardaba.
    const updates = { whatsapp_poll_id: nuevoPollId || null }
    if (dateFinal) updates.match_date = combinarFechaHora(dateFinal, timeFinal)
    const { error: updErr } = await supabase.from('matchdays').update(updates).eq('id', matchdayId)
    if (updErr) throw new Error(updErr.message)

    await setActiveMatchdayId(matchdayId)

    const final = await getMatchdayById(matchdayId)
    const { rival: rivalOut, date: dateOut, time: timeOut } = matchdayRivalDate(final, clubNameById)
    res.json({ matchId: final.id, rival: rivalOut, date: dateOut, time: timeOut, whatsappPollId: final.whatsapp_poll_id || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/convocatoria-history', async (req, res) => {
  try {
    const activeId = await getActiveMatchdayId()
    const [{ data: callUps, error: cuErr }, { data: players, error: playersErr }, { data: matchdays, error: mdErr }] =
      await Promise.all([
        supabase.from('call_ups').select('matchday_id, player_id, attended'),
        supabase.from('players').select('id, phone'),
        supabase.from('matchdays').select('id, opponent_club_id, match_date, whatsapp_poll_id'),
      ])
    if (cuErr) throw new Error(cuErr.message)
    if (playersErr) throw new Error(playersErr.message)
    if (mdErr) throw new Error(mdErr.message)

    const phoneById = new Map(players.map((p) => [p.id, p.phone]))
    const matchdayById = new Map(matchdays.map((m) => [m.id, m]))
    const clubNameById = await getClubNameById()

    const porPartido = new Map()
    for (const cu of callUps) {
      if (cu.matchday_id === activeId) continue
      const phone = phoneById.get(cu.player_id)
      if (!phone) continue
      if (!porPartido.has(cu.matchday_id)) porPartido.set(cu.matchday_id, {})
      porPartido.get(cu.matchday_id)[phone] = cu.attended === true ? 'Si' : cu.attended === false ? 'No' : null
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

// Jugadores que votaron "Sí" en la convocatoria de una jornada concreta
// (call_ups.attended = true). Lo usa MatchStatsPanel para no listar a quien
// no confirmó asistencia. call_ups.called es siempre true en las filas que
// existen (ver guardarCallUpsDesdeVotos) — el voto real vive en `attended`.
app.get('/api/call-ups/:matchdayId', async (req, res) => {
  const matchdayId = Number(req.params.matchdayId)
  try {
    const { data, error } = await supabase
      .from('call_ups')
      .select('player_id')
      .eq('matchday_id', matchdayId)
      .eq('attended', true)
    if (error) throw new Error(error.message)
    res.json({ playerIds: data.map((row) => row.player_id) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Genera de verdad la encuesta de WhatsApp (Sí/No/Duda) para el partido
// activo y guarda el id del mensaje en matchdays.whatsapp_poll_id (el mismo
// campo que ya usa GET /api/next-match/poll para consultar después los
// votos vía fetchPollVotes).
app.post('/api/next-match/poll', requireEntrenador(), async (req, res) => {
  try {
    const activeId = await getActiveMatchdayId()
    if (!activeId) return res.status(400).json({ error: 'Configura antes el rival y la fecha del próximo partido.' })
    const m = await getMatchdayById(activeId)
    const { rival, date } = matchdayRivalDate(m, await getClubNameById())
    if (!rival) return res.status(400).json({ error: 'Configura antes el rival y la fecha del próximo partido.' })

    const titulo = `Convocatoria vs ${rival}${date ? ` (${date})` : ''} — ¿Vienes?`
    const messageId = await createPollMessage({ title: titulo, options: ['Si', 'No', 'Duda'] })
    const { error: updErr } = await supabase.from('matchdays').update({ whatsapp_poll_id: messageId }).eq('id', activeId)
    if (updErr) throw new Error(updErr.message)

    res.json({ matchId: activeId, rival, date, whatsappPollId: messageId })
  } catch (err) {
    res.status(502).json({ error: err.message })
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
// entrenador ya ha dado por disputado. También archiva los votos de su
// encuesta en call_ups (igual que hace PUT /api/next-match al cambiar de
// partido activo) porque marcar como jugado es la otra forma de que un
// partido deje de estar "vivo" y, sin este archivado, MatchStatsPanel se
// queda sin convocados con los que anotar estadísticas (ver matchday_id=103).
app.put('/api/calendario/:matchId/jugado', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  const { data, error } = await supabase
    .from('matchdays')
    .update({ status: 'played' })
    .eq('id', matchId)
    .select('id, jornada_number, match_date, opponent_club_id, is_home, status, whatsapp_poll_id')
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Partido no encontrado en el calendario.' })
  try {
    if (data.whatsapp_poll_id || isMockVotesActive()) {
      await archivarVotos(data.id, data.whatsapp_poll_id)
    }
    res.json(reconstruirPartidoCalendario(data, await getClubNameById()))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Votos de convocatoria para una fecha concreta del calendario (no
// necesariamente la activa), para el filtro histórico de AlineacionScreen.
app.get('/api/convocatoria-por-fecha', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const fecha = req.query.fecha
  if (!fecha) {
    return res.status(400).json({ error: 'Falta el parámetro fecha.' })
  }

  try {
    const { data: m, error } = await supabase
      .from('matchdays')
      .select('whatsapp_poll_id')
      .eq('match_date', fecha)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const pollId = m?.whatsapp_poll_id
    // Ver comentario equivalente en GET /api/next-match/poll.
    if (!pollId && !isMockVotesActive()) {
      return res.json({ pollConfigured: false, votes: {} })
    }
    const votes = await fetchPollVotes(pollId)
    res.json({ pollConfigured: true, votes })
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


