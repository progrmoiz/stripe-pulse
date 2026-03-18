import pc from 'picocolors'

const FULL = '█'
const EMPTY = '░'

export function horizontalBar(value: number, max: number, width = 12): string {
  const filled = Math.round((value / max) * width)
  const empty = width - filled
  return FULL.repeat(filled) + pc.dim(EMPTY.repeat(empty))
}

/**
 * Renders a standalone horizontal bar chart with labels and values.
 * Used by --chart flag on plans/mrr commands.
 */
export function horizontalBarChart(
  items: Array<{ label: string; value: number; formatted: string }>,
  barWidth = 40,
): string {
  if (items.length === 0) return ''
  const maxValue = Math.max(...items.map(i => i.value), 1)
  const maxLabel = Math.max(...items.map(i => i.label.length), 1)
  const maxFormatted = Math.max(...items.map(i => i.formatted.length), 1)

  return items
    .map(item => {
      const filled = Math.round((item.value / maxValue) * barWidth)
      const bar = pc.green(FULL.repeat(Math.max(filled, 1)))
      return `  ${item.label.padEnd(maxLabel)}  ${pc.bold(item.formatted.padStart(maxFormatted))}  ${bar}`
    })
    .join('\n')
}

export function labeledBar(
  label: string,
  value: string,
  barValue: number,
  barMax: number,
  pct: string,
  extra: string,
  labelWidth = 25,
  barWidth = 12,
): string {
  const bar = horizontalBar(barValue, barMax, barWidth)
  return `  ${label.padEnd(labelWidth)} ${value.padStart(10)}  ${bar}  ${pct.padStart(4)}  ${extra}`
}
