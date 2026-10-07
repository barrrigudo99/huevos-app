import PlayerAvatar from './PlayerAvatar'
import golIcon from './icons/gol.png'
import asistenciaIcon from './icons/asistencia.png'
import tarjetaAmarillaIcon from './icons/tarjeta_amarilla.png'
import tarjetaRojaIcon from './icons/tarjeta_roja.png'
import dobleAmarillaIcon from './icons/doble_amarilla.png'

// Iconos de las acciones que se pintan en la placa de la carta. La roja directa
// y la doble amarilla comparten tarjetaRoja=true en los datos (ver esExpulsado
// en MatchStatsPanel); amarillas distingue cuál de las dos fue.
function statsToIcons(stats) {
  if (!stats) return []
  const icons = []
  if (stats.goles > 0) icons.push({ src: golIcon, alt: 'Gol', n: stats.goles })
  if (stats.asistencias > 0) icons.push({ src: asistenciaIcon, alt: 'Asistencia', n: stats.asistencias })
  if (stats.amarillas >= 2) icons.push({ src: dobleAmarillaIcon, alt: 'Doble amarilla', n: 1, card: true })
  else if (stats.tarjetaRoja) icons.push({ src: tarjetaRojaIcon, alt: 'Tarjeta roja', n: 1, card: true })
  else if (stats.amarillas === 1) icons.push({ src: tarjetaAmarillaIcon, alt: 'Tarjeta amarilla', n: 1, card: true })
  return icons
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// Carta tipo "cromo" de un jugador: zona de foto con dorsal y estado, y placa
// inferior con nombre, posición y los iconos de sus acciones en el partido.
// onPointerDown (opcional) la hace arrastrable en la pizarra.
export default function LineupCard({
  player,
  pos,
  offPosition = false,
  stats = null,
  showStatus = false,
  statsLoading = false,
  onPointerDown,
  className = '',
}) {
  const icons = statsToIcons(stats)
  return (
    <div
      className={`al-card${onPointerDown ? ' al-card-draggable' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={onPointerDown}
      title={offPosition ? `${player.name} (fuera de posición)` : player.name}
    >
      <div className="al-card-photo">
        <span className="al-card-stripe al-card-stripe-red" />
        <span className="al-card-stripe al-card-stripe-gold" />
        <span className="al-card-dorsal">{player.number}</span>
        {showStatus &&
          (offPosition ? (
            <span className="al-card-status al-card-status-off">*</span>
          ) : (
            <span className="al-card-status al-card-status-ok">
              <CheckIcon />
            </span>
          ))}
        <div className="al-card-avatar">
          <PlayerAvatar player={player} fallback="initials" variant="cutout" />
        </div>
      </div>
      <div className="al-card-plate">
        <p className="al-card-name">{player.name.split(' ')[0]}</p>
        <p className="al-card-pos">
          {pos}
          {offPosition ? ' *' : ''}
        </p>
        {statsLoading ? (
          <div className="al-card-icons">
            <span className="al-card-icon-skeleton skeleton" />
          </div>
        ) : (
          icons.length > 0 && (
            <div className="al-card-icons">
              {icons.map((ic, i) => (
                <span key={i} className={`al-card-icon ${ic.card ? 'al-card-icon-card' : ''}`} title={ic.alt}>
                  <img src={ic.src} alt={ic.alt} />
                  {ic.n > 1 && <span className="al-card-mult">×{ic.n}</span>}
                </span>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
