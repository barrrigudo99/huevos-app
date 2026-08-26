import express from 'express'
import cors from 'cors'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createPollMessage, fetchPollVotes } from './whatsappPollService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'db.json')
const SIM_DB_PATH = path.join(__dirname, 'db_simulator.json')
const SIMULACION_PATH = path.join(__dirname, '..', 'simulador', 'resultados.json')
const EQUIPOS_SIMULADOS_PATH = path.join(__dirname, '..', 'simulador', '1_equipos.json')
const CONVOCATORIA_SIMULADA_PATH = path.join(__dirname, '..', 'simulador', '3_convocatorias.json')
const CALENDARIO_PATH = path.join(__dirname, '..', 'simulador', '2_calendario.json')
const ESTADISTICAS_PERSONALES_PATH = path.join(__dirname, '..', 'simulador', 'estadisticas_personales.json')
const CONVOCATORIAS_AUT_PATH = path.join(__dirname, 'db_convocatorias_aut.json')

// Cambia a false para que GET /api/next-match/poll vuelva a consultar la
// encuesta real de WhatsApp (vía Whapi) en lugar de simulador/3_convocatorias.json.
const USAR_CONVOCATORIA_SIMULADA = false

const app = express()

// Orígenes permitidos para llamar a esta API. Para pruebas con túnel de
// Cloudflare (cloudflared tunnel --url http://localhost:5173), sustituye la
// URL de trycloudflare.com de abajo por la que te dé el túnel del FRONTEND
// cada vez que lo reinicies (cambia en cada arranque de cloudflared) y
// reinicia `npm run server`. localhost:5173 se deja siempre para seguir
// pudiendo probar en local sin túnel.
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://poem-liabilities-truly-automated.trycloudflare.com'],
  })
)
app.use(express.json())

async function readDb() {
  const raw = await readFile(DB_PATH, 'utf-8')
  return JSON.parse(raw)
}

async function writeDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2))
}

// Los metadatos fijos de la liga (temporada, total_equipos, formato,
// total_jornadas) viven en db_simulator.json. Los equipos se leen de
// 1_equipos.json (no de db_simulator.json) porque ahí es donde el "Equipo 1"
// real aparece con el nombre del club (p.ej. "Huevos FC"); si se usara la
// lista vieja, computeStandings/isOurMatch (src/data/league.js) no
// reconocerían esos partidos al no coincidir el nombre de equipo. La
// clasificación de la pestaña Marcador (equipos.map + partidos con
// resultado) se calcula exclusivamente a partir de resultados.json: solo
// contiene un partido cuando de verdad tiene un marcador simulado, a
// diferencia de 2_calendario.json (que solo indica si el entrenador ha
// marcado el partido como jugado, sin resultado).
// resultados.json admite dos formatos: el plano de un partido por elemento
// que produce simulador/-4generador_de_resultados.mjs (equipo_local/
// equipo_visitante/resultado/jugado, igual que 2_calendario.json), y uno
// anidado por jornada (jornada + partidos[] con local/visitante/goles_local/
// goles_visitante) que es como se ha ido rellenando a mano. Se aceptan los
// dos: si un elemento trae `partidos`, se desenvuelve a partidos sueltos con
// la misma forma que el plano, para que computeStandings (src/data/league.js)
// los cuente igual sea cual sea el origen.
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
    }))
  })
}

