import { useState } from 'react'

function initials(name) {
  return (name || '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default function PlayerAvatar({ player, size, fallback = 'initials' }) {
  const [failed, setFailed] = useState(false)
  const showPhoto = player.photo && !failed
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
