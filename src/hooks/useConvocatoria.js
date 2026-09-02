import { useEffect, useState } from 'react'
import { fetchPollStatus } from '../api'

export default function useConvocatoria() {
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

  return { votes, pollLoading, pollError, pollConfigured }
}
