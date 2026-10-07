import { useEffect, useMemo, useState } from 'react'
import { POSITIONS, positionLabel } from '../data/players'
import { OUR_TEAM, sortedMatchesForTeam } from '../data/league'
import {
  addPlayer,
  fetchCalendario,
  fetchClub,
  fetchConvocatoria,
  fetchConvocatoriaPorFecha,
  fetchEstadisticasPersonales,
  fetchNextMatch,
  fetchNextMatchAuto,
  generarInscripcion,
  updateNextMatch,
} from '../api'
import PlayerProfileScreen from './PlayerProfileScreen'
import PlayerAvatar from './PlayerAvatar'
import NextMatchCard from './NextMatchCard'
import AlineacionScreen from './AlineacionScreen'
import BottomSheet from './BottomSheet'
import ConvocatoriaFinalPanel from './ConvocatoriaFinalPanel'

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

export default function PlantillaScreen({
  players,
  setPlayers,
  currentUser,
  votes,
  onOpenStats,
}) {
  const isEntrenador = currentUser.role === 'entrenador'

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', positions: [], number: '', phone: '', birthDate: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [showLineupPanel, setShowLineupPanel] = useState(false)

  const [nextMatch, setNextMatch] = useState(null)
  // Partido que se muestra en la tarjeta destacada por defecto, calculado en
  // el servidor a partir de simulador/2_calendario.json (por fecha, sin
  // tener en cuenta el campo "jugado") — no depende de que el entrenador lo
  // haya configurado a mano. A partir de ahí, las flechas de NextMatchCard
  // permiten navegar manualmente por el resto de jornadas.
  const [proximoPartido, setProximoPartido] = useState(null)
  // Índice dentro de `calendario` (jornadas de nuestro equipo, ordenadas)
  // que se está mostrando en NextMatchCard. Se inicializa apuntando al
  // proximoPartido en cuanto ambos datos están disponibles.
  const [matchIndex, setMatchIndex] = useState(null)
  const [showMatchForm, setShowMatchForm] = useState(false)
  const [matchForm, setMatchForm] = useState({ rival: '', date: '', time: '' })
  const [matchSaving, setMatchSaving] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [generandoInscripcion, setGenerandoInscripcion] = useState(false)
  const [errorInscripcion, setErrorInscripcion] = useState('')

  // Solo lectura: el nombre se usa en NextMatchCard. El formulario para
  // cambiarlo se quitó al poner ahí el botón de la convocatoria final.
  const [club, setClub] = useState(null)

  // Convocatoria final de la jornada mostrada (GET /api/matchdays/:id/convocatoria):
  // decide el texto del botón "Crear convocatoria final" y, si está cerrada,
  // quiénes son los convocados que se pasan a Alineación.
  const [convocatoriaFinal, setConvocatoriaFinal] = useState(null)
  const [convocatoriaFinalLoading, setConvocatoriaFinalLoading] = useState(false)
  const [convocatoriaFinalError, setConvocatoriaFinalError] = useState('')
  const [showConvocatoriaFinal, setShowConvocatoriaFinal] = useState(false)

  const [calendario, setCalendario] = useState([])
  // Marcador real (matches.goals_for/goals_against) por jornada, para
  // pintarlo en NextMatchCard cuando el partido ya está jugado — misma
  // fuente que ya usa StatsScreen, sin duplicar la query en el backend.
  const [estadisticasPersonales, setEstadisticasPersonales] = useState([])
  // Distingue "todavía no ha llegado la respuesta" de "llegó y no hay
  // resultado": evita pintar un 0-0 de mentira en NextMatchCard mientras
  // fetchEstadisticasPersonales sigue en vuelo.
  const [estadisticasLoaded, setEstadisticasLoaded] = useState(false)
  // Convocatoria de la lista de jugadores de abajo: siempre la del partido
  // que se está mostrando en NextMatchCard (partidoMostrado), nunca una
  // fecha elegida aparte — así las dos nunca pueden desincronizarse.
  const [convocatoria, setConvocatoria] = useState({})
  const [convocatoriaLoading, setConvocatoriaLoading] = useState(false)
  const [convocatoriaError, setConvocatoriaError] = useState('')
  const [convocatoriaConfigured, setConvocatoriaConfigured] = useState(false)
  // Si la jornada mostrada tiene encuesta real (convocatoriaConfigured
  // también es true con WHAPI_MOCK_VOTES) — decide "Generar"/"Regenerar".
  const [convocatoriaHasPoll, setConvocatoriaHasPoll] = useState(false)
  // Se incrementa para volver a pedir la convocatoria de la misma jornada
  // (p. ej. tras generar su encuesta), sin depender de que cambie la fecha.
  const [convocatoriaRecarga, setConvocatoriaRecarga] = useState(0)

  useEffect(() => {
    fetchCalendario()
      .then((partidos) => setCalendario(sortedMatchesForTeam(partidos, OUR_TEAM)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchEstadisticasPersonales()
      .then(setEstadisticasPersonales)
      .catch(() => {})
      .finally(() => setEstadisticasLoaded(true))
  }, [])

  useEffect(() => {
    fetchNextMatch()
      .then((match) => {
        setNextMatch(match)
        setMatchForm({
          rival: match?.rival || '',
          date: match?.date || '',
          time: match?.time || '',
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchNextMatchAuto()
      .then(setProximoPartido)
      .catch(() => {})
  }, [])

  // En cuanto tenemos calendario + próximo partido, situamos la navegación
  // de NextMatchCard en la jornada que el servidor calculó como próxima.
  useEffect(() => {
    if (matchIndex !== null || !proximoPartido || calendario.length === 0) return
    const idx = calendario.findIndex((p) => p.id === proximoPartido.matchId)
    setMatchIndex(idx >= 0 ? idx : 0)
  }, [proximoPartido, calendario, matchIndex])

  // Marcador real de la jornada mostrada, si ya está jugada — mismo dato que
  // usa StatsScreen (matches.goals_for/goals_against vía
  // /api/estadisticas-personales), cruzado aquí por matchId en vez de volver
  // a consultar `matches`.
  const resultadoPartidoMostrado = (matchId) => {
    const entrada = estadisticasPersonales.find((e) => e.id === matchId)
    return entrada?.resultado || null
  }

  const partidoNavegado = matchIndex !== null ? calendario[matchIndex] : null
  const partidoMostrado = partidoNavegado
    ? {
        matchId: partidoNavegado.id,
        jornada: partidoNavegado.jornada,
        rival: rivalDe(partidoNavegado),
        date: partidoNavegado.fecha,
        time: partidoNavegado.hora,
        esLocal: partidoNavegado.equipo_local === OUR_TEAM,
        jugado: partidoNavegado.jugado,
        resultado: partidoNavegado.jugado ? resultadoPartidoMostrado(partidoNavegado.id) : null,
      }
    : proximoPartido
  const hasPrevMatch = matchIndex !== null && matchIndex > 0
  const hasNextMatch = matchIndex !== null && matchIndex < calendario.length - 1

  // El formulario de convocatoria siempre refleja el rival/fecha del partido
  // que se está mostrando en la tarjeta (partidoMostrado) — no lo que
  // hubiera guardado de una configuración anterior — para que nunca se
  // pueda ver un rival/fecha en el form distinto del que hay en
  // NextMatchCard. El id de la encuesta ya no está en el formulario: solo lo
  // escribe el servidor al generarla.
  useEffect(() => {
    if (!showMatchForm) return
    setMatchForm((prev) => ({
      ...prev,
      rival: partidoMostrado?.rival || '',
      date: partidoMostrado?.date || '',
      time: partidoMostrado?.time || '',
    }))
    // Dependencias en valores primitivos (rival/date/time), no en
    // partidoMostrado entero: ese objeto se reconstruye con un literal
    // `{...}` en cada render (ver más arriba) mientras haya navegación
    // manual por jornadas, así que usarlo como dependencia disparaba este
    // efecto en cada render → nuevo setMatchForm → nuevo render → bucle
    // infinito ("Maximum update depth exceeded").
  }, [showMatchForm, partidoMostrado?.rival, partidoMostrado?.date, partidoMostrado?.time])

  // La convocatoria de la lista de jugadores sigue siempre a partidoMostrado
  // (la jornada visible en la tarjeta, incluida la navegada a mano con las
  // flechas), en vez de a una fecha elegida aparte. Si no hay partido que
  // mostrar, no se pide nada y se limpia el estado anterior.
  useEffect(() => {
    if (!partidoMostrado?.date) {
      setConvocatoria({})
      setConvocatoriaConfigured(false)
      setConvocatoriaHasPoll(false)
      setConvocatoriaError('')
      setConvocatoriaLoading(false)
      return
    }
    setConvocatoriaLoading(true)
    setConvocatoriaError('')
    fetchConvocatoriaPorFecha(partidoMostrado.date)
      .then((res) => {
        setConvocatoriaConfigured(res.pollConfigured)
        setConvocatoriaHasPoll(Boolean(res.hasPoll))
        setConvocatoria(res.votes || {})
      })
      .catch((err) => setConvocatoriaError(err.message))
      .finally(() => setConvocatoriaLoading(false))
  }, [partidoMostrado?.date, convocatoriaRecarga])

  useEffect(() => {
    const matchId = partidoMostrado?.matchId
    if (!matchId) {
      setConvocatoriaFinal(null)
      setConvocatoriaFinalError('')
      setConvocatoriaFinalLoading(false)
      return
    }
    let cancelado = false
    setConvocatoriaFinalLoading(true)
    setConvocatoriaFinalError('')
    fetchConvocatoria(matchId)
      .then((res) => !cancelado && setConvocatoriaFinal(res))
      .catch((err) => {
        if (cancelado) return
        setConvocatoriaFinal(null)
        setConvocatoriaFinalError(err.message)
      })
      .finally(() => !cancelado && setConvocatoriaFinalLoading(false))
    return () => {
      cancelado = true
    }
  }, [partidoMostrado?.matchId, convocatoriaRecarga])

  // Convocados del partido que se está mostrando en NextMatchCard, para el
  // sheet-panel de Alineación: con la convocatoria final cerrada, los que
  // convocó el entrenador (called); mientras no, los que votaron Sí en la
  // encuesta (`convocatoria`, el mismo mecanismo que la lista de abajo).
  const convocadosDelPartido = useMemo(() => {
    if (convocatoriaFinal?.status === 'cerrada') {
      const llamados = new Set(convocatoriaFinal.jugadores.filter((j) => j.called).map((j) => j.playerId))
      return players.filter((p) => llamados.has(p.id))
    }
    return players.filter((p) => p.phone && convocatoria[p.phone] === 'Si')
  }, [players, convocatoria, convocatoriaFinal])

  // Orden de la lista de jugadores según la jornada mostrada, siempre por
  // dorsal dentro de cada grupo (los que no tienen dorsal, al final):
  // - convocatoria cerrada: convocados (called) y después no convocados;
  // - con encuesta: Sí, Duda, No, sin voto;
  // - sin encuesta: solo por dorsal.
  // convocatoriaFinal se usa solo si es de la jornada mostrada, para no
  // ordenar con la de la jornada anterior mientras carga la nueva.
  const jugadoresOrdenados = useMemo(() => {
    const porDorsal = (a, b) =>
      (a.number || Infinity) - (b.number || Infinity) || a.name.localeCompare(b.name, 'es')

    let grupo = () => 0
    const final = convocatoriaFinal?.matchId === partidoMostrado?.matchId ? convocatoriaFinal : null
    if (final?.status === 'cerrada') {
      const llamados = new Set(final.jugadores.filter((j) => j.called).map((j) => j.playerId))
      grupo = (p) => (llamados.has(p.id) ? 0 : 1)
    } else if (convocatoriaConfigured) {
      const ordenVoto = { Si: 0, Duda: 1, No: 2 }
      grupo = (p) => ordenVoto[p.phone ? convocatoria[p.phone] : undefined] ?? 3
    }
    return [...players].sort((a, b) => grupo(a) - grupo(b) || porDorsal(a, b))
  }, [players, convocatoria, convocatoriaConfigured, convocatoriaFinal, partidoMostrado?.matchId])

  // Texto y estado del botón de la convocatoria final según la jornada mostrada.
  const botonConvocatoriaFinal = (() => {
    if (!partidoMostrado?.matchId) return { texto: 'Crear convocatoria final', activo: false }
    if (convocatoriaFinalLoading) return { texto: 'Cargando convocatoria…', activo: false }
    if (convocatoriaFinalError || !convocatoriaFinal) return { texto: 'Crear convocatoria final', activo: true }
    const { status, jugado, jugadores } = convocatoriaFinal
    if (status === 'sin_encuesta') {
      return { texto: 'Crear convocatoria final', activo: false, nota: 'Primero genera la inscripción.' }
    }
    if (status === 'inscripcion') {
      const inscritos = jugadores.filter((j) => j.vote === 'Si').length
      return { texto: `Crear convocatoria final (${inscritos} inscritos)`, activo: true, primario: true }
    }
    const convocados = jugadores.filter((j) => j.called).length
    return {
      texto: `${jugado ? 'Editar' : 'Ver / editar'} convocatoria final · ${convocados} convocados`,
      activo: true,
    }
  })()

  function handlePrevMatch() {
    setMatchIndex((i) => Math.max(0, (i ?? 0) - 1))
  }

  function handleNextMatch() {
    setMatchIndex((i) => Math.min(calendario.length - 1, (i ?? 0) + 1))
  }

  function handleOpenStats() {
    onOpenStats?.(partidoMostrado?.matchId)
  }

  useEffect(() => {
    fetchClub()
      .then(setClub)
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
      // Si rival/fecha vienen precargados de la jornada que se está viendo
      // en NextMatchCard (partidoMostrado), se manda también su matchId
      // para que el backend identifique la jornada directamente en vez de
      // comparar rival/fecha por texto (ver server/index.js, PUT /api/next-match).
      const match = await updateNextMatch({ ...matchForm, matchId: partidoMostrado?.matchId }, currentUser.id)
      setNextMatch(match)
      setShowMatchForm(false)
    } catch (err) {
      setMatchError(err.message)
    } finally {
      setMatchSaving(false)
    }
  }

  // Lanza de verdad la encuesta de WhatsApp (Sí/No/Duda) para la jornada que
  // se está viendo en NextMatchCard (partidoMostrado), vía Whapi.Cloud — no
  // para el partido activo. Si ya tenía encuesta, el servidor responde
  // POLL_EXISTS y se pide confirmación antes de sustituirla.
  async function handleGenerarInscripcion() {
    const matchId = partidoMostrado?.matchId
    if (!matchId) return
    setGenerandoInscripcion(true)
    setErrorInscripcion('')
    try {
      let match
      try {
        match = await generarInscripcion(matchId, currentUser.id)
      } catch (err) {
        if (err.code !== 'POLL_EXISTS') throw err
        const confirmado = window.confirm(
          'Ya hay una encuesta para esta jornada. Si generas otra, los votos de la anterior dejarán de verse. ¿Continuar?'
        )
        if (!confirmado) return
        match = await generarInscripcion(matchId, currentUser.id, { confirmarReemplazo: true })
      }
      if (match?.matchId === nextMatch?.matchId) {
        setNextMatch((prev) => ({ ...prev, whatsappPollId: match.whatsappPollId }))
      }
      setConvocatoriaRecarga((n) => n + 1)
    } catch (err) {
      setErrorInscripcion(err.message)
    } finally {
      setGenerandoInscripcion(false)
    }
  }


  if (selectedPlayer) {
    return (
      <PlayerProfileScreen
        player={selectedPlayer}
        onBack={() => setSelectedPlayer(null)}
        currentUser={currentUser}
      />
    )
  }

  return (
    <div className="list">
      <NextMatchCard
        nextMatch={partidoMostrado}
        clubName={club?.name}
        votes={votes}
        players={players}
        currentUser={currentUser}
        onOpenStats={handleOpenStats}
        onOpenLineup={() => setShowLineupPanel(true)}
        onPrevMatch={handlePrevMatch}
        onNextMatch={handleNextMatch}
        hasPrevMatch={hasPrevMatch}
        hasNextMatch={hasNextMatch}
        resultadoLoading={!estadisticasLoaded}
      />

      {showLineupPanel && (
        <BottomSheet title="Alineación" onClose={() => setShowLineupPanel(false)}>
          <AlineacionScreen
            players={players}
            convocadosDelPartido={convocadosDelPartido}
            currentUser={currentUser}
            matchId={partidoMostrado?.matchId}
            jugado={!!partidoMostrado?.jugado}
            jornada={partidoMostrado?.jornada}
            rival={partidoMostrado?.rival}
            estadisticasPersonales={estadisticasPersonales}
            estadisticasLoaded={estadisticasLoaded}
          />
        </BottomSheet>
      )}

      {convocatoriaLoading && <p className="hint">Consultando convocatoria...</p>}
      {!convocatoriaLoading && convocatoriaError && (
        <p className="auth-error">No se pudo consultar la convocatoria: {convocatoriaError}</p>
      )}
      {!convocatoriaLoading && !convocatoriaError && !convocatoriaConfigured && (
        <p className="hint">
          {partidoMostrado
            ? 'Todavía no hay encuesta configurada para este partido.'
            : 'Todavía no hay próximo partido configurado.'}
        </p>
      )}

      {jugadoresOrdenados.map((p) => (
        <div className="card row clickable" key={p.id} onClick={() => setSelectedPlayer(p)}>
          <PlayerAvatar player={p} />
          <span
            className={`status-dot ${voteStatusClass(p.phone ? convocatoria[p.phone] : undefined)}`}
            title={voteStatusTitle(p.phone ? convocatoria[p.phone] : undefined)}
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
          {/* Botón "+ Añadir jugador" y su formulario, desactivados a petición:
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
          */}

          <p className="hint">Convocatoria (encuesta WhatsApp)</p>
          {!partidoMostrado?.jugado && (
            <>
              {showMatchForm ? (
                <form className="card form" onSubmit={handleSaveMatch}>
                  <input
                    placeholder={partidoMostrado?.rival || 'Rival'}
                    value={matchForm.rival}
                    onChange={(e) => setMatchForm({ ...matchForm, rival: e.target.value })}
                  />
                  <input
                    type="date"
                    value={matchForm.date}
                    onChange={(e) => setMatchForm({ ...matchForm, date: e.target.value })}
                  />
                  <input
                    type="time"
                    value={matchForm.time}
                    onChange={(e) => setMatchForm({ ...matchForm, time: e.target.value })}
                  />
                  {matchError && <p className="auth-error">{matchError}</p>}
                  <button type="submit" className="btn-primary" disabled={matchSaving}>
                    {matchSaving ? 'Guardando...' : 'Guardar fecha y hora'}
                  </button>
                </form>
              ) : (
                <button className="btn-outline" onClick={() => setShowMatchForm(true)}>
                  Editar fecha y hora
                </button>
              )}

              <button
                type="button"
                className="btn-primary"
                onClick={handleGenerarInscripcion}
                disabled={
                  generandoInscripcion ||
                  !partidoMostrado?.matchId ||
                  !partidoMostrado?.rival ||
                  convocatoriaFinal?.status === 'cerrada'
                }
              >
                {generandoInscripcion
                  ? 'Generando...'
                  : convocatoriaHasPoll
                    ? 'Regenerar inscripción'
                    : 'Generar inscripción'}
              </button>
              {errorInscripcion && <p className="auth-error">{errorInscripcion}</p>}
            </>
          )}

          {/* Fuera del bloque "!jugado": la convocatoria final se puede editar
              también después de jugar el partido (con aviso en el panel). */}
          <button
            type="button"
            className={botonConvocatoriaFinal.primario ? 'btn-primary' : 'btn-outline'}
            onClick={() => setShowConvocatoriaFinal(true)}
            disabled={!botonConvocatoriaFinal.activo}
          >
            {botonConvocatoriaFinal.texto}
          </button>
          {botonConvocatoriaFinal.nota && <p className="hint">{botonConvocatoriaFinal.nota}</p>}
          {convocatoriaFinalError && <p className="auth-error">{convocatoriaFinalError}</p>}

          {showConvocatoriaFinal && partidoMostrado?.matchId && (
            <BottomSheet title="Convocatoria final" onClose={() => setShowConvocatoriaFinal(false)}>
              <ConvocatoriaFinalPanel
                matchId={partidoMostrado.matchId}
                players={players}
                currentUser={currentUser}
                onChanged={() => setConvocatoriaRecarga((n) => n + 1)}
                onClose={() => setShowConvocatoriaFinal(false)}
              />
            </BottomSheet>
          )}
        </>
      )}
    </div>
  )
}