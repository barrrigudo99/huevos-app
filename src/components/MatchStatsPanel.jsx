import { useEffect, useState } from 'react'
import { markMatchAsPlayed, saveEstadisticasPersonalesPartido } from '../api'
import PlayerAvatar from './PlayerAvatar'

// Construye el estado editable a partir de lo ya guardado en
// estadisticas_personales.json para este partido (un objeto por jugador con
// id/goles/asistencias/amarillas/tarjetaRoja, o ninguno si el jugador no
// tiene nada registrado todavía).
function borradorInicial(jugadoresGuardados, players) {
  const guardadoPorId = new Map(jugadoresGuardados.map((j) => [j.id, j]))
  const borrador = {}
  players.forEach((p) => {
    const guardado = guardadoPorId.get(p.id)
    const amarillas = guardado
      ? Math.min(2, typeof guardado.amarillas === 'number' ? guardado.amarillas : guardado.tarjetaAmarilla ? 1 : 0)
      : 0
    const rojaGuardada = guardado?.tarjetaRoja || false
    borrador[p.id] = {
      goles: guardado?.goles || 0,
      asistencias: guardado?.asistencias || 0,
      amarillas,
      // Si ya había roja guardada pero con menos de 2 amarillas, era una
      // roja directa (manual). Si había 2 amarillas, la roja ya viene
      // implícita y no hace falta marcarla aparte.
      rojaManual: rojaGuardada && amarillas < 2,
    }
  })
  return borrador
}

function esExpulsado(cambios) {
  return cambios.amarillas >= 2 || cambios.rojaManual
}

