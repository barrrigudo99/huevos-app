import { useState } from 'react'

function initials(name) {
  return (name || '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

// JPG no tiene transparencia: la foto trae fondo y no puede "salir" del aro.
function isOpaquePhoto(url) {
  return /\.jpe?g($|\?)/i.test(url)
}

export default function PlayerAvatar({ player, size, fallback = 'initials', variant }) {
  const [failed, setFailed] = useState(false)
  const showPhoto = player.photo && !failed

  // variant="cutout": disco con aro y la foto encima, recortada por abajo con
  // la forma del aro para que la cabeza sobresalga (fotos con fondo
  // transparente). Las medidas las pone el contenedor (ver .al-card-avatar).
  if (variant === 'cutout') {
    return (
      <div className={`avatar-cutout${showPhoto && isOpaquePhoto(player.photo) ? ' avatar-cutout-opaque' : ''}`}>
        <div className="avatar-cutout-disc">
          {!showPhoto && fallback !== 'blank' && (
            <span className="avatar-cutout-initials">{initials(player.name)}</span>
          )}
        </div>
        {showPhoto && (
          <div className="avatar-cutout-photo">
            <img src={player.photo} alt={player.name} onError={() => setFailed(true)} />
          </div>
        )}
      </div>
    )
  }

  const className = `avatar${size === 'lg' ? ' avatar-lg' : ''}${size === 'sm' ? ' avatar-sm' : ''}`

  return (
    <div className={className}>
      {showPhoto ? (
        <img src={player.photo} alt={player.name} onError={() => setFailed(true)} />
      ) : fallback === 'blank' ? (
        <div className="avatar-blank" />
      ) : (
        initials(player.name)
      )}
    </div>
  )
}
