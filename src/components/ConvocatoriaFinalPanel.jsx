import { useEffect, useState } from 'react'
import { fetchConvocatoria, reabrirConvocatoria, saveConvocatoria } from '../api'
import PlayerAvatar from './PlayerAvatar'

// Orden de las secciones del panel: los que votaron Sí arriba (marcados por
// defecto), luego Duda, No y sin voto (sin marcar). El voto es solo
// informativo: el entrenador puede convocar a cualquiera.
const SECCIONES = [
  { vote: 'Si', titulo: 'Sí' },
  { vote: 'Duda', titulo: 'Duda' },
  { vote: 'No', titulo: 'No' },
  { vote: null, titulo: 'Sin voto' },
]

function formatFechaHora(ts) {
  if (!ts) return ''
  const d = new Date(String(ts).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Panel para crear/editar la convocatoria final de una jornada (matchId de la
// jornada que se ve en NextMatchCard, nunca el partido activo). Se abre
// dentro de un BottomSheet desde PlantillaScreen, solo para entrenadores.
//
//   <ConvocatoriaFinalPanel matchId={id} players={players} currentUser={user}
//                           onChanged={recargar} onClose={cerrar} />
//
// onChanged se llama tras guardar o reabrir, para que el padre recargue el
// estado del botón y los convocados; onClose cierra el sheet tras guardar
// sin avisos.
export default function ConvocatoriaFinalPanel({ matchId, players, currentUser, onChanged, onClose }) {
  const [conv, setConv] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [enviarAlGrupo, setEnviarAlGrupo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (!matchId) return
    setLoading(true)
    setError('')
    fetchConvocatoria(matchId)
      .then((res) => {
        setConv(res)
        setSeleccion(new Set(res.jugadores.filter((j) => j.called).map((j) => j.playerId)))
      })
      .catch((err) => {
        setConv(null)
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [matchId, recarga])

  function alternar(playerId) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  async function handleGuardar() {
    if (!conv) return
    if (
      conv.jugado &&
      !window.confirm(
        'El partido ya está jugado. Cambiar la convocatoria modifica el % de asistencia del ranking. ¿Continuar?'
      )
    ) {
      return
    }
    setSaving(true)
    setSaveError('')
    setAviso('')
    try {
      const res = await saveConvocatoria(
        matchId,
        { convocados: [...seleccion], enviarAlGrupo, confirmarEdicionJugado: conv.jugado },
        currentUser.id
      )
      setConv(res)
      setSeleccion(new Set(res.jugadores.filter((j) => j.called).map((j) => j.playerId)))
      setEnviarAlGrupo(false)
      onChanged?.(res)
      if (res.aviso) setAviso(res.aviso)
      else onClose?.()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleReabrir() {
    setSaving(true)
    setSaveError('')
    setAviso('')
    try {
      await reabrirConvocatoria(matchId, currentUser.id)
      onChanged?.()
      setRecarga((n) => n + 1)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="hint">Cargando convocatoria...</p>

  if (error) {
    return (
      <div className="cf-panel">
        <p className="auth-error">{error}</p>
        <button type="button" className="btn-outline" onClick={() => setRecarga((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    )
  }

  if (!conv || conv.status === 'sin_encuesta') {
    return <p className="hint">Primero genera la inscripción de esta jornada.</p>
  }

  const cerrada = conv.status === 'cerrada'
  const sinTelefono = new Set(conv.jugadoresSinTelefono || [])
  const playerById = new Map(players.map((p) => [p.id, p]))

  return (
    <div className="cf-panel">
      <p className="hint">
        {cerrada
          ? `Convocatoria cerrada${conv.closedAt ? ` el ${formatFechaHora(conv.closedAt)}` : ''}.`
          : 'Inscripción abierta. Los que votaron Sí vienen marcados; puedes convocar a cualquiera.'}
        {conv.jugado && ' El partido ya está jugado.'}
      </p>

      {SECCIONES.map(({ vote, titulo }) => {
        const jugadores = conv.jugadores.filter((j) => (j.vote ?? null) === vote)
        if (jugadores.length === 0) return null
        return (
          <section key={titulo} className="cf-section">
            <p className="cf-section-title">
              {titulo} <span className="cf-section-count">{jugadores.length}</span>
            </p>
            {jugadores.map((j) => {
              const marcado = seleccion.has(j.playerId)
              return (
                <label key={j.playerId} className={`card row cf-row${marcado ? ' cf-row-selected' : ''}`}>
                  <PlayerAvatar player={playerById.get(j.playerId) || { name: j.name }} />
                  <div className="row-info">
                    <p className="row-title">{j.name}</p>
                    {sinTelefono.has(j.playerId) && <p className="row-subtitle">Sin teléfono: no puede votar</p>}
                  </div>
                  <span className="row-number">{j.number || ''}</span>
                  <input
                    type="checkbox"
                    className="cf-check"
                    checked={marcado}
                    onChange={() => alternar(j.playerId)}
                    aria-label={`Convocar a ${j.name}`}
                  />
                </label>
              )
            })}
          </section>
        )
      })}

      <div className="cf-footer">
        <p className="cf-count">
          {seleccion.size} convocado{seleccion.size === 1 ? '' : 's'}
        </p>
        <label className="cf-send">
          <input type="checkbox" checked={enviarAlGrupo} onChange={(e) => setEnviarAlGrupo(e.target.checked)} />
          Enviar lista al grupo
        </label>
        {saveError && <p className="auth-error">{saveError}</p>}
        {aviso && <p className="auth-error">{aviso}</p>}
        <button type="button" className="btn-primary full-width" onClick={handleGuardar} disabled={saving}>
          {saving ? 'Guardando...' : cerrada ? 'Guardar cambios' : 'Guardar convocatoria final'}
        </button>
        {cerrada && !conv.jugado && (
          <button type="button" className="btn-outline full-width" onClick={handleReabrir} disabled={saving}>
            Reabrir inscripción
          </button>
        )}
      </div>
    </div>
  )
}
