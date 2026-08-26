// generador_de_calendario.mjs
// Lee equipos.json y genera el calendario completo de la liga (todos contra
// todos, una vuelta) en calendario.json. Solo crea el calendario -
// fecha, rivales, jornada - sin resultados todavía (jugado: false).
// Para simular resultados de esos partidos, usa aparte generador_de_partidos.mjs
// (o adáptalo para que lea calendario.json en vez de generar equipos random).
//
// Uso:
//   node generador_de_calendario.mjs
//   node generador_de_calendario.mjs --inicio 2026-09-01 --dias 7

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const EQUIPOS_PATH = path.join(__dirname, '1_equipos.json')
const CALENDARIO_PATH = path.join(__dirname, '2_calendario.json')

function leerArgs() {
  const args = process.argv.slice(2)
  const inicioIdx = args.indexOf('--inicio')
  const diasIdx = args.indexOf('--dias')
  const inicio = inicioIdx !== -1 ? args[inicioIdx + 1] : null
  const dias = diasIdx !== -1 ? Number(args[diasIdx + 1]) : 7
  return { inicio, dias }
}

function leerJson(p) {
  if (!fs.existsSync(p)) {
    console.error(`No se encontró ${p}. Genera antes equipos.json.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function escribirJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// Método del círculo: calendario completo de una vuelta (n-1 jornadas, n par)
function generarCalendarioCompleto(nombresEquipos) {
  const lista = [...nombresEquipos]
  const n = lista.length
  if (n < 2 || n % 2 !== 0) {
    console.error('El número de equipos debe ser par y al menos 2.')
    process.exit(1)
  }

  const jornadas = []
  const fijo = lista[0]
  let resto = lista.slice(1)

  for (let ronda = 0; ronda < n - 1; ronda++) {
    const partidos = []
    const orden = [fijo, ...resto]
    for (let i = 0; i < n / 2; i++) {
      const a = orden[i]
      const b = orden[n - 1 - i]
      const local = ronda % 2 === 0 ? a : b
      const visitante = ronda % 2 === 0 ? b : a
      partidos.push({ local, visitante })
    }
    jornadas.push(partidos)
    resto = [resto[resto.length - 1], ...resto.slice(0, -1)]
  }
  return jornadas
}

function sumarDias(fechaBase, dias) {
  const f = new Date(fechaBase)
  f.setDate(f.getDate() + dias)
  return f.toISOString().slice(0, 10)
}

function generarCalendario() {
  const { inicio, dias } = leerArgs()
  const { equipos } = leerJson(EQUIPOS_PATH)

  if (!Array.isArray(equipos) || equipos.length === 0) {
    console.error('equipos.json no tiene un array "equipos" válido.')
    process.exit(1)
  }

  const nombres = equipos.map((e) => e.nombre)
  const jornadas = generarCalendarioCompleto(nombres)

  const fechaInicio = inicio || new Date().toISOString().slice(0, 10)

  let idActual = 1
  const partidos = []

  jornadas.forEach((partidosDeJornada, indiceJornada) => {
    const fecha = sumarDias(fechaInicio, indiceJornada * dias)
    partidosDeJornada.forEach((par) => {
      partidos.push({
        id: idActual++,
        jornada: indiceJornada + 1,
        fecha,
        equipo_local: par.local,
        equipo_visitante: par.visitante,
        resultado: null,
        ganador: null,
        jugado: false,
      })
    })
  })

  escribirJson(CALENDARIO_PATH, partidos)
  console.log(`Calendario generado: ${jornadas.length} jornadas, ${partidos.length} partidos. Guardado en ${CALENDARIO_PATH}.`)
  console.log(`Primer partido: ${fechaInicio}. Un partido por equipo cada ${dias} días.`)
}

generarCalendario()