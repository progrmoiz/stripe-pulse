import pc from 'picocolors'

export interface TableColumn {
  key: string
  header: string
  width?: number
}

/**
 * Renders a simple column-aligned table for terminal output.
 * Headers are bold/dimmed, columns are auto-padded.
 * No unicode box-drawing — clean minimal output for v1.
 */
export function renderTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[]
): string {
  if (rows.length === 0) return ''

  // Calculate column widths (max of header or content)
  const widths: number[] = columns.map((col) => {
    const headerLen = col.header.length
    const maxContentLen = rows.reduce((max, row) => {
      const val = formatCell(row[col.key])
      return Math.max(max, val.length)
    }, 0)
    return col.width ?? Math.max(headerLen, maxContentLen)
  })

  const lines: string[] = []

  // Header row
  const headerRow = columns
    .map((col, i) => pc.bold(col.header.padEnd(widths[i])))
    .join('  ')
  lines.push(headerRow)

  // Separator
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  lines.push(pc.dim(separator))

  // Data rows
  for (const row of rows) {
    const dataRow = columns
      .map((col, i) => formatCell(row[col.key]).padEnd(widths[i]))
      .join('  ')
    lines.push(dataRow)
  }

  return lines.join('\n')
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
