export function calculateAttendance(player, history) {
  const total = history.length
  const attended = history.filter((h) => player.phone && h.votes?.[player.phone] === 'Si').length
  const pct = total > 0 ? Math.round((attended / total) * 100) : null
  return { total, attended, pct }
}