async function readSimDb() {
  const raw = await readFile(SIM_DB_PATH, 'utf-8')
  const { partidos: _partidosSemilla, equipos: _equiposSemilla, ...meta } = JSON.parse(raw)
  const resultadosRaw = JSON.parse(await readFile(SIMULACION_PATH, 'utf-8').catch(() => '[]'))
  const partidos = aplanarResultados(resultadosRaw)
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

// Todo lo relativo a "próximo partido configurado a mano" + su encuesta de
// WhatsApp vive en server/db_convocatorias_aut.json, NO en db.json: es un
// array con un registro por matchId (id real de 2_calendario.json cuando el
// rival/fecha coinciden con una jornada; si no, un id sintético). No hay un
// slot único "nextMatch" ni un array de historial aparte — cada matchId
// conserva su propio registro para siempre, así que "el partido activo" es
// el de updatedAt más reciente, y "el historial" es simplemente el resto.
async function leerConvocatoriasAut() {
  return JSON.parse(await readFile(CONVOCATORIAS_AUT_PATH, 'utf-8').catch(() => '[]'))
}

async function escribirConvocatoriasAut(registros) {
  await writeFile(CONVOCATORIAS_AUT_PATH, JSON.stringify(registros, null, 2) + '\n', 'utf-8')
}

function registroActivo(registros) {
  return registros.reduce((mejor, r) => (!mejor || r.updatedAt > mejor.updatedAt ? r : mejor), null)
}

function mismoPartido(a, b) {
  return !!a && !!b && a.rival === b.rival && a.date === b.date
}

// Busca en 2_calendario.json el partido cuyo rival y fecha coinciden, para
// que el registro de convocatoria use el id real de jornada (en vez de uno
// suelto que no corresponda a ningún partido del calendario).
async function buscarMatchIdCalendario(rival, fecha) {
  const calendario = JSON.parse(await readFile(CALENDARIO_PATH, 'utf-8').catch(() => '[]'))
  const partido = calendario.find(
    (p) => p.fecha === fecha && (p.equipo_local === rival || p.equipo_visitante === rival)
  )
  return partido?.id ?? null
}

// Crea o actualiza (fusionando campos, sin pisar convocados/duda/etc. que ya
// hubiera) el registro de un matchId en server/db_convocatorias_aut.json.
// Devuelve el registro resultante.
async function guardarConvocatoriaAut(cambios) {
  const registros = await leerConvocatoriasAut()
  const index = registros.findIndex((r) => r.matchId === cambios.matchId)
  const base = index >= 0 ? registros[index] : { convocados: [], duda: [], descartados: [], sinResponder: [] }
  const entrada = { ...base, ...cambios }
  if (index >= 0) registros[index] = entrada
  else registros.push(entrada)
  await escribirConvocatoriasAut(registros)
  return entrada
}

app.get('/api/next-match', async (req, res) => {
  const activo = registroActivo(await leerConvocatoriasAut())
  if (!activo) return res.json(null)
  res.json({
    matchId: activo.matchId,
    rival: activo.rival,
    date: activo.date,
    whatsappPollId: activo.whatsappPollId || '',
  })
})

app.put('/api/next-match', requireEntrenador(), async (req, res) => {
  const { rival, date, whatsappPollId } = req.body
  const actual = registroActivo(await leerConvocatoriasAut())

  const rivalFinal = rival ?? actual?.rival ?? ''
  const dateFinal = date ?? actual?.date ?? ''

  let matchId = await buscarMatchIdCalendario(rivalFinal, dateFinal)
  if (matchId == null) {
    // Sin jornada de calendario que lo identifique (rival "a mano"): se
    // conserva el mismo id sintético mientras se siga editando el mismo
    // partido, y se genera uno nuevo en cuanto rival/fecha cambian de
    // verdad — así no se pisa el registro de un partido distinto.
    matchId = mismoPartido(actual, { rival: rivalFinal, date: dateFinal }) ? actual.matchId : Date.now()
  }

  // Si el partido activo cambia a otro distinto y el que deja de serlo tenía
  // encuesta, se guarda un último snapshot de sus votos (en votes/
  // votesUpdatedAt, sin tocar su updatedAt) — mismo papel que antes cumplía
  // db.convocatoriaHistory al archivar antes de sobrescribir.
  if (actual && actual.matchId !== matchId && actual.whatsappPollId) {
    let votes = {}
    if (USAR_CONVOCATORIA_SIMULADA) {
      const entrada = await readVotosSimulados(actual.whatsappPollId)
      votes = entrada?.votes || {}
    } else {
      try {
        votes = await fetchPollVotes(actual.whatsappPollId)
      } catch {
        votes = {}
      }
    }
    await guardarConvocatoriaAut({ matchId: actual.matchId, votes, votesUpdatedAt: new Date().toISOString() })
  }

  const entrada = await guardarConvocatoriaAut({
    matchId,
    rival: rivalFinal,
    date: dateFinal,
    whatsappPollId: whatsappPollId ?? (actual?.matchId === matchId ? actual?.whatsappPollId : '') ?? '',
    updatedAt: new Date().toISOString(),
  })
  res.json({
    matchId: entrada.matchId,
    rival: entrada.rival,
    date: entrada.date,
    whatsappPollId: entrada.whatsappPollId || '',
  })
})

app.get('/api/convocatoria-history', async (req, res) => {
  if (USAR_CONVOCATORIA_SIMULADA) {
    const raw = await readFile(CONVOCATORIA_SIMULADA_PATH, 'utf-8').catch(() => '[]')
    return res.json(JSON.parse(raw))
  }
  const registros = await leerConvocatoriasAut()
  const activo = registroActivo(registros)
  const historial = registros
    .filter((r) => r !== activo)
    .map((r) => ({
      id: r.matchId,
      rival: r.rival,
      date: r.date,
      whatsappPollId: r.whatsappPollId,
      votes: r.votes || {},
      archivedAt: r.votesUpdatedAt || r.updatedAt,
    }))
  res.json(historial)
})

// Genera de verdad la encuesta de WhatsApp (Sí/No/Duda) para el partido
// activo en server/db_convocatorias_aut.json y guarda el id del mensaje
// creado en su whatsappPollId (el mismo campo que ya usa GET
// /api/next-match/poll para consultar después los votos vía fetchPollVotes).
// No disponible mientras USAR_CONVOCATORIA_SIMULADA esté activo, para no
// confundir una convocatoria simulada con una real.
app.post('/api/next-match/poll', requireEntrenador(), async (req, res) => {
  if (USAR_CONVOCATORIA_SIMULADA) {
    return res.status(409).json({
      error:
        'La convocatoria simulada está activada (USAR_CONVOCATORIA_SIMULADA=true). Desactívala para generar una encuesta real de WhatsApp.',
    })
  }

  const activo = registroActivo(await leerConvocatoriasAut())
  if (!activo || !activo.rival) {
    return res.status(400).json({ error: 'Configura antes el rival y la fecha del próximo partido.' })
  }

  const titulo = `Convocatoria vs ${activo.rival}${activo.date ? ` (${activo.date})` : ''} — ¿Vienes?`

  try {
    const messageId = await createPollMessage({ title: titulo, options: ['Si', 'No', 'Duda'] })
    const entrada = await guardarConvocatoriaAut({
      matchId: activo.matchId,
      whatsappPollId: messageId,
      generatedAt: new Date().toISOString(),
    })
    res.json({
      matchId: entrada.matchId,
      rival: entrada.rival,
      date: entrada.date,
      whatsappPollId: entrada.whatsappPollId,
    })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Consulta en tiempo real (sin caché) el estado de la encuesta de WhatsApp
// asociada a la convocatoria activa.
app.get('/api/next-match/poll', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const activo = registroActivo(await leerConvocatoriasAut())
  const pollId = activo?.whatsappPollId
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

// Próximo partido calculado automáticamente a partir de 2_calendario.json: el
// primero (por fecha) de nuestro equipo cuya fecha sea hoy o futura; si ya
// han pasado todas las fechas, se muestra la última. El campo "jugado" del
// calendario NO se tiene en cuenta aquí (ver NextMatchCard, que permite
// navegar manualmente por todas las jornadas independientemente de ese
// campo). A diferencia de GET /api/next-match (que devuelve lo que el
// entrenador haya guardado a mano en db.json), este no requiere configurar
// nada manualmente.
app.get('/api/next-match/auto', async (req, res) => {
  const equiposData = JSON.parse(await readFile(EQUIPOS_SIMULADOS_PATH, 'utf-8').catch(() => '{"equipos":[]}'))
  const miEquipo = (equiposData.equipos || []).find((e) => e.id === 1)?.nombre
  if (!miEquipo) {
    return res.json(null)
  }

  const calendario = JSON.parse(await readFile(CALENDARIO_PATH, 'utf-8').catch(() => '[]'))
  const nuestros = calendario
    .filter((p) => p.equipo_local === miEquipo || p.equipo_visitante === miEquipo)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const siguiente = nuestros.find((p) => new Date(p.fecha) >= hoy) || nuestros[nuestros.length - 1]
  if (!siguiente) {
    return res.json(null)
  }

  const esLocal = siguiente.equipo_local === miEquipo
  res.json({
    matchId: siguiente.id,
    jornada: siguiente.jornada,
    rival: esLocal ? siguiente.equipo_visitante : siguiente.equipo_local,
    date: siguiente.fecha,
    esLocal,
  })
})

// Marca un partido de 2_calendario.json como jugado, para que
// /api/next-match/auto avance al siguiente y el banner de "próximo partido"
// deje de mostrar uno que el entrenador ya ha dado por disputado.
app.put('/api/calendario/:matchId/jugado', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  const calendario = JSON.parse(await readFile(CALENDARIO_PATH, 'utf-8').catch(() => '[]'))
  const partido = calendario.find((p) => p.id === matchId)
  if (!partido) {
    return res.status(404).json({ error: 'Partido no encontrado en el calendario.' })
  }
  partido.jugado = true
  await writeFile(CALENDARIO_PATH, JSON.stringify(calendario, null, 2) + '\n', 'utf-8')
  res.json(partido)
})

// Votos de convocatoria para una fecha concreta del calendario (no
// necesariamente la activa), para el filtro histórico de AlineacionScreen.
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

  const registros = await leerConvocatoriasAut()
  const entrada = registros.find((r) => r.date === fecha)
  if (!entrada?.whatsappPollId) {
    return res.json({ pollConfigured: false, votes: {} })
  }
  try {
    const votes = await fetchPollVotes(entrada.whatsappPollId)
    res.json({ pollConfigured: true, votes })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// Datos de la liga (simulación de calendario/resultados), solo lectura.
app.get('/api/league', async (req, res) => {
  const sim = await readSimDb()
  res.json(sim)
})

// Estadísticas de jugador (goles, asistencias, tarjetas, minutos) agregadas
// a partir de simulador/estadisticas_personales.json, que trae el detalle
// jugador a jugador de cada partido jugado por Huevos FC. Solo lectura.
app.get('/api/player-match-stats', async (req, res) => {
  const partidos = JSON.parse(await readFile(ESTADISTICAS_PERSONALES_PATH, 'utf-8').catch(() => '[]'))
  const stats = {}
  for (const partido of partidos) {
    if (!partido.jugado) continue
    for (const j of partido.jugadores || []) {
      const s = stats[j.id] || {
        partidosJugados: 0,
        minutosJugados: 0,
        goles: 0,
        asistencias: 0,
        tarjetasAmarillas: 0,
        tarjetasRojas: 0,
      }
      s.partidosJugados += 1
      s.minutosJugados += j.minutosJugados || 0
      s.goles += j.goles || 0
      s.asistencias += j.asistencias || 0
      // Los partidos simulados solo traen si hubo amarilla (booleano); los
      // registrados a mano desde MatchStatsPanel guardan el recuento (0-2,
      // por la doble amarilla). Se admiten los dos formatos.
      s.tarjetasAmarillas += typeof j.amarillas === 'number' ? j.amarillas : j.tarjetaAmarilla ? 1 : 0
      if (j.tarjetaRoja) s.tarjetasRojas += 1
      stats[j.id] = s
    }
  }
  res.json(stats)
})

// Detalle jugador a jugador de cada partido con estadísticas personales
// registradas, tal cual vive en simulador/estadisticas_personales.json.
// Solo lectura; lo usa MatchStatsPanel para precargar lo ya guardado de un
// partido concreto antes de editar.
app.get('/api/estadisticas-personales', async (req, res) => {
  const partidos = JSON.parse(await readFile(ESTADISTICAS_PERSONALES_PATH, 'utf-8').catch(() => '[]'))
  res.json(partidos)
})

// Busca en 2_calendario.json el partido de matchId y devuelve rival/jornada/
// fecha/localía respecto a nuestro equipo, para dejar constancia en
// estadisticas_personales.json de a qué partido corresponden esas
// estadísticas (no solo el id, que por sí solo no dice nada legible).
async function datosPartidoCalendario(matchId) {
  const equiposData = JSON.parse(await readFile(EQUIPOS_SIMULADOS_PATH, 'utf-8').catch(() => '{"equipos":[]}'))
  const miEquipo = (equiposData.equipos || []).find((e) => e.id === 1)?.nombre
  const calendario = JSON.parse(await readFile(CALENDARIO_PATH, 'utf-8').catch(() => '[]'))
  const partido = calendario.find((p) => p.id === matchId)
  if (!partido || !miEquipo) return null
  const esLocal = partido.equipo_local === miEquipo
  return {
    jornada: partido.jornada,
    fecha: partido.fecha,
    rival: esLocal ? partido.equipo_visitante : partido.equipo_local,
    esLocal,
  }
}

// Guarda (crea o sustituye) las estadísticas personales de un partido:
// goles/asistencias/amarillas/roja por jugador, tal como las introduce el
// entrenador en MatchStatsPanel. Solo se guardan los jugadores con algo que
// reportar (si un jugador se deja a 0 en todo, desaparece de la lista del
// partido en vez de quedar como una fila vacía).
app.put('/api/estadisticas-personales/:matchId', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  const { jugadores } = req.body
  if (!Array.isArray(jugadores)) {
    return res.status(400).json({ error: 'Falta la lista de jugadores.' })
  }
  const db = req.db
  const entradas = []
  for (const j of jugadores) {
    const player = db.players.find((p) => p.id === Number(j.playerId))
    if (!player) continue
    const amarillas = Math.min(2, Math.max(0, Number(j.amarillas) || 0))
    entradas.push({
      id: player.id,
      name: player.name,
      positions: player.positions || [],
      number: player.number ?? null,
      phone: player.phone ?? null,
      photo: player.photo ?? null,
      goles: Math.max(0, Number(j.goles) || 0),
      asistencias: Math.max(0, Number(j.asistencias) || 0),
      amarillas,
      tarjetaAmarilla: amarillas > 0,
      tarjetaRoja: !!j.roja,
    })
  }

  const datosPartido = await datosPartidoCalendario(matchId)
  const estadisticas = JSON.parse(await readFile(ESTADISTICAS_PERSONALES_PATH, 'utf-8').catch(() => '[]'))
  const index = estadisticas.findIndex((p) => p.id === matchId)
  const entrada = {
    id: matchId,
    jugado: true,
    jornada: datosPartido?.jornada ?? null,
    rival: datosPartido?.rival ?? null,
    fecha: datosPartido?.fecha ?? null,
    esLocal: datosPartido?.esLocal ?? null,
    // El resultado se guarda aparte (ver PUT .../resultado) y no debe
    // perderse al guardar solo las estadísticas de jugadores.
    resultado: estadisticas[index]?.resultado ?? null,
    jugadores: entradas,
  }
  if (index >= 0) estadisticas[index] = entrada
  else estadisticas.push(entrada)
  await writeFile(ESTADISTICAS_PERSONALES_PATH, JSON.stringify(estadisticas, null, 2) + '\n', 'utf-8')
  res.json(entrada)
})

// Guarda el resultado final (goles a favor / en contra) de un partido,
// dentro de la misma entrada de simulador/estadisticas_personales.json.
// Deliberadamente independiente de simulador/resultados.json (que es la
// simulación de la clasificación de la pestaña Marcador): este marcador lo
// anota el entrenador a mano y no debe alterar esa simulación.
app.put('/api/estadisticas-personales/:matchId/resultado', requireEntrenador(), async (req, res) => {
  const matchId = Number(req.params.matchId)
  const resultado = {
    golesNosotros: Math.max(0, Number(req.body.golesNosotros) || 0),
    golesRival: Math.max(0, Number(req.body.golesRival) || 0),
  }

  const datosPartido = await datosPartidoCalendario(matchId)
  const estadisticas = JSON.parse(await readFile(ESTADISTICAS_PERSONALES_PATH, 'utf-8').catch(() => '[]'))
  const index = estadisticas.findIndex((p) => p.id === matchId)
  const entrada = {
    id: matchId,
    jugado: true,
    jornada: datosPartido?.jornada ?? estadisticas[index]?.jornada ?? null,
    rival: datosPartido?.rival ?? estadisticas[index]?.rival ?? null,
    fecha: datosPartido?.fecha ?? estadisticas[index]?.fecha ?? null,
    esLocal: datosPartido?.esLocal ?? estadisticas[index]?.esLocal ?? null,
    resultado,
    jugadores: estadisticas[index]?.jugadores ?? [],
  }
  if (index >= 0) estadisticas[index] = entrada
  else estadisticas.push(entrada)
  await writeFile(ESTADISTICAS_PERSONALES_PATH, JSON.stringify(estadisticas, null, 2) + '\n', 'utf-8')
  res.json(entrada)
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


