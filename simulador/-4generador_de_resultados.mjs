// generador_de_resultados.mjs
// Simula resultados para TODOS los partidos de calendario.json que aún no
// tengan resultado en resultados.json. Para los partidos del equipo con
// id 1 (equipos.json), además añade el detalle de jugadores que participaron:
// su información personal completa (de server/db.json) + sus estadísticas de
// ese partido (minutos, goles, asistencias, tarjetas). Solo se puede convocar
// a jugadores que salieron como "Si" en convocatorias.json para ese partido.
//
// Uso (desde simulador/, con equipos.json, calendario.json y convocatorias.json ya generados):
//   node generador_de_resultados.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- CONFIG ----------
const EQUIPOS_PATH = path.join(__dirname, '1_equipos.json')
const CALENDARIO_PATH = path.join(__dirname, '2_calendario.json')
const CONVOCATORIAS_PATH = path.join(__dirname, '3_convocatorias.json')
const DB_PATH = path.join(__dirname, '..', 'server', 'db.json')
const RESULTADOS_PATH = path.join(__dirname, 'resultados.json')
const MI_EQUIPO_ID = 1
const DURACION_PARTIDO_MIN = 50
const POSICIONES_TITULAR = ['POR', 'LAT', 'LAT', 'CEN', 'VOL', 'VOL', 'DEL']
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

function obtenerJugadoresReales() {
  const db = leerJson(DB_PATH, null)
  if (!db || !Array.isArray(db.players)) return []
  return db.players
}

// Elige titulares SOLO entre los jugadores convocados (votaron "Si"), intentando
// cubrir las posiciones del campo; si faltan confirmados, juega con los que haya.
function elegirTitulares(convocados) {
  const disponibles = shuffle(convocados)
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
        id: p.jugador.id,
        name: p.jugador.name,
        positions: p.jugador.positions || [],
        number: p.jugador.number ?? null,
        phone: p.jugador.phone ?? null,
        photo: p.jugador.photo ?? null,
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

function generarJugadoresDelPartido(matchId, jugadoresReales, convocatoriasPorMatch) {
  const convocatoria = convocatoriasPorMatch.get(matchId)
  if (!convocatoria) return null // sin convocatoria registrada para este partido

  const phonesConfirmados = Object.entries(convocatoria.votes || {})
    .filter(([, voto]) => voto === 'Si')
    .map(([phone]) => phone)

  const convocados = jugadoresReales.filter((j) => phonesConfirmados.includes(j.phone))
  if (convocados.length === 0) return []

  const { titulares, suplentesDisponibles } = elegirTitulares(convocados)
  const participantes = simularMinutosYSustituciones(titulares, suplentesDisponibles)
  return participantes
}

function generarResultados() {
  const miEquipo = obtenerNombreMiEquipo()
  const calendario = leerJson(CALENDARIO_PATH, [])
  if (calendario.length === 0) {
    console.error(`No se encontró ${CALENDARIO_PATH} o está vacío. Genera antes el calendario.`)
    process.exit(1)
  }

  const convocatorias = leerJson(CONVOCATORIAS_PATH, [])
  const convocatoriasPorMatch = new Map(convocatorias.map((c) => [c.matchId, c]))
  const jugadoresReales = obtenerJugadoresReales()

  const resultadosExistentes = leerJson(RESULTADOS_PATH, [])
  const idsConResultado = new Set(resultadosExistentes.map((r) => r.id))
  const pendientes = calendario.filter((p) => !idsConResultado.has(p.id))

  if (pendientes.length === 0) {
    console.log('No hay partidos nuevos en el calendario sin resultado.')
    return
  }

  const nuevosResultados = pendientes.map((partido) => {
    const { goles_local, goles_visitante } = simularResultado()
    const ganador =
      goles_local === goles_visitante
        ? 'empate'
        : goles_local > goles_visitante
        ? partido.equipo_local
        : partido.equipo_visitante

    const resultado = {
      id: partido.id,
      jornada: partido.jornada,
      fecha: partido.fecha,
      equipo_local: partido.equipo_local,
      equipo_visitante: partido.equipo_visitante,
      resultado: { goles_local, goles_visitante },
      ganador,
      jugado: true,
    }

    const esMiPartido = partido.equipo_local === miEquipo || partido.equipo_visitante === miEquipo
    if (esMiPartido) {
      const golesDeMiEquipo = partido.equipo_local === miEquipo ? goles_local : goles_visitante
      const participantes = generarJugadoresDelPartido(partido.id, jugadoresReales, convocatoriasPorMatch)

      if (participantes === null) {
        resultado.jugadores = []
        resultado.aviso = 'Sin convocatoria generada para este partido todavía.'
      } else {
        resultado.jugadores = repartirGolesYAsistencias(participantes, golesDeMiEquipo)
      }
    }

    return resultado
  })

  const actualizado = [...resultadosExistentes, ...nuevosResultados]
  escribirJson(RESULTADOS_PATH, actualizado)
  console.log(`${nuevosResultados.length} resultado(s) nuevo(s) añadidos a ${RESULTADOS_PATH}.`)
}

generarResultados()