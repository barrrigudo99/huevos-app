import { useMemo, useState } from 'react'
import PlayerAvatar from './PlayerAvatar'

/**
 * Ranking de plantilla — sustituye a la lista `scorers-card` de StatsScreen.
 *
 * Espera un array `rows` con una entrada por jugador:
 *   { id, name, photo, goals, assists, attendancePct, mvps, rating }
 * `rating` es la media de los 4 atributos valorables (esfuerzo, equipo,
 * liderazgo, impacto) — null si el jugador aún no tiene votos.
 *
 * De dónde sale cada dato en la BBDD:
 *   goals / assists  -> season_player_stats.total_goals / total_assists
 *   attendancePct    -> season_call_up_attendance.attendance_pct
 *   mvps             -> COUNT sobre match_mvp_votes agrupado por ganador de cada partido
 *   rating           -> (avg_impacto + avg_esfuerzo + avg_equipo + avg_liderazgo) / 4
 *                       de season_player_stats
 */

const C = {
  ink: '#0A0A0A',
  line: '#1c1c1c',
  border: '#262626',
  chip: '#303030',
  sand: '#faf7f2',
  gold: '#eebc59',
  text: 'rgba(242,243,236,0.85)',
  muted: 'rgba(242,243,236,0.72)',
  faint: 'rgba(242,243,236,0.6)',
}

const FONT_DISPLAY = "'Space Grotesk', sans-serif"
const FONT_BODY = "'IBM Plex Sans', sans-serif"

const SORTS = [
  { key: 'rating', chip: 'Valoración', label: 'val.', long: 'valoración' },
  { key: 'goals', chip: 'Goles', label: 'goles', long: 'goles' },
  { key: 'assists', chip: 'Asistencias', label: 'asist.', long: 'asistencias' },
  { key: 'attendancePct', chip: 'Convocatorias', label: 'conv.', long: 'convocatorias' },
  { key: 'mvps', chip: 'MVP', label: 'MVP', long: 'MVP' },
]

const fmtRating = (v) => (v === null || v === undefined ? '—' : v.toFixed(2).replace('.', ','))
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)

function metricValue(row, key) {
  if (key === 'rating') return fmtRating(row.rating)
  if (key === 'attendancePct') return fmtPct(row.attendancePct)
  return row[key] ?? 0
}

export default function TeamRankingCard({ rows = [] }) {
  const [sortKey, setSortKey] = useState('rating')
  const [openId, setOpenId] = useState(null)

  const sort = SORTS.find((s) => s.key === sortKey) || SORTS[0]

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => (b[sortKey] ?? -1) - (a[sortKey] ?? -1) || (b.rating ?? -1) - (a.rating ?? -1)
      ),
    [rows, sortKey]
  )

  if (rows.length === 0) {
    return <p className="empty">Todavía no hay estadísticas registradas.</p>
  }

  return (
    <div style={{ background: C.ink, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px 8px', fontFamily: FONT_BODY }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.sand, letterSpacing: '-0.01em' }}>
          Ranking de plantilla
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.faint }}>
          {rows.length} jugador{rows.length === 1 ? '' : 'es'}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {SORTS.map((s) => {
          const active = s.key === sortKey
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setSortKey(s.key)
                setOpenId(null)
              }}
              style={{
                fontFamily: FONT_BODY,
                fontSize: 11,
                padding: '5px 11px',
                borderRadius: 99,
                background: active ? C.gold : 'transparent',
                border: `1px solid ${active ? C.gold : C.chip}`,
                color: active ? C.ink : C.muted,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {s.chip}
            </button>
          )
        })}
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 10.5, color: C.faint }}>
        Ordenado por <span style={{ color: C.gold }}>{sort.long}</span> · toca un jugador para ver el resto
      </p>

      {sorted.map((row, i) => {
        const open = openId === row.id
        return (
          <div key={row.id} style={{ borderBottom: `1px solid ${C.line}` }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(open ? null : row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenId(open ? null : row.id)
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', cursor: 'pointer' }}
            >
              <span
                style={{
                  flex: 'none',
                  width: 20,
                  textAlign: 'right',
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 12,
                  color: 'rgba(242,243,236,0.5)',
                }}
              >
                {i + 1}
              </span>
              <PlayerAvatar player={row} size="sm" />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13.5,
                  color: C.sand,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.name}
              </span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{sort.label}</span>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 15,
                  color: C.gold,
                  minWidth: 38,
                  textAlign: 'right',
                }}
              >
                {metricValue(row, sortKey)}
              </span>
            </div>

            {open && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 6,
                  padding: '4px 0 14px 44px',
                }}
              >
                {[
                  { label: 'Goles', value: row.goals ?? 0 },
                  { label: 'Asist.', value: row.assists ?? 0 },
                  { label: 'Conv.', value: fmtPct(row.attendancePct) },
                  { label: 'MVP', value: row.mvps ?? 0 },
                  { label: 'Val.', value: fmtRating(row.rating), gold: true },
                ].map((cell) => (
                  <div key={cell.label}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 9.5,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: C.faint,
                      }}
                    >
                      {cell.label}
                    </p>
                    <p
                      style={{
                        margin: '3px 0 0',
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 700,
                        fontSize: 14,
                        color: cell.gold ? C.gold : C.sand,
                      }}
                    >
                      {cell.value}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
