import { markMatchAsPlayed } from '../api'

// Marca un partido como jugado. Si su convocatoria final no está cerrada, el
// servidor responde CONVOCATORIA_NO_CERRADA: se avisa al entrenador y solo
// se fuerza si lo confirma. Devuelve la respuesta del servidor, o null si el
// entrenador cancela (no se ha marcado nada).
export async function marcarJugadoConConfirmacion(matchId, userId) {
  try {
    return await markMatchAsPlayed(matchId, userId)
  } catch (err) {
    if (err.code !== 'CONVOCATORIA_NO_CERRADA') throw err
    const confirmado = window.confirm(
      'La convocatoria final de este partido no está cerrada, así que no tendrá convocados para estadísticas ni ' +
        'asistencia hasta que la guardes desde Plantilla. ¿Marcarlo como jugado igualmente?'
    )
    if (!confirmado) return null
    return markMatchAsPlayed(matchId, userId, { forzar: true })
  }
}
