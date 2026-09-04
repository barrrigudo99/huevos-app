import { useRef } from 'react'

const DEFAULT_MS = 550

// Detecta "mantener pulsado" sobre un elemento (ratón y touch a la vez vía
// Pointer Events) sin bloquear su click normal — solo se activa si el dedo/
// ratón se mantiene quieto ms milisegundos. Si se dispara el long-press, se
// traga el click que llega justo después al soltar (onClickCapture).
export default function useLongPress(onLongPress, ms = DEFAULT_MS) {
  const timerRef = useRef(null)
  const firedRef = useRef(false)

  function start() {
    firedRef.current = false
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      onLongPress()
    }, ms)
  }

  function clear() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function handleClickCapture(e) {
    if (firedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      firedRef.current = false
    }
  }

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture: handleClickCapture,
  }
}
