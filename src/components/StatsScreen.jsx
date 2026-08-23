export default function StatsScreen({ players, events }) {
  const goals = events.filter((e) => e.type === 'gol').length
  const cards = events.filter((e) => e.type === 'tarjeta').length

  const scorers = players
    .map((p) => ({
      ...p,
      goals: events.filter((e) => e.type === 'gol' && e.playerId === p.id).length,
    }))
    .filter((p) => p.goals > 0)
    .sort((a, b) => b.goals - a.goals)

  return (
    <div className="stats">
      <div className="metrics">
        <div className="metric">
          <p className="metric-label">Goles</p>
          <p className="metric-value">{goals}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Tarjetas</p>
          <p className="metric-value">{cards}</p>
        </div>
      </div>
      <p className="hint">Máximos goleadores</p>
      <div className="feed">
        {scorers.length === 0 && <p className="empty">Todavía no hay goles registrados.</p>}
        {scorers.map((p) => (
          <div className="feed-row" key={p.id}>
            <span>{p.name}</span>
            <span className="muted">{p.goals} goles</span>
          </div>
        ))}
      </div>
    </div>
  )
}
