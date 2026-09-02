import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import BottomNav from './components/BottomNav'
import LoginScreen from './components/LoginScreen'
import PlantillaScreen from './components/PlantillaScreen'
import PlayerProfileScreen from './components/PlayerProfileScreen'
import MarcadorScreen from './components/MarcadorScreen'
import StatsScreen from './components/StatsScreen'
import { roleLabel } from './data/users'
import { fetchPlayerMatchStats, fetchPlayers } from './api'
import useConvocatoria from './hooks/useConvocatoria'

const TITLES = {
  plantilla: 'Plantilla',
  perfil: 'Perfil',
  marcador: 'Marcador',
  stats: 'Estadísticas',
}

const SESSION_KEY = 'futbol7-session'

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem(SESSION_KEY)
    return saved ? JSON.parse(saved) : null
  })
  const [screen, setScreen] = useState('plantilla')
  const [players, setPlayers] = useState([])
  const [playersError, setPlayersError] = useState('')
  const [playerMatchStats, setPlayerMatchStats] = useState({})
  // Id del partido (de simulador/2_calendario.json) cuyo panel de
  // estadísticas hay que abrir directamente al entrar en StatsScreen, tras
  // pulsar "Anotar estadísticas" en la jornada que se esté viendo en
  // NextMatchCard.
  const [openMatchId, setOpenMatchId] = useState(null)
  const { votes, pollLoading, pollError, pollConfigured } = useConvocatoria()
  // No hay vínculo formal cuenta↔jugador en el backend (users y players son
  // colecciones con ids independientes), así que se empareja por nombre.
  const currentUserPlayer = players.find(
    (p) => p.name.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()
  )

  useEffect(() => {
    if (!currentUser) return
    fetchPlayers()
      .then(setPlayers)
      .catch((err) => setPlayersError(err.message))
    refreshPlayerMatchStats()
  }, [currentUser])

  function refreshPlayerMatchStats() {
    return fetchPlayerMatchStats()
      .then(setPlayerMatchStats)
      .catch(() => {})
  }

  function abrirEstadisticasPartido(matchId) {
    setOpenMatchId(matchId ?? null)
    setScreen('stats')
  }

  function handleLogin(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    setCurrentUser(user)
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setCurrentUser(null)
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">{TITLES[screen]}</span>
        <div className="app-header-right">
          <span className="app-team">
            {currentUser.name} · {roleLabel(currentUser.role)}
          </span>
          <button className="logout-btn" onClick={handleLogout} aria-label="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="app-screen">
        {playersError && <p className="auth-error">{playersError} (¿está arrancado `npm run server`?)</p>}
        {screen === 'plantilla' && (
          <PlantillaScreen
            players={players}
            setPlayers={setPlayers}
            currentUser={currentUser}
            votes={votes}
            pollLoading={pollLoading}
            pollError={pollError}
            pollConfigured={pollConfigured}
            onOpenStats={abrirEstadisticasPartido}
          />
        )}
        {screen === 'perfil' && (
          currentUserPlayer ? (
            <PlayerProfileScreen player={currentUserPlayer} currentUser={currentUser} />
          ) : (
            <p className="hint">
              No se encontró ningún jugador de la plantilla llamado "{currentUser.name}".
            </p>
          )
        )}
        {screen === 'marcador' && <MarcadorScreen />}
        {screen === 'stats' && (
          <StatsScreen
            players={players}
            playerMatchStats={playerMatchStats}
            currentUser={currentUser}
            refreshPlayerMatchStats={refreshPlayerMatchStats}
            openMatchId={openMatchId}
            onOpenMatchHandled={() => setOpenMatchId(null)}
          />
        )}
      </main>
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  )
}
