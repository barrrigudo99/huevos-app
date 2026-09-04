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

export function fetchPositions() {
  return request('/positions')
}

export function fetchPlayerProfile(playerId) {
  return request(`/players/${playerId}/profile`)
}

export function updatePlayerProfile(playerId, data, userId) {
  return request(`/players/${playerId}`, {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(data),
  })
}

export function uploadPlayerPhoto(playerId, photo, userId) {
  return request(`/players/${playerId}/photo`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(photo),
  })
}

export function changePassword(userId, passwords) {
  return request(`/users/${userId}/password`, {
    method: 'PUT',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(passwords),
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

export function unmarkMatchAsPlayed(matchId, userId) {
  return request(`/calendario/${matchId}/no-jugado`, {
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

export function fetchConvocatoriaHistory() {
  return request('/convocatoria-history')
}

export function fetchCalendario() {
  return request('/calendario')
}

export function fetchConvocatoriaPorFecha(fecha) {
  return request(`/convocatoria-por-fecha?fecha=${encodeURIComponent(fecha)}`, { cache: 'no-store' })
}

export function fetchAsistentesConvocatoria(matchdayId) {
  return request(`/call-ups/${matchdayId}`)
}

// Valoraciones + MVP que ESTE usuario ya ha guardado para un partido:
// { ratings: { [playerId]: { impacto, esfuerzo, equipo, liderazgo } }, mvpPlayerId }.
export function fetchPlayerRatings(matchId, userId) {
  return request(`/player-ratings/${matchId}`, {
    headers: { 'X-User-Id': userId },
    cache: 'no-store',
  })
}

// Guarda las valoraciones de este usuario para un partido. `payload` es
// { ratings: [{ playerId, impacto, esfuerzo, equipo, liderazgo }], mvpPlayerId }.
// Un criterio a 0 se guarda como sin puntuar; un jugador con los 4 a 0 pierde
// su fila. mvpPlayerId null quita el voto de MVP.
export function savePlayerRatings(matchId, payload, userId) {
  return request(`/player-ratings/${matchId}`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(payload),
  })
}
