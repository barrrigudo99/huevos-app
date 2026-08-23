import express from 'express'
import cors from 'cors'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchPollVotes } from './whatsappPollService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'db.json')
const SIM_DB_PATH = path.join(__dirname, 'db_simulator.json')
const SIMULACION_PATH = path.join(__dirname, '..', 'simulador', '4_resultados.json')
const EQUIPOS_SIMULADOS_PATH = path.join(__dirname, '..', 'simulador', '1_equipos.json')
const CONVOCATORIA_SIMULADA_PATH = path.join(__dirname, '..', 'simulador', '3_convocatorias.json')
const CALENDARIO_PATH = path.join(__dirname, '..', 'simulador', '2_calendario.json')

// Cambia a false para que GET /api/next-match/poll vuelva a consultar la
// encuesta real de WhatsApp (vía Whapi) en lugar de simulador/3_convocatorias.json.
const USAR_CONVOCATORIA_SIMULADA = true

const app = express()
app.use(cors())
app.use(express.json())

async function readDb() {
  const raw = await readFile(DB_PATH, 'utf-8')
  return JSON.parse(raw)
}

async function writeDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2))
}

// Los metadatos fijos de la liga (temporada, total_equipos, formato,
// total_jornadas) viven en db_simulator.json. Los equipos y los partidos en
// sí los genera y amplía el pipeline de simulador/ (1_equipos.json y
// 4_resultados.json) — se leen en cada petición para reflejar siempre la
// última jornada simulada. La lista de equipos se toma de 1_equipos.json
// (no de db_simulator.json) porque ahí es donde el "Equipo 1" real aparece
// con el nombre del club (p.ej. "Huevos FC"); si se usara la lista vieja,
// computeStandings/isOurMatch (src/data/league.js) no reconocerían esos
// partidos al no coincidir el nombre de equipo.
async function readSimDb() {
  const raw = await readFile(SIM_DB_PATH, 'utf-8')
  const { partidos: _partidosSemilla, equipos: _equiposSemilla, ...meta } = JSON.parse(raw)
  const partidos = JSON.parse(await readFile(SIMULACION_PATH, 'utf-8').catch(() => '[]'))
  const equiposData = JSON.parse(await readFile(EQUIPOS_SIMULADOS_PATH, 'utf-8').catch(() => '{"equipos":[]}'))
  const equipos = (equiposData.equipos || []).map((e) => e.nombre)
  const jornadasSimuladas = partidos.reduce((max, p) => Math.max(max, p.jornada), 0)
  return { ...meta, equipos, partidos, jornadas_simuladas: jornadasSimuladas }
}

function publicUser(user) {
  const { password, ...rest } = user
  return rest
}

// Busca en simulador/3_convocatorias.json la entrada simulada cuyo
// whatsappPollId coincide con el de la convocatoria activa.
async function readVotosSimulados(pollId) {
  const raw = await readFile(CONVOCATORIA_SIMULADA_PATH, 'utf-8').catch(() => '[]')
  const convocatorias = JSON.parse(raw)
  return convocatorias.find((c) => c.whatsappPollId === pollId)
}

// Igual que readVotosSimulados pero buscando por fecha en vez de por
// whatsappPollId, para el filtro de convocatoria histórica de Plantilla.
async function readVotosSimuladosPorFecha(fecha) {
  const raw = await readFile(CONVOCATORIA_SIMULADA_PATH, 'utf-8').catch(() => '[]')
  const convocatorias = JSON.parse(raw)
  return convocatorias.find((c) => c.date === fecha)
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
    const db = await readDb()
    const user = db.users.find((u) => u.id === userId)
    if (!user || user.role !== 'entrenador') {
      return res.status(403).json({ error: 'Solo un entrenador puede realizar esta acción.' })
    }
    req.db = db
    req.currentUser = user
    next()
  }
}

app.get('/api/players', async (req, res) => {
  const db = await readDb()
  res.json(db.players)
})

app.post('/api/players', requireEntrenador(), async (req, res) => {
  const { name, positions, number, phone, birthDate } = req.body
  if (!name || !Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'Datos de jugador incompletos.' })
  }
  const db = req.db
  const nextId = db.players.reduce((max, p) => Math.max(max, p.id), 0) + 1
  const player = {
    id: nextId,
    name,
    positions,
    number: Number(number) || 0,
    phone: normalizePhone(phone),
    birthDate: birthDate || null,
    photo: null,
  }
  db.players.push(player)
  await writeDb(db)
  res.status(201).json(player)
})

app.post('/api/register', async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Rellena todos los campos.' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' })
  }
  const normalizedEmail = String(email).trim().toLowerCase()
  const db = await readDb()
  if (db.users.some((u) => u.email === normalizedEmail)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' })
  }
  const nextId = db.users.reduce((max, u) => Math.max(max, u.id), 0) + 1
  const user = { id: nextId, name, email: normalizedEmail, password, role }
  db.users.push(user)
  await writeDb(db)
  res.status(201).json(publicUser(user))
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const db = await readDb()
  const user = db.users.find((u) => u.email === normalizedEmail)
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
  }
  res.json(publicUser(user))
})

app.get('/api/next-match', async (req, res) => {
  const db = await readDb()
  res.json(db.nextMatch || null)
})

