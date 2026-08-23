// generador_de_partidos.mjs
// Versión de prueba: lee simulacion_partido.json (en la misma carpeta) y le
// añade UNA jornada nueva cada vez que se ejecuta, siguiendo simulando ahí
// mismo. Para el equipo local, cuando es MI_EQUIPO, genera estadísticas
// individuales (minutos, goles, asistencias, tarjetas) usando la plantilla
// real de server/db.json.
//
// Uso (desde la carpeta simulador/):
//   node generador_de_partidos.mjs
// Cada ejecución añade 6 partidos más a simulacion_partido.json. Vuelve a
// lanzarlo cuantas veces quieras para seguir ampliando la temporada.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- CONFIG: ajusta si tu estructura de carpetas es distinta ----------
const SIMULACION_PATH = path.join(__dirname, 'simulacion_partido.json')
const DB_PATH = path.join(__dirname, '..', 'server', 'db.json') // futbol7-app/server/db.json
const MI_EQUIPO = 'Equipo 1' // <- pon aquí el nombre exacto de tu equipo real
const DURACION_PARTIDO_MIN = 50
const EQUIPOS = Array.from({ length: 12 }, (_, i) => `Equipo ${i + 1}`)
const POSICIONES_TITULAR = ['POR', 'LAT', 'LAT', 'CEN', 'VOL', 'VOL', 'DEL']
const MAX_INTENTOS_JORNADA = 300
// -------------------------------------------------------------------------

function leerJson(p, porDefecto) {
  if (!fs.existsSync(p)) return porDefecto
  const raw = fs.readFileSync(p, 'utf-8').trim()
  if (!raw) return porDefecto
  return JSON.parse(raw)
}

function escribirJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function shuffle(arr) {
  const copia = [...arr]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clavePar(a, b) {
  return [a, b].sort().join('|')
}

// Genera una jornada (6 partidos) evitando repetir enfrentamientos ya jugados.
// Si ya se han jugado todos los cruces posibles, reinicia el historial
// (equivale a empezar una "vuelta" nueva) y sigue generando sin cortar la simulación.
function generarJornadaSinRepetir(equipos, paresJugados) {
  for (let intento = 0; intento < MAX_INTENTOS_JORNADA; intento++) {
    const barajados = shuffle(equipos)
    const partidos = []
    let valido = true

    for (let i = 0; i < barajados.length; i += 2) {
      const a = barajados[i]
      const b = barajados[i + 1]
      if (paresJugados.has(clavePar(a, b))) {
        valido = false
        break
      }
      const local = Math.random() < 0.5 ? a : b
      const visitante = local === a ? b : a
      partidos.push({ local, visitante })
    }

    if (valido) return partidos
  }

  // se agotaron los cruces únicos posibles: empieza una vuelta nueva
  paresJugados.clear()
  return generarJornadaSinRepetir(equipos, paresJugados)
}

function simularResultado() {
  const pesos = [5, 15, 25, 25, 18, 12]
  function golAleatorio() {
    const total = pesos.reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    for (let i = 0; i < pesos.length; i++) {
      if (r < pesos[i]) return i
      r -= pesos[i]
    }
    return pesos.length - 1
  }
  return { goles_local: golAleatorio(), goles_visitante: golAleatorio() }
}

function elegirTitulares(jugadores) {
  const disponibles = shuffle(jugadores)
  const usados = new Set()
  const titulares = []

  for (const pos of POSICIONES_TITULAR) {
    let candidato = disponibles.find((j) => !usados.has(j.id) && (j.positions || []).includes(pos))
    if (!candidato) candidato = disponibles.find((j) => !usados.has(j.id))
    if (candidato) {
      usados.add(candidato.id)
      titulares.push(candidato)
    }
  }
  const suplentesDisponibles = disponibles.filter((j) => !usados.has(j.id))
  return { titulares, suplentesDisponibles }
}

function simularMinutosYSustituciones(titulares, suplentesDisponibles) {
  const enCampo = titulares.map((j) => ({ jugador: j, minutosJugados: DURACION_PARTIDO_MIN }))
  const sustitutos = []
  const numSustituciones = Math.random() < 0.4 ? randInt(1, Math.min(3, suplentesDisponibles.length)) : 0

  for (let i = 0; i < numSustituciones; i++) {
    if (suplentesDisponibles.length === 0) break
    const sale = enCampo[randInt(0, enCampo.length - 1)]
    const entra = suplentesDisponibles.shift()
    if (!entra) break
    const minutoCambio = randInt(20, DURACION_PARTIDO_MIN - 5)
    sale.minutosJugados = minutoCambio
    sustitutos.push({ jugador: entra, minutosJugados: DURACION_PARTIDO_MIN - minutoCambio })
  }

  return [...enCampo, ...sustitutos]
}

function repartirGolesYAsistencias(participantes, golesLocal) {
  const stats = new Map(
    participantes.map((p) => [
      p.jugador.id,
      {
        playerId: p.jugador.id,
        nombre: p.jugador.name,
        minutosJugados: p.minutosJugados,
        goles: 0,
        asistencias: 0,
        tarjetaAmarilla: false,
        tarjetaRoja: false,
      },
    ])
  )

  function pesoPosicion(jugador) {
    if ((jugador.positions || []).includes('DEL')) return 4
    if ((jugador.positions || []).includes('VOL')) return 2
    return 1
  }

  const pool = []
  participantes.forEach((p) => {
    const peso = pesoPosicion(p.jugador)
    for (let i = 0; i < peso; i++) pool.push(p.jugador.id)
  })

  for (let g = 0; g < golesLocal; g++) {
    if (pool.length === 0) break
    const marcadorId = pool[randInt(0, pool.length - 1)]
    stats.get(marcadorId).goles += 1

    if (Math.random() < 0.7) {
      const candidatos = participantes.map((p) => p.jugador.id).filter((id) => id !== marcadorId)
      if (candidatos.length > 0) {
        const asistenteId = candidatos[randInt(0, candidatos.length - 1)]
        stats.get(asistenteId).asistencias += 1
      }
    }
  }

  participantes.forEach((p) => {
    const s = stats.get(p.jugador.id)
    if (Math.random() < 0.08) s.tarjetaAmarilla = true
    else if (Math.random() < 0.01) s.tarjetaRoja = true
  })

  return Array.from(stats.values())
}

function generarEstadisticasLocal(jugadoresReales, golesLocal) {
  const { titulares, suplentesDisponibles } = elegirTitulares(jugadoresReales)
  const participantes = simularMinutosYSustituciones(titulares, suplentesDisponibles)
  return repartirGolesYAsistencias(participantes, golesLocal)
}

function siguienteFecha(ultimaFechaStr, diasEntreJornadas = 7) {
  const base = ultimaFechaStr ? new Date(ultimaFechaStr) : new Date()
  base.setDate(base.getDate() + diasEntreJornadas)
  return base.toISOString().slice(0, 10)
}

function ampliarSimulacion() {
  const partidosExistentes = leerJson(SIMULACION_PATH, [])
  const db = leerJson(DB_PATH, { players: [] })
  const jugadoresReales = db.players || []

  if (jugadoresReales.length === 0) {
    console.warn(`Aviso: no se encontraron jugadores en ${DB_PATH}. Los partidos de ${MI_EQUIPO} se generarán sin estadísticas individuales.`)
  }

  const paresJugados = new Set(
    partidosExistentes.map((p) => clavePar(p.equipo_local, p.equipo_visitante))
  )

  const jornadaNumero = partidosExistentes.length
    ? Math.max(...partidosExistentes.map((p) => p.jornada)) + 1
    : 1

  const partidosDeLaJornada = generarJornadaSinRepetir(EQUIPOS, paresJugados)

  const ultimoId = partidosExistentes.reduce((max, p) => Math.max(max, p.id), 0)
  const ultimaFecha = partidosExistentes.length
    ? partidosExistentes[partidosExistentes.length - 1].fecha
    : null
  const fechaJornada = siguienteFecha(ultimaFecha)

  const nuevosPartidos = partidosDeLaJornada.map((par, i) => {
    const { goles_local, goles_visitante } = simularResultado()
    const ganador =
      goles_local === goles_visitante ? 'empate' : goles_local > goles_visitante ? par.local : par.visitante

    const partido = {
      id: ultimoId + i + 1,
      jornada: jornadaNumero,
      fecha: fechaJornada,
      equipo_local: par.local,
      equipo_visitante: par.visitante,
      resultado: { goles_local, goles_visitante },
      ganador,
      jugado: true,
    }

    if (par.local === MI_EQUIPO && jugadoresReales.length > 0) {
      partido.jugadores_estadisticas = generarEstadisticasLocal(jugadoresReales, goles_local)
    }

    return partido
  })

  const actualizado = [...partidosExistentes, ...nuevosPartidos]
  escribirJson(SIMULACION_PATH, actualizado)
  console.log(`Jornada ${jornadaNumero} generada: ${nuevosPartidos.length} partidos añadidos a ${SIMULACION_PATH}.`)
}

ampliarSimulacion()