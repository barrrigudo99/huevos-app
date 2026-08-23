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
