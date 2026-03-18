import pc from 'picocolors'

const TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map(v => TICKS[Math.min(7, Math.round(((v - min) / range) * 7))])
    .join('')
}

export function coloredSparkline(values: number[]): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map(v => {
      const idx = Math.min(7, Math.round(((v - min) / range) * 7))
      const tick = TICKS[idx]
      return idx <= 2 ? pc.red(tick) : idx <= 4 ? pc.yellow(tick) : pc.green(tick)
    })
    .join('')
}
