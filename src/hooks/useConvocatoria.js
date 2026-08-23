import { useEffect, useMemo, useState } from 'react'
import { fetchPollStatus } from '../api'

export default function useConvocatoria(players) {
  const [votes, setVotes] = useState({})
  const [pollLoading, setPollLoading] = useState(true)
  const [pollError, setPollError] = useState('')
  const [pollConfigured, setPollConfigured] = useState(false)

  useEffect(() => {
    setPollLoading(true)
    setPollError('')
    fetchPollStatus()
      .then((res) => {
        setPollConfigured(res.pollConfigured)
        setVotes(res.votes || {})
      })
      .catch((err) => setPollError(err.message))
      .finally(() => setPollLoading(false))
  }, [])

  const listaConvocados = useMemo(
    () => players.filter((p) => p.phone && votes[p.phone] === 'Si'),
    [players, votes]
  )

  return { votes, listaConvocados, pollLoading, pollError, pollConfigured }
}
