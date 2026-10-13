// Por defecto apunta al backend local (localhost:4000). Para producción
// (Vercel) o para probar desde otro dispositivo a través de un túnel de
// Cloudflare, define VITE_API_URL con el origen del backend (sin "/api",
// p.ej. https://xxxx.trycloudflare.com) y reinicia `npm run dev`/redeploy.
const BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api`

// Sesión guardada al hacer login ({ id, name, email, role, player_id, token }).
export const SESSION_KEY = 'futbol7-session'

// Evento que se lanza cuando el servidor rechaza la sesión (token caducado o
// inválido); App lo escucha para volver al login.
export const SESSION_EXPIRED_EVENT = 'session-expired'

function getSessionToken() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY))?.token || null
  } catch {
    return null
  }
}

async function request(path, { headers, ...options } = {}) {
  const token = getSessionToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (data?.code === 'SESION_INVALIDA') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    // code (p. ej. 'POLL_EXISTS') y status permiten a quien llama distinguir
    // un conflicto que se resuelve confirmando de un error real.
    const err = new Error(data?.error || 'No se pudo conectar con el servidor local.')
    err.code = data?.code
    err.status = res.status
    throw err
  }
  return data
}

export function fetchPlayers() {
  return request('/players')
}

export function addPlayer(player) {
  return request('/players', {
    method: 'POST',
    body: JSON.stringify(player),
  })
}

export function fetchPositions() {
  return request('/positions')
}

export function fetchPlayerProfile(playerId) {
  return request(`/players/${playerId}/profile`)
}

// Histórico de notas por jornada + últimos partidos con nota del jugador.
// Devuelve { evolution: [{ matchday, date, rating, teamRating }], lastMatches: [...] }.
export function fetchRatingsHistory(playerId, season) {
  const qs = season != null ? `?season=${encodeURIComponent(season)}` : ''
  return request(`/players/${playerId}/ratings-history${qs}`)
}

export function updatePlayerProfile(playerId, data) {
  return request(`/players/${playerId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function uploadPlayerPhoto(playerId, photo) {
  return request(`/players/${playerId}/photo`, {
    method: 'POST',
    body: JSON.stringify(photo),
  })
}

export function changePassword(userId, passwords) {
  return request(`/users/${userId}/password`, {
    method: 'PUT',
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

// Si la convocatoria final no está cerrada, el servidor responde 409 con
// code 'CONVOCATORIA_NO_CERRADA' salvo que se pase forzar: true.
export function markMatchAsPlayed(matchId, { forzar = false } = {}) {
  return request(`/calendario/${matchId}/jugado`, {
    method: 'PUT',
    body: JSON.stringify({ forzar }),
  })
}

export function unmarkMatchAsPlayed(matchId) {
  return request(`/calendario/${matchId}/no-jugado`, {
    method: 'PUT',
  })
}

export function updateNextMatch(data) {
  return request('/next-match', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function fetchPollStatus() {
  return request('/next-match/poll', { cache: 'no-store' })
}

// Genera de verdad la encuesta de WhatsApp (Sí/No/Duda) para la jornada
// matchId, vía Whapi.Cloud. Si ya tiene encuesta, el servidor responde 409
// con code 'POLL_EXISTS' salvo que se pase confirmarReemplazo: true.
export function generarInscripcion(matchId, { confirmarReemplazo = false } = {}) {
  return request(`/matchdays/${matchId}/poll`, {
    method: 'POST',
    body: JSON.stringify({ confirmarReemplazo }),
  })
}

// Convocatoria de una jornada: { matchId, status: 'sin_encuesta' |
// 'inscripcion' | 'cerrada', jugado, jugadores: [{ playerId, name, number,
// phone, vote, called }], jugadoresSinTelefono, openedAt, closedAt, ... }.
export function fetchConvocatoria(matchId) {
  return request(`/matchdays/${matchId}/convocatoria`, { cache: 'no-store' })
}

// Guarda la convocatoria final y la deja cerrada. payload: { convocados:
// [playerId], enviarAlGrupo, confirmarEdicionJugado }. Con el partido
// jugado, responde 409 'PARTIDO_JUGADO' salvo confirmarEdicionJugado: true.
export function saveConvocatoria(matchId, payload) {
  return request(`/matchdays/${matchId}/convocatoria`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function reabrirConvocatoria(matchId) {
  return request(`/matchdays/${matchId}/convocatoria/reabrir`, {
    method: 'PUT',
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

// Ranking de la plantilla de la temporada (activa por defecto) para
// TeamRankingCard: [{ id, name, photo, goals, assists, attendancePct, mvps,
// rating }], ordenado por valoración desc.
export function fetchRanking(season) {
  const qs = season != null ? `?season=${encodeURIComponent(season)}` : ''
  return request(`/stats/ranking${qs}`)
}

export function saveEstadisticasPersonalesPartido(matchId, jugadores) {
  return request(`/estadisticas-personales/${matchId}`, {
    method: 'PUT',
    body: JSON.stringify({ jugadores }),
  })
}

// Guarda el resultado final (goles a favor/en contra) de un partido en
// simulador/estadisticas_personales.json, independiente de
// simulador/resultados.json (la simulación de la liga).
export function saveResultadoPartido(matchId, resultado) {
  return request(`/estadisticas-personales/${matchId}/resultado`, {
    method: 'PUT',
    body: JSON.stringify(resultado),
  })
}

export function fetchClub() {
  return request('/club')
}

export function updateClub(data) {
  return request('/club', {
    method: 'PUT',
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
export function fetchPlayerRatings(matchId) {
  return request(`/player-ratings/${matchId}`, {
    cache: 'no-store',
  })
}

// Cuántos convocados de un partido han hecho ya su valoración:
// { total, hechas, pendientes: [playerId] }.
export function fetchProgresoValoraciones(matchId) {
  return request(`/player-ratings/${matchId}/progreso`, {
    cache: 'no-store',
  })
}

// Guarda las valoraciones de este usuario para un partido. `payload` es
// { ratings: [{ playerId, impacto, esfuerzo, equipo, liderazgo }], mvpPlayerId }.
// Un criterio a 0 se guarda como sin puntuar; un jugador con los 4 a 0 pierde
// su fila. mvpPlayerId null quita el voto de MVP.
export function savePlayerRatings(matchId, payload) {
  return request(`/player-ratings/${matchId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
