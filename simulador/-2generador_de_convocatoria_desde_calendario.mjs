// generador_de_convocatoria_desde_calendario.mjs
// Lee calendario.json y genera convocatorias SOLO para los partidos del
// equipo con id 1 (equipos.json), sea local o visitante. Usa tu plantilla
// real (server/db.json) y una tendencia de asistencia estable por jugador
// (tendencias_asistencia.json) para que el % de asistencia salga realista.
//
// Uso (desde la carpeta simulador/, después de generar calendario.json):
//   node generador_de_convocatoria_desde_calendario.mjs
// Cada ejecución añade convocatorias para los partidos del equipo 1 que aún
// no tuvieran una. Vuelve a lanzarlo si generas más calendario.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- CONFIG ----------
const EQUIPOS_PATH = path.join(__dirname, 'equipos.json')
const CALENDARIO_PATH = path.join(__dirname, 'calendario.json')
const CONVOCATORIAS_PATH = path.join(__dirname, 'convocatorias.json')
const TENDENCIAS_PATH = path.join(__dirname, 'tendencias_asistencia.json')
const DB_PATH = path.join(__dirname, '..', 'server', 'db.json')
const MI_EQUIPO_ID = 1
const PROB_NO_RESPONDE = 0.05
const RUIDO_SEMANAL = 0.12

const PLAYERS_FALLBACK = [
  { id: 1, name: 'Carlos Barrientos', phone: '34684015410' },
  { id: 2, name: 'Edu Alba', phone: '34600000002' },
  { id: 3, name: 'Adri', phone: '34600000003' },
  { id: 4, name: 'Alexander', phone: '34600000004' },
  { id: 5, name: 'Boni', phone: '34600000005' },
  { id: 6, name: 'Artu', phone: '34600000006' },
  { id: 7, name: 'Anglada', phone: '34600000007' },
  { id: 8, name: 'Zurdo', phone: '34600000008' },
  { id: 9, name: 'Fer', phone: '34600000009' },
  { id: 10, name: 'Edu Gonzalez', phone: '34600000010' },
  { id: 11, name: 'Guille Rodriguez', phone: '34600000011' },
  { id: 12, name: 'Mecos', phone: '34600000012' },
  { id: 13, name: 'Igna', phone: '34600000013' },
  { id: 14, name: 'Ponce', phone: '34600000014' },
  { id: 15, name: 'Jose', phone: '34600000015' },
  { id: 16, name: 'Juanma', phone: '34600000016' },
  { id: 17, name: 'Luis', phone: '34600000017' },
  { id: 18, name: 'Rodri', phone: '34600000018' },
  { id: 19, name: 'Villar', phone: '34600000019' },
]
// -----------------------------

function leerJson(p, porDefecto) {
  if (!fs.existsSync(p)) return porDefecto
  const raw = fs.readFileSync(p, 'utf-8').trim()
  if (!raw) return porDefecto
  return JSON.parse(raw)
}

function escribirJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function obtenerNombreMiEquipo() {
  const data = leerJson(EQUIPOS_PATH, null)
  if (!data || !Array.isArray(data.equipos)) {
    console.error(`No se encontró ${EQUIPOS_PATH} o no tiene un array "equipos" válido.`)
    process.exit(1)
  }
  const equipo = data.equipos.find((e) => e.id === MI_EQUIPO_ID)
  if (!equipo) {
    console.error(`No existe ningún equipo con id ${MI_EQUIPO_ID} en ${EQUIPOS_PATH}.`)
    process.exit(1)
  }
  return equipo.nombre
}

function obtenerJugadores() {
  const db = leerJson(DB_PATH, null)
  if (db && Array.isArray(db.players) && db.players.length > 0) return db.players
  console.warn(`Aviso: no se encontró ${DB_PATH}, usando plantilla de respaldo embebida en el script.`)
  return PLAYERS_FALLBACK
}

function obtenerTendencias(jugadores) {
  const tendencias = leerJson(TENDENCIAS_PATH, {})
  let cambiado = false
  jugadores.forEach((j) => {
    if (tendencias[j.id] === undefined) {
      const base = 0.5 + Math.pow(Math.random(), 1.5) * 0.47
      tendencias[j.id] = Math.round(base * 100) / 100
      cambiado = true
    }
  })
  if (cambiado) escribirJson(TENDENCIAS_PATH, tendencias)
  return tendencias
}

function generarVotos(jugadores, tendencias) {
  const votos = {}
  jugadores.forEach((j) => {
    if (!j.phone) return
    if (Math.random() < PROB_NO_RESPONDE) return

    const base = tendencias[j.id] ?? 0.75
    const ruido = (Math.random() - 0.5) * 2 * RUIDO_SEMANAL
    const probabilidadSi = clamp(base + ruido, 0.05, 0.99)
    votos[j.phone] = Math.random() < probabilidadSi ? 'Si' : 'No'
  })
  return votos
}

function rivalDelPartido(partido, miEquipo) {
  return partido.equipo_local === miEquipo ? partido.equipo_visitante : partido.equipo_local
}

function ampliarConvocatorias() {
  const miEquipo = obtenerNombreMiEquipo()
  const calendario = leerJson(CALENDARIO_PATH, [])

  if (calendario.length === 0) {
    console.error(`No se encontró ${CALENDARIO_PATH} o está vacío. Genera antes el calendario (generador_de_calendario.mjs).`)
    process.exit(1)
  }

  const convocatoriasExistentes = leerJson(CONVOCATORIAS_PATH, [])
  const idsConConvocatoria = new Set(convocatoriasExistentes.map((c) => c.matchId))

  const partidosDeMiEquipo = calendario.filter(
    (p) => p.equipo_local === miEquipo || p.equipo_visitante === miEquipo
  )
  const partidosPendientes = partidosDeMiEquipo.filter((p) => !idsConConvocatoria.has(p.id))

  if (partidosPendientes.length === 0) {
    console.log(`No hay partidos nuevos de "${miEquipo}" (id ${MI_EQUIPO_ID}) sin convocatoria.`)
    return
  }

  const jugadores = obtenerJugadores()
  const tendencias = obtenerTendencias(jugadores)
  const ultimoId = convocatoriasExistentes.reduce((max, c) => Math.max(max, c.id), 0)

  const nuevasConvocatorias = partidosPendientes.map((partido, i) => ({
    id: ultimoId + i + 1,
    matchId: partido.id,
    jornada: partido.jornada,
    rival: rivalDelPartido(partido, miEquipo),
    date: partido.fecha,
    whatsappPollId: `simulado-${partido.id}`,
    votes: generarVotos(jugadores, tendencias),
    archivedAt: new Date().toISOString(),
  }))

  const actualizado = [...convocatoriasExistentes, ...nuevasConvocatorias]
  escribirJson(CONVOCATORIAS_PATH, actualizado)
  console.log(`${nuevasConvocatorias.length} convocatoria(s) nueva(s) de "${miEquipo}" añadidas a ${CONVOCATORIAS_PATH}.`)
}

ampliarConvocatorias()