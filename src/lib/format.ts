/**
 * Export formatters for CSV and Markdown table output.
 * Used by --format csv and --format markdown on all commands.
 */

/**
 * Formats headers and rows as a standard CSV string with a header row.
 */
export function formatCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string): string => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }

  const lines: string[] = []
  lines.push(headers.map(escape).join(','))
  for (const row of rows) {
    lines.push(row.map(escape).join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * Formats headers and rows as a GitHub-flavored Markdown table.
 */
export function formatMarkdown(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0)
    return Math.max(h.length, maxRow, 3) // minimum 3 for --- separator
  })

  const lines: string[] = []

  // Header row
  lines.push('| ' + headers.map((h, i) => h.padEnd(widths[i])).join(' | ') + ' |')

  // Separator row
  lines.push('| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |')

  // Data rows
  for (const row of rows) {
    lines.push('| ' + headers.map((_, i) => (row[i] ?? '').padEnd(widths[i])).join(' | ') + ' |')
  }

  return lines.join('\n') + '\n'
}
