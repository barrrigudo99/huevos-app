import { useEffect, useState } from 'react'
import { saveResultadoPartido } from '../api'

function borradorInicial(resultado) {
  return {
    golesNosotros: resultado?.golesNosotros ?? 0,
    golesRival: resultado?.golesRival ?? 0,
  }
}

// Panel para anotar el resultado final del partido (goles a favor / en
// contra). Se guarda en la propia entrada del partido dentro de
// simulador/estadisticas_personales.json (campo "resultado"), a propósito
// desconectado de simulador/resultados.json: ese archivo alimenta la
// simulación de la clasificación de Marcador y no debe mezclarse con el
// marcador real que anota el entrenador aquí.
//
// Uso:
//   <MatchResultPanel matchId={partido.id} rival={rival} currentUser={currentUser}
//                      resultadoGuardado={resultado} onSaved={refrescar} />
export default function MatchResultPanel({ matchId, rival, currentUser, resultadoGuardado, onSaved }) {
  const [borrador, setBorrador] = useState(() => borradorInicial(resultadoGuardado))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setBorrador(borradorInicial(resultadoGuardado))
  }, [resultadoGuardado, matchId])

  function cambiar(campo, delta) {
    setBorrador((prev) => ({ ...prev, [campo]: Math.max(0, (prev[campo] ?? 0) + delta) }))
  }

  async function handleGuardar() {
    setSaving(true)
    setError('')
    try {
      await saveResultadoPartido(matchId, borrador, currentUser.id)
      await onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stats-panel result-panel">
      <p className="hint">Resultado del partido</p>
      <div className="result-panel-score">
        <div className="stat-stepper">
          <span className="stat-stepper-label">Nosotros</span>
          <button
            type="button"
            className="stat-stepper-btn"
            onClick={() => cambiar('golesNosotros', -1)}
            aria-label="Quitar gol a favor"
          >
            −
          </button>
          <span className="stat-stepper-value">{borrador.golesNosotros}</span>
          <button
            type="button"
            className="stat-stepper-btn"
            onClick={() => cambiar('golesNosotros', 1)}
            aria-label="Añadir gol a favor"
          >
            +
          </button>
        </div>
        <span className="result-panel-sep">–</span>
        <div className="stat-stepper">
          <span className="stat-stepper-label">{rival || 'Rival'}</span>
          <button
            type="button"
            className="stat-stepper-btn"
            onClick={() => cambiar('golesRival', -1)}
            aria-label="Quitar gol al rival"
          >
            −
          </button>
          <span className="stat-stepper-value">{borrador.golesRival}</span>
          <button
            type="button"
            className="stat-stepper-btn"
            onClick={() => cambiar('golesRival', 1)}
            aria-label="Añadir gol al rival"
          >
            +
          </button>
        </div>
      </div>

      {error && <p className="auth-error">{error}</p>}
      <button type="button" className="btn-primary full-width" onClick={handleGuardar} disabled={saving}>
        {saving ? 'Guardando...' : 'Guardar resultado'}
      </button>
    </div>
  )
}
