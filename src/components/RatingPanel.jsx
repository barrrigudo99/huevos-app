import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, Pencil, Redo2, Star, Undo2 } from 'lucide-react'
import { fetchPlayerRatings, savePlayerRatings } from '../api'
import PlayerAvatar from './PlayerAvatar'

// Los 4 criterios. `key` coincide con las columnas de player_ratings y con las
// claves del payload que espera el backend (ver api.savePlayerRatings).
const CRITERIOS = [
  { key: 'impacto', label: 'Impacto', abbr: 'IMP', desc: 'Cómo pesó en el resultado, atacando o defendiendo.' },
  { key: 'esfuerzo', label: 'Esfuerzo', abbr: 'ESF', desc: 'Cuánto se vació físicamente por el equipo.' },
  { key: 'equipo', label: 'Equipo', abbr: 'EQU', desc: 'Jugó para el grupo y no para su lucimiento.' },
  { key: 'liderazgo', label: 'Liderazgo', abbr: 'LID', desc: 'Tiró del equipo más allá de su juego.' },
]

// Los 5 niveles del asistente se guardan como la escala 1..5 de siempre; un
// jugador sin nivel en un criterio viaja como 0 (sin puntuar).
const TIERS = [
  { id: 'sobresaliente', label: 'Sobresaliente', score: 5, accent: '#D8B970' },
  { id: 'notable', label: 'Notable', score: 4, accent: '#C79A63' },
  { id: 'cumplio', label: 'Cumplió', score: 3, accent: '#B7202A' },
  { id: 'discreto', label: 'Discreto', score: 2, accent: '#7A3235' },
  { id: 'flojo', label: 'Flojo', score: 1, accent: '#5A5652' },
]
const TIER_SCORE = TIERS.reduce((acc, t) => ({ ...acc, [t.id]: t.score }), {})
const SCORE_TIER = TIERS.reduce((acc, t) => ({ ...acc, [t.score]: t.id }), {})

const MVP_STEP = CRITERIOS.length
const REVIEW_STEP = CRITERIOS.length + 1
const DONE_STEP = CRITERIOS.length + 2

const key = (critKey, pid) => `${critKey}|${pid}`

// Convierte la respuesta de fetchPlayerRatings ({ ratings: { [pid]: {impacto..} } })
// al mapa de asignaciones "critKey|pid" -> tierId que usa el asistente.
function assignFromRatings(ratingsByPlayer, players) {
  const next = {}
  players.forEach((p) => {
    const r = ratingsByPlayer?.[p.id]
    if (!r) return
    CRITERIOS.forEach((c) => {
      const tier = SCORE_TIER[r[c.key]]
      if (tier) next[key(c.key, p.id)] = tier
    })
  })
  return next
}

