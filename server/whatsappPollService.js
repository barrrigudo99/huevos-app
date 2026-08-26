const WHAPI_BASE = 'https://gate.whapi.cloud'

export async function fetchPollVotes(messageId) {
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
