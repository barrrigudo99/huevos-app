import PlayerAvatar from './PlayerAvatar'

const POSICIONES = [1, 2, 3, 4, 5]

// Fila de valoración de un jugador para UN criterio: avatar + nombre + dorsal
// y una escala 1..5 con el icono que se le pase (Zap, Flame, Users, Crown...
// según la pestaña activa). Click en la posición N la fija; click en la
// posición ya seleccionada pone el valor a 0 (borra ese criterio).
//
// Uso:
//   <RatingPanelRow player={p} Icon={Zap} value={ratings[p.id].impacto}
//                   onChange={(n) => setCriterio(p.id, n)} disabled={saving} />
export default function RatingPanelRow({ player, Icon, value = 0, onChange, disabled = false }) {
  return (
    <div className="rating-panel-row">
      <div className="rating-panel-player">
        <PlayerAvatar player={player} size="sm" />
        <span className="rating-panel-name">{player.name}</span>
        <span className="rating-panel-number">{player.number}</span>
      </div>
      <div className="rating-stars" role="group" aria-label={`Valoración de ${player.name}`}>
        {POSICIONES.map((n) => {
          const activa = n <= value
          return (
            <button
              key={n}
              type="button"
              className={`rating-star ${activa ? 'active' : ''}`}
              disabled={disabled}
              aria-label={`Poner ${n} de 5 a ${player.name}`}
              aria-pressed={activa}
              onClick={() => onChange?.(value === n ? 0 : n)}
            >
              <Icon size={20} fill={activa ? 'currentColor' : 'none'} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
