export const POSITIONS = [
  { code: 'POR', label: 'Portero' },
  { code: 'CEN', label: 'Central' },
  { code: 'LAT', label: 'Lateral' },
  { code: 'VOL', label: 'Volante' },
  { code: 'DEL', label: 'Delantero' },
]

export function positionLabel(code) {
  return POSITIONS.find((p) => p.code === code)?.label || code
}
