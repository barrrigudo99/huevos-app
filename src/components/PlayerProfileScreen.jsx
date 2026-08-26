import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { fetchClub, fetchConvocatoriaHistory, fetchPlayerMatchStats } from '../api'
import { positionLabel } from '../data/players'
import { calculateAttendance } from '../utils/attendance'
import PlayerAvatar from './PlayerAvatar'

function calculateAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const dob = new Date(birthDate)
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  return age
}

export default function PlayerProfileScreen({ player, onBack }) {
  const [clubName, setClubName] = useState('')
  const [history, setHistory] = useState([])
  const [playerMatchStats, setPlayerMatchStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([fetchClub(), fetchConvocatoriaHistory(), fetchPlayerMatchStats()])
      .then(([club, hist, stats]) => {
        setClubName(club?.name || '')
        setHistory(hist)
        setPlayerMatchStats(stats)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const age = calculateAge(player.birthDate)

  const { pct: attendancePct } = calculateAttendance(player, history)

  const stats = playerMatchStats[player.id] || {}
  const goals = stats.goles || 0
  const assists = stats.asistencias || 0
  const yellowCards = stats.tarjetasAmarillas || 0
  const redCards = stats.tarjetasRojas || 0

  return (
    <div className="stats">
      <button className="btn-outline small" onClick={onBack}>
        <ChevronLeft size={14} /> Volver a la plantilla
      </button>

      <div className="row" style={{ margin: '12px 0 0' }}>
        <PlayerAvatar player={player} size="lg" />
        <div className="row-info">
          <p className="hint" style={{ margin: 0 }}>
            {player.name}
          </p>
          <p className="row-subtitle">
            {clubName || 'Club sin configurar'} ·{' '}
            {(player.positions || []).length > 0 ? player.positions.map(positionLabel).join(' · ') : 'Sin posición'}
          </p>
        </div>
      </div>

      {loading && <p className="hint">Cargando datos...</p>}
      {error && <p className="auth-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="metrics">
            <div className="metric">
              <p className="metric-label">Edad</p>
              <p className="metric-value">{age !== null ? age : '—'}</p>
            </div>
            <div className="metric">
              <p className="metric-label">% convocatorias "Sí"</p>
              <p className="metric-value">{attendancePct !== null ? `${attendancePct}%` : '—'}</p>
            </div>
            <div className="metric">
              <p className="metric-label">Goles</p>
              <p className="metric-value">{goals}</p>
            </div>
            <div className="metric">
              <p className="metric-label">Asistencias</p>
              <p className="metric-value">{assists}</p>
            </div>
          </div>

          <p className="hint">Tarjetas</p>
          <div className="feed">
            <div className="feed-row">
              <span>Amarillas</span>
              <span className="muted">{yellowCards}</span>
            </div>
            <div className="feed-row">
              <span>Rojas</span>
              <span className="muted">{redCards}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
