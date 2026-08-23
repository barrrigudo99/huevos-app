export default function DonutChart({ segments, size = 120 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)

  let acc = 0
  const stops = segments.map((s) => {
    const start = total === 0 ? 0 : (acc / total) * 100
    acc += s.value
    const end = total === 0 ? 0 : (acc / total) * 100
    return `${s.color} ${start}% ${end}%`
  })
  const background = total === 0 ? 'var(--surface-2)' : `conic-gradient(${stops.join(', ')})`

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: size, height: size, background }}>
        <div className="donut-hole" />
      </div>
      <div className="donut-legend">
        {segments.map((s) => (
          <div className="donut-legend-item" key={s.label}>
            <span className="donut-legend-dot" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="muted">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
