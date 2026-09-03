const WHAPI_BASE = 'https://gate.whapi.cloud'

// Modo simulación de votos: si WHAPI_MOCK_VOTES está definida, fetchPollVotes
// devuelve estos votos sin llamar a Whapi.Cloud para nada (ni falta hace un
// messageId real). Único punto de la app que decide esto — antes también
// vivía por su cuenta en server/index.js (votosSimulados) y en dos endpoints
// que lo comprobaban aparte, así que podía quedar desincronizado con
// archivarVotos (que llamaba siempre a la API real). Valores de
// WHAPI_MOCK_VOTES:
//   'all-si'                 -> todos los jugadores con teléfono => 'Si'
//   '34600...,34611...'      -> esos teléfonos => 'Si' (el resto sin voto)
//   './ruta/votos.json'      -> { "<phone>": "Si"|"No"|"Duda", ... }
//
// Guardarraíl: en producción (NODE_ENV=production) el mock queda siempre
// desactivado, aunque WHAPI_MOCK_VOTES esté definida en el entorno — para
// que una variable olvidada en un despliegue real no pueda contaminar
// call_ups con votos falsos.
export function isMockVotesActive() {
  return Boolean(process.env.WHAPI_MOCK_VOTES) && process.env.NODE_ENV !== 'production'
}

// 'all-si' necesita la lista de teléfonos de la plantilla, que vive en
// Supabase — este módulo no conoce Supabase, así que server/index.js
// registra aquí cómo conseguirla en vez de que este archivo importe el
// cliente de Supabase directamente.
let obtenerTelefonosPlantilla = async () => []
export function setMockPlayerPhonesProvider(fn) {
  obtenerTelefonosPlantilla = fn
}

async function resolverVotosSimulados() {
  const raw = process.env.WHAPI_MOCK_VOTES
  if (raw === 'all-si') {
    const phones = await obtenerTelefonosPlantilla()
    return Object.fromEntries(phones.map((phone) => [phone, 'Si']))
  }
  if (raw.endsWith('.json')) {
    const fs = await import('node:fs/promises')
    return JSON.parse(await fs.readFile(raw, 'utf8'))
  }
  return Object.fromEntries(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((phone) => [phone, 'Si'])
  )
}

export async function fetchPollVotes(messageId) {
  if (isMockVotesActive()) {
    return resolverVotosSimulados()
  }

  if (!messageId) {
    throw new Error('No hay ninguna encuesta de WhatsApp configurada para este partido.')
  }

  const token = process.env.WHAPI_TOKEN
  if (!token) {
    throw new Error('Falta configurar WHAPI_TOKEN en el servidor.')
  }

  let res
  try {
    res = await fetch(`${WHAPI_BASE}/messages/${encodeURIComponent(messageId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('No se pudo conectar con Whapi.Cloud.')
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error?.message || `Whapi respondió con error (${res.status}).`)
  }

  const poll = data?.poll
  if (!poll || !Array.isArray(poll.results)) {
    throw new Error('La respuesta de Whapi no contiene una encuesta válida.')
  }

  const votes = {}
  for (const option of poll.results) {
    for (const voter of option.voters || []) {
      votes[voter] = option.name
    }
  }
  return votes
}

// Crea una encuesta real de WhatsApp (Si/No/Duda por defecto) vía
// Whapi.Cloud y devuelve el id del mensaje creado, que luego se usa con
// fetchPollVotes(messageId) para consultar los votos. Las opciones van SIN
// tilde ("Si", no "Sí"): Whapi devuelve el nombre de la opción tal cual se
// envió, y todo el resto de la app (voteStatusClass, useConvocatoria,
// NextMatchCard, AlineacionScreen, attendance.js) compara los votos contra
// el literal 'Si' sin tilde — con tilde el voto nunca haría match y el
// punto de estado se quedaría siempre en gris aunque el jugador votara sí.
export async function createPollMessage({ title, options = ['Si', 'No', 'Duda'] }) {
  const token = process.env.WHAPI_TOKEN
  const to = process.env.WHAPI_TO
  if (!token) {
    throw new Error('Falta configurar WHAPI_TOKEN en el servidor.')
  }
  if (!to) {
    throw new Error('Falta configurar WHAPI_TO en el servidor.')
  }

  let res
  try {
    res = await fetch(`${WHAPI_BASE}/messages/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, title, options, count: 1 }),
    })
  } catch {
    throw new Error('No se pudo conectar con Whapi.Cloud.')
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error?.message || `Whapi respondió con error (${res.status}) al crear la encuesta.`)
  }

  // Whapi.Cloud puede devolver el id en distintos campos según la versión de
  // la API; probamos las formas más habituales.
  const messageId = data?.message?.id || data?.id
  if (!messageId) {
    throw new Error('Whapi.Cloud no devolvió un id de mensaje reconocible al crear la encuesta.')
  }
  return messageId
}