// Panel para introducir de golpe las estadísticas de todos los jugadores de
// un partido (goles, asistencias, amarillas, roja), en vez de tener que
// añadir un suceso cada vez. Contempla la doble amarilla: al llegar a la
// segunda amarilla, el jugador queda expulsado igual que con una roja
// directa.
//
// Al guardar, envía de golpe la lista de jugadores con algo que reportar a
// PUT /api/estadisticas-personales/:matchId, que sustituye por completo las
// estadísticas guardadas de ese partido en simulador/estadisticas_personales.json
// — el mismo archivo que usan "Máximos goleadores" (StatsScreen) y el perfil
// de cada jugador (vía /api/player-match-stats), así que guardar aquí las
// actualiza automáticamente.
//
// Uso:
//   <MatchStatsPanel matchId={partido.id} players={players} currentUser={currentUser}
//                     jugadoresGuardados={jugadores} onSaved={refrescar} />
export default function MatchStatsPanel({ matchId, players, currentUser, jugadoresGuardados, calledPlayerIds, jugado, onMarked, onSaved }) {
  const [borrador, setBorrador] = useState(() => borradorInicial(jugadoresGuardados, players))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [marking, setMarking] = useState(false)
  const [markError, setMarkError] = useState('')

  useEffect(() => {
    setBorrador(borradorInicial(jugadoresGuardados, players))
  }, [jugadoresGuardados, players])

  useEffect(() => {
    setMarkError('')
  }, [matchId])

  async function handleMarcarJugado() {
    setMarking(true)
    setMarkError('')
    try {
      await markMatchAsPlayed(matchId, currentUser.id)
      onMarked?.()
    } catch (err) {
      setMarkError(err.message)
    } finally {
      setMarking(false)
    }
  }

  function cambiarContador(playerId, campo, delta, max = Infinity) {
    setBorrador((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [campo]: Math.min(max, Math.max(0, (prev[playerId]?.[campo] ?? 0) + delta)),
      },
    }))
  }

  function alternarRojaManual(playerId) {
    setBorrador((prev) => {
      const actual = prev[playerId]
      // Con 2 amarillas la expulsión ya está implícita: el botón de roja no
      // hace nada mientras no se baje de 2 amarillas.
      if (actual?.amarillas >= 2) return prev
      return { ...prev, [playerId]: { ...actual, rojaManual: !actual?.rojaManual } }
    })
  }

  async function handleGuardar() {
    setSaving(true)
    setError('')
    try {
      const jugadoresAGuardar = players
        .map((p) => {
          const d = borrador[p.id]
          if (!d) return null
          const roja = esExpulsado(d)
          if (d.goles === 0 && d.asistencias === 0 && d.amarillas === 0 && !roja) return null
          return {
            playerId: p.id,
            goles: d.goles,
            asistencias: d.asistencias,
            amarillas: d.amarillas,
            roja,
          }
        })
        .filter(Boolean)

      await saveEstadisticasPersonalesPartido(matchId, jugadoresAGuardar, currentUser.id)
      await onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Solo afecta a qué filas se pintan; borradorInicial/handleGuardar siguen
  // trabajando sobre `players` completo para no borrar stats ya guardadas
  // de un jugador que ahora queda oculto por no haber votado "Sí".
  const jugadoresVisibles = calledPlayerIds ? players.filter((p) => calledPlayerIds.has(p.id)) : players

  return (
    <div className="stats-panel">
      {jugado && (
        <>
          {calledPlayerIds === null && <p className="hint">Cargando convocatoria...</p>}
          {calledPlayerIds !== null && jugadoresVisibles.length === 0 && (
            <p className="empty">Nadie confirmó asistencia a este partido.</p>
          )}
          {jugadoresVisibles.map((p) => {
            const d = borrador[p.id] || { goles: 0, asistencias: 0, amarillas: 0, rojaManual: false }
            const dobleAmarilla = d.amarillas >= 2
            const expulsado = esExpulsado(d)
            return (
              <div className="stats-panel-row" key={p.id}>
                <div className="stats-panel-player">
                  <PlayerAvatar player={p} size="sm" />
                  <span className="stats-panel-name">{p.name}</span>
                  <span className="stats-panel-number">{p.number}</span>
                </div>
                <div className="stats-panel-controls">
                  <div className="stat-stepper">
                    <span className="stat-stepper-label">Goles</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'goles', -1)}
                      aria-label={`Quitar gol a ${p.name}`}
                    >
                      −
                    </button>
                    <span className="stat-stepper-value">{d.goles}</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'goles', 1)}
                      aria-label={`Añadir gol a ${p.name}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="stat-stepper">
                    <span className="stat-stepper-label">Asist.</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'asistencias', -1)}
                      aria-label={`Quitar asistencia a ${p.name}`}
                    >
                      −
                    </button>
                    <span className="stat-stepper-value">{d.asistencias}</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'asistencias', 1)}
                      aria-label={`Añadir asistencia a ${p.name}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="stat-stepper">
                    <span className="stat-stepper-label">Amar.</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'amarillas', -1, 2)}
                      aria-label={`Quitar amarilla a ${p.name}`}
                    >
                      −
                    </button>
                    <span className="stat-stepper-value">{d.amarillas}</span>
                    <button
                      type="button"
                      className="stat-stepper-btn"
                      onClick={() => cambiarContador(p.id, 'amarillas', 1, 2)}
                      aria-label={`Añadir amarilla a ${p.name}`}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`card-toggle card-toggle-roja ${expulsado ? 'active' : ''} ${dobleAmarilla ? 'implicit' : ''}`}
                    onClick={() => alternarRojaManual(p.id)}
                    title={dobleAmarilla ? 'Expulsado por doble amarilla' : 'Tarjeta roja directa'}
                  >
                    {dobleAmarilla ? '2A' : 'R'}
                  </button>
                </div>
              </div>
            )
          })}

          {error && <p className="auth-error">{error}</p>}
          <button type="button" className="btn-primary full-width" onClick={handleGuardar} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar estadísticas'}
          </button>
        </>
      )}

      {markError && <p className="auth-error">{markError}</p>}
      <button type="button" className="btn-outline full-width" onClick={handleMarcarJugado} disabled={marking || jugado}>
        {marking ? 'Marcando...' : jugado ? 'Partido marcado como jugado' : 'Marcar partido como jugado'}
      </button>
    </div>
  )
}
