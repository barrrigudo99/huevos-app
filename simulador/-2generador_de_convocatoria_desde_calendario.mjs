// generador_de_convocatoria_desde_calendario.mjs
// Lee calendario.json y genera UNA convocatoria por ejecución para el
// siguiente partido pendiente del equipo con id 1 (equipos.json), sea local
// o visitante. Usa tu plantilla real (server/db.json) y una tendencia de
// asistencia estable por jugador (4_tendencias_asistencia.json) para que el
// % de asistencia salga realista.
//
// Uso (desde la carpeta simulador/, después de generar calendario.json):
//   node 2generador_de_convocatoria_desde_calendario.mjs
// Cada ejecución añade la convocatoria del próximo partido pendiente (el más
// antiguo por jornada/fecha) que aún no la tuviera. Vuelve a lanzarlo cuando
// quieras generar la siguiente.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- CONFIG ----------
const EQUIPOS_PATH = path.join(__dirname, '1_equipos.json')
const CALENDARIO_PATH = path.join(__dirname, '2_calendario.json')
const CONVOCATORIAS_PATH = path.join(__dirname, '3_convocatorias.json')
const TENDENCIAS_PATH = path.join(__dirname, '4_tendencias_asistencia.json')
const DB_PATH = path.join(__dirname, '..', 'server', 'db.json')
const MI_EQUIPO_ID = 1
const PROB_NO_RESPONDE = 0.05
const RUIDO_SEMANAL = 0.12

const PLAYERS_FALLBACK = [
  { id: 1, name: 'Carlos Barrientos', phone: '34684015410' },
  { id: 2, name: 'Edu Alba', phone: '34660119994' },
  { id: 3, name: 'Adri', phone: '34654650662' },
  { id: 4, name: 'Alexander', phone: '34610074607' },
  { id: 5, name: 'Boni', phone: '34693740846' },
  { id: 6, name: 'Artu', phone: '34634507343' },
  { id: 7, name: 'Anglada', phone: '34676527257' },
  { id: 8, name: 'Zurdo', phone: '34626821050' },
  { id: 9, name: 'Fer', phone: '34639880171' },
  { id: 10, name: 'Edu Gonzalez', phone: '34640624633' },
  { id: 11, name: 'Guille Rodriguez', phone: '34609486985' },
  { id: 12, name: 'Mecos', phone: '34679265104' },
  { id: 13, name: 'Igna', phone: '34648515824' },
  { id: 14, name: 'Ponce', phone: '34601147511' },
  { id: 15, name: 'Jose', phone: '34604817149' },
  { id: 16, name: 'Juanma', phone: '34630731212' },
  { id: 17, name: 'Luis', phone: '34610611931' },
  { id: 18, name: 'Rodri', phone: '34628657664' },
  { id: 19, name: 'Villar', phone: '34619300259' },
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

// Ordena por jornada y, si empatan, por fecha — así "el siguiente pendiente"
// es siempre el más próximo en el calendario, no uno cualquiera.
function ordenarPorJornadaYFecha(a, b) {
  if (a.jornada !== b.jornada) return a.jornada - b.jornada
  return new Date(a.fecha) - new Date(b.fecha)
}

function generarSiguienteConvocatoria() {
  const miEquipo = obtenerNombreMiEquipo()
  const calendario = leerJson(CALENDARIO_PATH, [])

  if (calendario.length === 0) {
    console.error(`No se encontró ${CALENDARIO_PATH} o está vacío. Genera antes el calendario (1generador_de_calendario.mjs).`)
    process.exit(1)
  }

  const convocatoriasExistentes = leerJson(CONVOCATORIAS_PATH, [])
  const idsConConvocatoria = new Set(convocatoriasExistentes.map((c) => c.matchId))

  const partidosDeMiEquipo = calendario.filter(
    (p) => p.equipo_local === miEquipo || p.equipo_visitante === miEquipo
  )
  const partidosPendientes = partidosDeMiEquipo
    .filter((p) => !idsConConvocatoria.has(p.id))
    .sort(ordenarPorJornadaYFecha)

  if (partidosPendientes.length === 0) {
    console.log(`No hay partidos de "${miEquipo}" (id ${MI_EQUIPO_ID}) pendientes de convocatoria.`)
    return
  }

  // Solo el siguiente partido pendiente, no todos de golpe.
  const partido = partidosPendientes[0]

  const jugadores = obtenerJugadores()
  const tendencias = obtenerTendencias(jugadores)
  const ultimoId = convocatoriasExistentes.reduce((max, c) => Math.max(max, c.id), 0)

  const nuevaConvocatoria = {
    id: ultimoId + 1,
    matchId: partido.id,
    jornada: partido.jornada,
    rival: rivalDelPartido(partido, miEquipo),
    date: partido.fecha,
    whatsappPollId: `simulado-${partido.id}`,
    votes: generarVotos(jugadores, tendencias),
    archivedAt: new Date().toISOString(),
  }

  const actualizado = [...convocatoriasExistentes, nuevaConvocatoria]
  escribirJson(CONVOCATORIAS_PATH, actualizado)

  const restantes = partidosPendientes.length - 1
  console.log(
    `Convocatoria generada: jornada ${nuevaConvocatoria.jornada} vs ${nuevaConvocatoria.rival} (${nuevaConvocatoria.date}), matchId ${nuevaConvocatoria.matchId}.`
  )
  console.log(
    restantes > 0
      ? `Quedan ${restantes} partido(s) de "${miEquipo}" sin convocatoria. Vuelve a ejecutar el script para generar la siguiente.`
      : `Esa era la última convocatoria pendiente de "${miEquipo}".`
  )
}

generarSiguienteConvocatoria()