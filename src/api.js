const BASE = '/api'

async function request(path, { headers, ...options } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || 'No se pudo conectar con el servidor local.')
  }
  return data
}

export function fetchPlayers() {
  return request('/players')
}

export function addPlayer(player, userId) {
  return request('/players', {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(player),
  })
}

export function registerUser(user) {
  return request('/register', { method: 'POST', body: JSON.stringify(user) })
}

export function loginUser(credentials) {
  return request('/login', { method: 'POST', body: JSON.stringify(credentials) })
}

export function fetchNextMatch() {
  return request('/next-match')
}

export function updateNextMatch(data, userId) {
  return request('/next-match', {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(data),
  })
}

export function fetchPollStatus() {
  return request('/next-match/poll', { cache: 'no-store' })
}

export function fetchLeague() {
  return request('/league')
}

export function fetchClub() {
  return request('/club')
}

export function updateClub(data, userId) {
  return request('/club', {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(data),
  })
}

export function fetchMatchEvents() {
  return request('/match-events')
}

export function addMatchEvent(matchId, data, userId) {
  return request(`/match-events/${matchId}`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(data),
  })
}

export function deleteMatchEvent(matchId, eventId, userId) {
  return request(`/match-events/${matchId}/${eventId}`, {
    method: 'DELETE',
    headers: { 'X-User-Id': userId },
  })
}

export function fetchConvocatoriaHistory() {
  return request('/convocatoria-history')
}

export function fetchCalendario() {
  return request('/calendario')
}

export function fetchConvocatoriaPorFecha(fecha) {
  return request(`/convocatoria-por-fecha?fecha=${encodeURIComponent(fecha)}`, { cache: 'no-store' })
}
