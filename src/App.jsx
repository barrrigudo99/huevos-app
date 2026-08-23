import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import BottomNav from './components/BottomNav'
import LoginScreen from './components/LoginScreen'
import PlantillaScreen from './components/PlantillaScreen'
import AlineacionScreen from './components/AlineacionScreen'
import MarcadorScreen from './components/MarcadorScreen'
import StatsScreen from './components/StatsScreen'
import { roleLabel } from './data/users'
import { fetchMatchEvents, fetchPlayers } from './api'
import useConvocatoria from './hooks/useConvocatoria'

const TITLES = {
  plantilla: 'Plantilla',
  alineacion: 'Alineación',
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
  const [matchEvents, setMatchEvents] = useState({})
  const { votes, listaConvocados, pollLoading, pollError, pollConfigured } = useConvocatoria(players)

  useEffect(() => {
    if (!currentUser) return
    fetchPlayers()
      .then(setPlayers)
      .catch((err) => setPlayersError(err.message))
    fetchMatchEvents()
      .then(setMatchEvents)
      .catch(() => {})
  }, [currentUser])

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
            listaConvocados={listaConvocados}
            pollLoading={pollLoading}
            pollError={pollError}
            pollConfigured={pollConfigured}
          />
        )}
        {screen === 'alineacion' && (
          <AlineacionScreen players={players} listaConvocados={listaConvocados} />
        )}
        {screen === 'marcador' && <MarcadorScreen players={players} currentUser={currentUser} />}
        {screen === 'stats' && (
          <StatsScreen players={players} events={Object.values(matchEvents).flat()} />
        )}
      </main>
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  )
}
