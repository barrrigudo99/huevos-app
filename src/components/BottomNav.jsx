import { User, Trophy, BarChart2 } from 'lucide-react'
import plantillaIcon from './icons/icon_1024.ico'

const ITEMS = [
  { key: 'plantilla', label: 'Plantilla', icon: <img src={plantillaIcon} alt="" className="nav-icon-img" /> },
  { key: 'perfil', label: 'Perfil', icon: <User size={20} /> },
  { key: 'marcador', label: 'Marcador', icon: <Trophy size={20} /> },
  { key: 'stats', label: 'Stats', icon: <BarChart2 size={20} /> },
]

export default function BottomNav({ screen, setScreen }) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ key, label, icon }) => (
        <button
          key={key}
          className={`nav-btn ${screen === key ? 'active' : ''}`}
          onClick={() => setScreen(key)}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
