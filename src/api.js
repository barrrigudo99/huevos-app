// Por defecto apunta al backend local (localhost:4000). Para producción
// (Vercel) o para probar desde otro dispositivo a través de un túnel de
// Cloudflare, define VITE_API_URL con el origen del backend (sin "/api",
// p.ej. https://xxxx.trycloudflare.com) y reinicia `npm run dev`/redeploy.
const BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api`

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

// Próximo partido calculado a partir de simulador/2_calendario.json (el
// siguiente sin jugar), en vez del que se guarda a mano en db.json.
export function fetchNextMatchAuto() {
  return request('/next-match/auto')
}

export function markMatchAsPlayed(matchId, userId) {
  return request(`/calendario/${matchId}/jugado`, {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
  })
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

// Genera de verdad la encuesta de WhatsApp (Sí/No/Duda) para el partido
// configurado como próximo partido, vía Whapi.Cloud.
export function generarInscripcion(userId) {
  return request('/next-match/poll', {
    method: 'POST',
    headers: { 'X-User-Id': userId },
  })
}

export function fetchLeague() {
  return request('/league')
}

export function fetchPlayerMatchStats() {
  return request('/player-match-stats')
}

export function fetchEstadisticasPersonales() {
  return request('/estadisticas-personales')
}

export function saveEstadisticasPersonalesPartido(matchId, jugadores, userId) {
  return request(`/estadisticas-personales/${matchId}`, {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify({ jugadores }),
  })
}

// Guarda el resultado final (goles a favor/en contra) de un partido en
// simulador/estadisticas_personales.json, independiente de
// simulador/resultados.json (la simulación de la liga).
export function saveResultadoPartido(matchId, resultado, userId) {
  return request(`/estadisticas-personales/${matchId}/resultado`, {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(resultado),
  })
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
