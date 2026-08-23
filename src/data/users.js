export const ROLES = [
  { code: 'jugador', label: 'Jugador' },
  { code: 'entrenador', label: 'Entrenador' },
]

export function roleLabel(code) {
  return ROLES.find((r) => r.code === code)?.label || code
}
