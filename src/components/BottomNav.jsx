import { Users, LayoutGrid, Trophy, BarChart2 } from 'lucide-react'

const ITEMS = [
  { key: 'plantilla', label: 'Plantilla', Icon: Users },
  { key: 'alineacion', label: 'Once', Icon: LayoutGrid },
  { key: 'marcador', label: 'Marcador', Icon: Trophy },
  { key: 'stats', label: 'Stats', Icon: BarChart2 },
]

export default function BottomNav({ screen, setScreen }) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`nav-btn ${screen === key ? 'active' : ''}`}
          onClick={() => setScreen(key)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