app.put('/api/next-match', requireEntrenador(), async (req, res) => {
  const { rival, date, whatsappPollId } = req.body
  const db = req.db
  const current = db.nextMatch

  // Antes de sobrescribir, archivamos la convocatoria anterior junto con el
  // estado de la encuesta de WhatsApp en ese momento, para poder calcular
  // más adelante el % de "Sí" acumulado por jugador (Tarea 3 de perfil).
  if (current && current.rival && current.whatsappPollId) {
    let votes = {}
    if (USAR_CONVOCATORIA_SIMULADA) {
      const entrada = await readVotosSimulados(current.whatsappPollId)
      votes = entrada?.votes || {}
    } else {
      try {
        votes = await fetchPollVotes(current.whatsappPollId)
      } catch {
        votes = {}
      }
    }
    db.convocatoriaHistory = db.convocatoriaHistory || []
    db.convocatoriaHistory.push({
      id: current.id,
      rival: current.rival,
      date: current.date,
      whatsappPollId: current.whatsappPollId,
      votes,
      archivedAt: new Date().toISOString(),
    })
  }

  db.nextMatch = {
    id: current?.id || 1,
    rival: rival ?? current?.rival ?? '',
    date: date ?? current?.date ?? '',
    whatsappPollId: whatsappPollId ?? current?.whatsappPollId ?? '',
  }
  await writeDb(db)
  res.json(db.nextMatch)
})

app.get('/api/convocatoria-history', async (req, res) => {
  const db = await readDb()
  res.json(db.convocatoriaHistory || [])
})

// Consulta en tiempo real (sin caché) el estado de la encuesta de WhatsApp
// asociada a la próxima convocatoria.
app.get('/api/next-match/poll', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const db = await readDb()
  const pollId = db.nextMatch?.whatsappPollId
  if (!pollId) {
    return res.json({ pollConfigured: false, votes: {} })
  }

  if (USAR_CONVOCATORIA_SIMULADA) {
    const entrada = await readVotosSimulados(pollId)
    if (!entrada) {
      return res.json({ pollConfigured: false, votes: {} })
    }
    return res.json({ pollConfigured: true, votes: entrada.votes })
  }

  try {
    const votes = await fetchPollVotes(pollId)
    res.json({ pollConfigured: true, votes })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Calendario completo de la temporada (todas las jornadas, jugadas o no),
// para el filtro de fecha de Plantilla. Solo lectura.
app.get('/api/calendario', async (req, res) => {
  const partidos = JSON.parse(await readFile(CALENDARIO_PATH, 'utf-8').catch(() => '[]'))
  res.json(partidos)
})

// Votos de convocatoria para una fecha concreta del calendario (no
// necesariamente la próxima), para el filtro histórico de Plantilla.
app.get('/api/convocatoria-por-fecha', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const fecha = req.query.fecha
  if (!fecha) {
    return res.status(400).json({ error: 'Falta el parámetro fecha.' })
  }

  if (USAR_CONVOCATORIA_SIMULADA) {
    const entrada = await readVotosSimuladosPorFecha(fecha)
    if (!entrada) {
      return res.json({ pollConfigured: false, votes: {} })
    }
    return res.json({ pollConfigured: true, votes: entrada.votes })
  }

  const db = await readDb()
  const entrada = (db.convocatoriaHistory || []).find((c) => c.date === fecha)
  if (!entrada) {
    return res.json({ pollConfigured: false, votes: {} })
  }
  res.json({ pollConfigured: true, votes: entrada.votes })
})

// Datos de la liga (simulación de calendario/resultados), solo lectura.
app.get('/api/league', async (req, res) => {
  const sim = await readSimDb()
  res.json(sim)
})

app.get('/api/club', async (req, res) => {
  const db = await readDb()
  res.json(db.club || { name: '' })
})

app.put('/api/club', requireEntrenador(), async (req, res) => {
  const { name } = req.body
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre del club no puede estar vacío.' })
  }
  const db = req.db
  db.club = { name: String(name).trim() }
  await writeDb(db)
  res.json(db.club)
})

// Sucesos (goles/asistencias/tarjetas) de partidos de nuestro equipo,
// indexados por el id de partido de db_simulator.json. db_simulator.json
// es de solo lectura, así que esto vive aparte en db.json.
const MATCH_EVENT_TYPES = ['gol', 'asistencia', 'tarjeta_amarilla', 'tarjeta_roja']

app.get('/api/match-events', async (req, res) => {
  const db = await readDb()
  res.json(db.matchEvents || {})
})

app.post('/api/match-events/:matchId', requireEntrenador(), async (req, res) => {
  const { playerId, type } = req.body
  if (!MATCH_EVENT_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Tipo de suceso no válido.' })
  }
  const db = req.db
  const player = db.players.find((p) => p.id === Number(playerId))
  if (!player) {
    return res.status(400).json({ error: 'Jugador no encontrado en la plantilla.' })
  }
  const matchId = req.params.matchId
  db.matchEvents = db.matchEvents || {}
  const list = db.matchEvents[matchId] || []
  const nextId = list.reduce((max, e) => Math.max(max, e.id), 0) + 1
  list.push({ id: nextId, playerId: player.id, type })
  db.matchEvents[matchId] = list
  await writeDb(db)
  res.status(201).json(list)
})

app.delete('/api/match-events/:matchId/:eventId', requireEntrenador(), async (req, res) => {
  const db = req.db
  const matchId = req.params.matchId
  const eventId = Number(req.params.eventId)
  db.matchEvents = db.matchEvents || {}
  const list = db.matchEvents[matchId] || []
  db.matchEvents[matchId] = list.filter((e) => e.id !== eventId)
  await writeDb(db)
  res.json(db.matchEvents[matchId])
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT} (db: ${DB_PATH})`)
})