// Panel "Valorar partido" — asistente "Foco en el jugador": un criterio cada
// vez, colocando al jugador en un nivel; luego MVP, revisión y envío. Toda la
// lógica de BBDD (fetch/save de player_ratings + MVP) es la de siempre.
export default function RatingPanel({ matchId, playersToRate, currentUser, jornada, rival, onBack }) {
  const [step, setStep] = useState(0)
  const [assign, setAssign] = useState({})
  const [mvpId, setMvpId] = useState(null)
  const [undo, setUndo] = useState([])
  const [redo, setRedo] = useState([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Tope de jugadores por nivel: 3 como en el diseño, pero se ensancha si el
  // equipo es tan grande que 5·3 no daría para colocar a todos.
  const tope = useMemo(
    () => Math.max(3, Math.ceil(playersToRate.length / TIERS.length)),
    [playersToRate.length]
  )

  useEffect(() => {
    if (!matchId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    fetchPlayerRatings(matchId, currentUser.id)
      .then((res) => {
        setAssign(assignFromRatings(res.ratings, playersToRate))
        setMvpId(res.mvpPlayerId ?? null)
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false))
    // playersToRate se deriva de props estables del padre para esta jornada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, currentUser.id])

  const tierOf = (critKey, pid) => assign[key(critKey, pid)] || null
  const membersOf = (critKey, tierId) => playersToRate.filter((p) => tierOf(critKey, p.id) === tierId)
  const poolOf = (critKey) => playersToRate.filter((p) => !tierOf(critKey, p.id))

  function commit(changes) {
    setUndo((u) => [...u, { assign, mvpId }].slice(-40))
    setRedo([])
    if ('assign' in changes) setAssign(changes.assign)
    if ('mvpId' in changes) setMvpId(changes.mvpId)
  }

  function undoAction() {
    if (!undo.length) return
    const prev = undo[undo.length - 1]
    setRedo((r) => [{ assign, mvpId }, ...r].slice(0, 40))
    setUndo((u) => u.slice(0, -1))
    setAssign(prev.assign)
    setMvpId(prev.mvpId)
  }

  function redoAction() {
    if (!redo.length) return
    const nxt = redo[0]
    setUndo((u) => [...u, { assign, mvpId }].slice(-40))
    setRedo((r) => r.slice(1))
    setAssign(nxt.assign)
    setMvpId(nxt.mvpId)
  }

  function place(critKey, pid, tierId) {
    const k = key(critKey, pid)
    const next = { ...assign }
    if (tierId === null) {
      delete next[k]
    } else {
      const inTier = playersToRate.filter(
        (p) => p.id !== pid && assign[key(critKey, p.id)] === tierId
      ).length
      if (inTier >= tope) return
      next[k] = tierId
    }
    commit({ assign: next })
  }

  function tallyOf(pid) {
    const top = CRITERIOS.filter((c) => {
      const t = tierOf(c.key, pid)
      return t === 'sobresaliente' || t === 'notable'
    }).length
    return `${top}/${CRITERIOS.length} alto`
  }

  async function handleEnviar() {
    setSaving(true)
    setSaveError('')
    try {
      const lista = playersToRate.map((p) => {
        const row = { playerId: p.id }
        CRITERIOS.forEach((c) => {
          const t = tierOf(c.key, p.id)
          row[c.key] = t ? TIER_SCORE[t] : 0
        })
        return row
      })
      const res = await savePlayerRatings(
        matchId,
        { ratings: lista, mvpPlayerId: mvpId },
        currentUser.id
      )
      setAssign(assignFromRatings(res.ratings, playersToRate))
      setMvpId(res.mvpPlayerId ?? null)
      setUndo([])
      setRedo([])
      setStep(DONE_STEP)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isCrit = step < CRITERIOS.length
  const isMvp = step === MVP_STEP
  const isReview = step === REVIEW_STEP
  const isDone = step === DONE_STEP
  const crit = isCrit ? CRITERIOS[step] : CRITERIOS[CRITERIOS.length - 1]

  const pool = poolOf(crit.key)
  const hero = isCrit ? pool[0] || null : null
  const placed = playersToRate.length - pool.length
  const critDone = isCrit && pool.length === 0
  const mvpPlayer = playersToRate.find((p) => p.id === mvpId) || null

  const headline = isMvp
    ? 'Elige al MVP'
    : isReview
      ? 'Revisa y envía'
      : isDone
        ? 'Enviado'
        : 'Valora al equipo'

  // --- CTA + botón secundario según el paso ---
  let ctaLabel = ''
  let ctaReady = false
  let onNext = () => {}
  let secondaryLabel = ''
  let onSecondary = () => {}

  if (isCrit) {
    const last = step === CRITERIOS.length - 1
    ctaLabel = critDone
      ? last
        ? 'Elegir MVP'
        : `Siguiente: ${CRITERIOS[step + 1].label}`
      : `Quedan ${pool.length} por valorar`
    ctaReady = critDone
    onNext = () => critDone && setStep(step + 1)
    secondaryLabel = step > 0 ? 'Atrás' : 'Volver a la alineación'
    onSecondary = step > 0 ? () => setStep(step - 1) : onBack
  } else if (isMvp) {
    ctaLabel = mvpId ? 'Revisar valoraciones' : 'Elige un MVP'
    ctaReady = !!mvpId
    onNext = () => mvpId && setStep(REVIEW_STEP)
    secondaryLabel = 'Atrás'
    onSecondary = () => setStep(CRITERIOS.length - 1)
  } else if (isReview) {
    ctaLabel = saving ? 'Enviando…' : 'Enviar valoraciones'
    ctaReady = !saving
    onNext = handleEnviar
    secondaryLabel = 'Atrás'
    onSecondary = () => setStep(MVP_STEP)
  }

  return (
    <div className="rp2">
      <div className="rp2-head">
        <span className="rp2-head-stripe rp2-head-stripe-red" />
        <span className="rp2-head-stripe rp2-head-stripe-gold" />
        <div className="rp2-head-row">
          <div className="rp2-head-titles">
            <span className="rp2-head-eyebrow">
              {jornada ? `J${jornada}` : 'Partido'}
              {rival ? ` · vs ${rival}` : ''}
            </span>
            <span className="rp2-head-title">{headline}</span>
          </div>
          {!isDone && (
            <div className="rp2-head-actions">
              <button
                type="button"
                className="rp2-icon-btn"
                title="Deshacer"
                disabled={!undo.length}
                onClick={undoAction}
              >
                <Undo2 size={15} />
              </button>
              <button
                type="button"
                className="rp2-icon-btn"
                title="Rehacer"
                disabled={!redo.length}
                onClick={redoAction}
              >
                <Redo2 size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && <p className="rp2-msg">Cargando valoraciones…</p>}
      {!loading && loadError && <p className="rp2-msg rp2-msg-error">{loadError}</p>}

      {!loading && !loadError && playersToRate.length === 0 && (
        <div className="rp2-empty">
          <p className="rp2-msg">No hay jugadores convocados para valorar en esta jornada.</p>
          <button type="button" className="rp2-cta-secondary" onClick={onBack}>
            <ChevronLeft size={14} /> Volver a la alineación
          </button>
        </div>
      )}

      {!loading && !loadError && playersToRate.length > 0 && (
        <>
          {isCrit && (
            <>
              <div className="rp2-tabs">
                {CRITERIOS.map((c, i) => {
                  const done = playersToRate.length - poolOf(c.key).length
                  const pct = Math.round((done / playersToRate.length) * 100)
                  const complete = done === playersToRate.length
                  const active = i === step
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`rp2-tab ${active ? 'active' : ''}`}
                      onClick={() => setStep(i)}
                    >
                      <span className="rp2-tab-abbr">{c.abbr}</span>
                      <span className="rp2-tab-bar">
                        <span
                          className="rp2-tab-fill"
                          style={{
                            width: `${pct}%`,
                            background: complete ? '#3FA65C' : '#D8B970',
                          }}
                        />
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="rp2-crit">
                <strong>{crit.label}</strong> — {crit.desc}
              </p>

              {hero ? (
                <div className="rp2-hero">
                  <span className="rp2-hero-stripe rp2-hero-stripe-red" />
                  <span className="rp2-hero-stripe rp2-hero-stripe-gold" />
                  <span className="rp2-hero-num">{hero.number}</span>
                  <div className="rp2-hero-photo">
                    <PlayerAvatar player={hero} size="lg" />
                  </div>
                  <div className="rp2-hero-info">
                    <span className="rp2-hero-name">{hero.name}</span>
                    <span className="rp2-hero-pos">
                      {(hero.positions || []).join(' · ') || '—'}
                    </span>
                    <span className="rp2-hero-progress">
                      {placed + 1} de {playersToRate.length} · quedan {pool.length}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rp2-banner">
                  <CheckCircle2 size={26} />
                  <div className="rp2-banner-text">
                    <span className="rp2-banner-title">{crit.label} completado</span>
                    <span className="rp2-banner-hint">Toca una cabeza para cambiarla de nivel.</span>
                  </div>
                </div>
              )}

              <div className="rp2-tiers">
                {TIERS.map((t, i) => {
                  const members = membersOf(crit.key, t.id)
                  const full = members.length >= tope
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="rp2-tier"
                      data-full={full ? 'true' : 'false'}
                      onClick={() => hero && place(crit.key, hero.id, t.id)}
                    >
                      <span className="rp2-tier-accent" style={{ background: t.accent }} />
                      <span
                        className="rp2-tier-rank"
                        style={{
                          background: members.length ? t.accent : '#1d1b19',
                          color: members.length ? '#050505' : '#8C8783',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="rp2-tier-text">
                        <span className="rp2-tier-label">{t.label}</span>
                        <span className="rp2-tier-hint">
                          {members.length
                            ? members.map((m) => m.name.split(' ')[0]).join(' · ')
                            : full
                              ? 'Completo'
                              : 'Toca para asignar'}
                        </span>
                      </span>
                      <span className="rp2-tier-members">
                        {members.map((m) => (
                          <span
                            key={m.id}
                            role="button"
                            tabIndex={0}
                            className="rp2-tier-member"
                            title={`Quitar a ${m.name.split(' ')[0]} de este nivel`}
                            onClick={(e) => {
                              e.stopPropagation()
                              place(crit.key, m.id, null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation()
                                e.preventDefault()
                                place(crit.key, m.id, null)
                              }
                            }}
                          >
                            <PlayerAvatar player={m} size="sm" fallback="initials" />
                          </span>
                        ))}
                      </span>
                      <span
                        className="rp2-tier-count"
                        style={{ color: full ? '#B7202A' : '#8C8783' }}
                      >
                        {members.length}/{tope}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {isMvp && (
            <div className="rp2-mvp">
              <p className="rp2-msg">Un solo jugador como el más destacado del partido.</p>
              <div className="rp2-mvp-grid">
                {playersToRate.map((p) => {
                  const sel = mvpId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`rp2-mvp-cell ${sel ? 'selected' : ''}`}
                      onClick={() => commit({ mvpId: sel ? null : p.id })}
                    >
                      <span className="rp2-mvp-photo">
                        <PlayerAvatar player={p} size="sm" fallback="initials" />
                      </span>
                      <span className="rp2-mvp-name">{p.name.split(' ')[0]}</span>
                      <span className="rp2-mvp-tally">{tallyOf(p.id)}</span>
                      <Star className="rp2-mvp-star" size={14} style={{ opacity: sel ? 1 : 0 }} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isReview && (
            <div className="rp2-review">
              <p className="rp2-msg">Puedes editar cualquier criterio antes de enviar.</p>
              {CRITERIOS.map((c, i) => {
                const lines = TIERS.map((t) => {
                  const members = membersOf(c.key, t.id)
                  return members.length ? { tier: t, members } : null
                }).filter(Boolean)
                return (
                  <div className="rp2-review-card" key={c.key}>
                    <div className="rp2-review-head">
                      <span className="rp2-review-label">{c.label}</span>
                      <button type="button" className="rp2-edit-btn" onClick={() => setStep(i)}>
                        <Pencil size={12} /> Editar
                      </button>
                    </div>
                    {lines.length === 0 ? (
                      <p className="rp2-review-empty">Sin valorar</p>
                    ) : (
                      lines.map(({ tier, members }) => (
                        <div className="rp2-review-line" key={tier.id}>
                          <span className="rp2-review-tier" style={{ color: tier.accent }}>
                            {tier.label}
                          </span>
                          <span className="rp2-review-avatars">
                            {members.map((m) => (
                              <span className="rp2-review-avatar" key={m.id}>
                                <PlayerAvatar player={m} size="sm" fallback="initials" />
                              </span>
                            ))}
                          </span>
                          <span className="rp2-review-names">
                            {members.map((m) => m.name.split(' ')[0]).join(', ')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
              <div className="rp2-review-mvp">
                <div className="rp2-review-mvp-left">
                  <Star size={15} fill="#D8B970" stroke="none" />
                  <span className="rp2-review-mvp-tag">MVP</span>
                  <span className="rp2-review-mvp-name">
                    {mvpPlayer ? mvpPlayer.name : 'Sin elegir'}
                  </span>
                </div>
                <button type="button" className="rp2-edit-btn" onClick={() => setStep(MVP_STEP)}>
                  <Pencil size={12} /> Editar
                </button>
              </div>
              {saveError && <p className="rp2-msg rp2-msg-error">{saveError}</p>}
            </div>
          )}

          {isDone && (
            <div className="rp2-done">
              <span className="rp2-done-photo">
                {mvpPlayer && <PlayerAvatar player={mvpPlayer} size="lg" />}
              </span>
              <span className="rp2-done-eyebrow">MVP · {jornada ? `J${jornada}` : 'Partido'}</span>
              <span className="rp2-done-name">{mvpPlayer ? mvpPlayer.name : 'Sin elegir'}</span>
              <p className="rp2-done-text">
                Valoraciones enviadas. Se publicarán cuando vote todo el equipo.
              </p>
              <button type="button" className="rp2-done-btn" onClick={onBack}>
                Volver a la alineación
              </button>
            </div>
          )}

          {!isDone && (
            <div className="rp2-cta">
              {secondaryLabel && (
                <button type="button" className="rp2-cta-secondary" onClick={onSecondary}>
                  {secondaryLabel}
                </button>
              )}
              <button
                type="button"
                className={`rp2-cta-primary ${ctaReady ? 'ready' : ''}`}
                disabled={!ctaReady}
                onClick={onNext}
              >
                {ctaLabel}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
