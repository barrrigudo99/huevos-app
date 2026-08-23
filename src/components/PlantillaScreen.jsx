import { useEffect, useState } from 'react'
import { POSITIONS, positionLabel } from '../data/players'
import { OUR_TEAM } from '../data/league'
import {
  addPlayer,
  fetchCalendario,
  fetchClub,
  fetchConvocatoriaPorFecha,
  fetchNextMatch,
  updateClub,
  updateNextMatch,
} from '../api'
import PlayerProfileScreen from './PlayerProfileScreen'
import PlayerAvatar from './PlayerAvatar'

function voteStatusClass(vote) {
  if (vote === 'Si') return 'status-dot-green'
  if (vote === 'No') return 'status-dot-red'
  return 'status-dot-gray'
}

function voteStatusTitle(vote) {
  if (vote === 'Si') return 'Ha confirmado asistencia'
  if (vote === 'No') return 'Ha dicho que no'
  return 'No ha votado todavía'
}

function rivalDe(partido) {
  return partido.equipo_local === OUR_TEAM ? partido.equipo_visitante : partido.equipo_local
}

function formatFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-ES')
}

export default function PlantillaScreen({
  players,
  setPlayers,
  currentUser,
  votes,
  pollLoading,
  pollError,
  pollConfigured,
}) {
  const isEntrenador = currentUser.role === 'entrenador'

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', positions: [], number: '', phone: '', birthDate: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [selectedPlayer, setSelectedPlayer] = useState(null)

  const [nextMatch, setNextMatch] = useState(null)
  const [showMatchForm, setShowMatchForm] = useState(false)
  const [matchForm, setMatchForm] = useState({ rival: '', date: '', whatsappPollId: '' })
  const [matchSaving, setMatchSaving] = useState(false)
  const [matchError, setMatchError] = useState('')

  const [club, setClub] = useState(null)
  const [showClubForm, setShowClubForm] = useState(false)
  const [clubForm, setClubForm] = useState({ name: '' })
  const [clubSaving, setClubSaving] = useState(false)
  const [clubError, setClubError] = useState('')

  const [calendario, setCalendario] = useState([])
  const [fechaSeleccionada, setFechaSeleccionada] = useState('')
  const [votosFecha, setVotosFecha] = useState({})
  const [votosFechaLoading, setVotosFechaLoading] = useState(false)
  const [votosFechaError, setVotosFechaError] = useState('')
  const [votosFechaConfigured, setVotosFechaConfigured] = useState(false)

  useEffect(() => {
    fetchCalendario()
      .then((partidos) => {
        const nuestros = partidos.filter(
          (p) => p.equipo_local === OUR_TEAM || p.equipo_visitante === OUR_TEAM
        )
        setCalendario(nuestros)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!fechaSeleccionada) return
    setVotosFechaLoading(true)
    setVotosFechaError('')
    fetchConvocatoriaPorFecha(fechaSeleccionada)
      .then((res) => {
        setVotosFechaConfigured(res.pollConfigured)
        setVotosFecha(res.votes || {})
      })
      .catch((err) => setVotosFechaError(err.message))
      .finally(() => setVotosFechaLoading(false))
  }, [fechaSeleccionada])

  const viendoHistorico = fechaSeleccionada !== ''
  const votosActivos = viendoHistorico ? votosFecha : votes
  const cargandoActivo = viendoHistorico ? votosFechaLoading : pollLoading
  const errorActivo = viendoHistorico ? votosFechaError : pollError
  const configuradoActivo = viendoHistorico ? votosFechaConfigured : pollConfigured

  useEffect(() => {
    fetchNextMatch()
      .then((match) => {
        setNextMatch(match)
        setMatchForm({
          rival: match?.rival || '',
          date: match?.date || '',
          whatsappPollId: match?.whatsappPollId || '',
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchClub()
      .then((c) => {
        setClub(c)
        setClubForm({ name: c?.name || '' })
      })
      .catch(() => {})
  }, [])

  function togglePosition(code) {
    setForm((prev) => {
      const has = prev.positions.includes(code)
      if (has) return { ...prev, positions: prev.positions.filter((c) => c !== code) }
      if (prev.positions.length >= 2) return prev
      return { ...prev, positions: [...prev.positions, code] }
    })
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.name.trim() || form.positions.length === 0) return
    setSaving(true)
    setError('')
    try {
      const player = await addPlayer(
        {
          name: form.name,
          positions: form.positions,
          number: Number(form.number) || 0,
          phone: form.phone,
          birthDate: form.birthDate,
        },
        currentUser.id
      )
      setPlayers((prev) => [...prev, player])
      setForm({ name: '', positions: [], number: '', phone: '', birthDate: '' })
      setShowForm(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveMatch(e) {
    e.preventDefault()
    setMatchSaving(true)
    setMatchError('')
    try {
      const match = await updateNextMatch(matchForm, currentUser.id)
      setNextMatch(match)
      setShowMatchForm(false)
    } catch (err) {
      setMatchError(err.message)
    } finally {
      setMatchSaving(false)
    }
  }

  async function handleSaveClub(e) {
    e.preventDefault()
    setClubSaving(true)
    setClubError('')
    try {
      const updated = await updateClub(clubForm, currentUser.id)
      setClub(updated)
      setShowClubForm(false)
    } catch (err) {
      setClubError(err.message)
    } finally {
      setClubSaving(false)
    }
  }

  if (selectedPlayer) {
    return <PlayerProfileScreen player={selectedPlayer} onBack={() => setSelectedPlayer(null)} />
  }

  return (
    <div className="list">
      <div className="plantilla-toolbar">
        <select
          className="date-filter"
          value={fechaSeleccionada}
          onChange={(e) => setFechaSeleccionada(e.target.value)}
        >
          <option value="">Convocatoria actual</option>
          {calendario.map((p) => (
            <option key={p.id} value={p.fecha}>
              J{p.jornada} · {formatFecha(p.fecha)} vs {rivalDe(p)}
            </option>
          ))}
        </select>
      </div>

      {cargandoActivo && (
        <p className="hint">
          {viendoHistorico ? 'Consultando convocatoria simulada...' : 'Consultando encuesta de WhatsApp...'}
        </p>
      )}
      {!cargandoActivo && errorActivo && (
        <p className="auth-error">
          No se pudo consultar {viendoHistorico ? 'la convocatoria simulada' : 'WhatsApp'}: {errorActivo}
        </p>
      )}
      {!cargandoActivo && !errorActivo && !configuradoActivo && (
        <p className="hint">
          {viendoHistorico
            ? 'No hay convocatoria simulada para esa fecha.'
            : 'Todavía no hay encuesta configurada para el próximo partido.'}
        </p>
      )}

      {players.map((p) => (
        <div className="card row clickable" key={p.id} onClick={() => setSelectedPlayer(p)}>
          <PlayerAvatar player={p} />
          <span
            className={`status-dot ${voteStatusClass(p.phone ? votosActivos[p.phone] : undefined)}`}
            title={voteStatusTitle(p.phone ? votosActivos[p.phone] : undefined)}
          />
          <div className="row-info">
            <p className="row-title">{p.name}</p>
            <p className="row-subtitle">
              {(p.positions || []).length > 0 ? p.positions.map(positionLabel).join(' · ') : 'Sin posición'}
            </p>
          </div>
          <span className="row-number">{p.number}</span>
        </div>
      ))}

      {isEntrenador && (
        <>
          {showForm ? (
            <form className="card form" onSubmit={handleAdd}>
              <input
                placeholder="Nombre"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <p className="hint" style={{ margin: '0' }}>
                Elige 1 o 2 posiciones
              </p>
              <div className="pos-pills">
                {POSITIONS.map((pos) => {
                  const selected = form.positions.includes(pos.code)
                  return (
                    <button
                      type="button"
                      key={pos.code}
                      className={`pos-pill ${selected ? 'selected' : ''}`}
                      disabled={!selected && form.positions.length >= 2}
                      onClick={() => togglePosition(pos.code)}
                    >
                      {pos.code}
                    </button>
                  )
                })}
              </div>
              <input
                placeholder="Dorsal"
                type="number"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
              <input
                placeholder="Teléfono (WhatsApp, ej. 34684015410)"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <p className="hint" style={{ margin: '0' }}>
                Fecha de nacimiento
              </p>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              />
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </form>
          ) : (
            <button className="btn-outline" onClick={() => setShowForm(true)}>
              + Añadir jugador
            </button>
          )}

          <p className="hint">Convocatoria (encuesta WhatsApp)</p>
          {showMatchForm ? (
            <form className="card form" onSubmit={handleSaveMatch}>
              <input
                placeholder="Rival"
                value={matchForm.rival}
                onChange={(e) => setMatchForm({ ...matchForm, rival: e.target.value })}
              />
              <input
                type="date"
                value={matchForm.date}
                onChange={(e) => setMatchForm({ ...matchForm, date: e.target.value })}
              />
              <input
                placeholder="ID del mensaje de la encuesta (Whapi)"
                value={matchForm.whatsappPollId}
                onChange={(e) => setMatchForm({ ...matchForm, whatsappPollId: e.target.value })}
              />
              {matchError && <p className="auth-error">{matchError}</p>}
              <button type="submit" className="btn-primary" disabled={matchSaving}>
                {matchSaving ? 'Guardando...' : 'Guardar convocatoria'}
              </button>
            </form>
          ) : (
            <button className="btn-outline" onClick={() => setShowMatchForm(true)}>
              {nextMatch?.whatsappPollId ? 'Editar convocatoria' : '+ Configurar encuesta del próximo partido'}
            </button>
          )}

          <p className="hint">Club</p>
          {showClubForm ? (
            <form className="card form" onSubmit={handleSaveClub}>
              <input
                placeholder="Nombre del club"
                value={clubForm.name}
                onChange={(e) => setClubForm({ name: e.target.value })}
              />
              {clubError && <p className="auth-error">{clubError}</p>}
              <button type="submit" className="btn-primary" disabled={clubSaving}>
                {clubSaving ? 'Guardando...' : 'Guardar nombre del club'}
              </button>
            </form>
          ) : (
            <button className="btn-outline" onClick={() => setShowClubForm(true)}>
              {club?.name ? `Club: ${club.name}` : '+ Configurar nombre del club'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
