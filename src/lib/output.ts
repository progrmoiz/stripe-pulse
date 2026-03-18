import pc from 'picocolors'
import type { GlobalOpts } from './config.js'

export const enum ExitCode {
  SUCCESS = 0,
  API_ERROR = 1,
  AUTH_ERROR = 2,
  VALIDATION_ERROR = 3,
}

/**
 * Returns true if output should be machine-readable JSON.
 * True when: --json flag, --quiet flag, or stdout is not a TTY (piped).
 */
export function shouldOutputJson(opts: GlobalOpts): boolean {
  // Explicit --format csv/markdown or --chart overrides auto-JSON
  if (opts.format === 'csv' || opts.format === 'markdown') return false
  if (opts.chart) return false
  if (opts.json) return true
  if (opts.quiet) return true
  if (!process.stdout.isTTY) return true
  return false
}

/**
 * Outputs the result data to stdout.
 * JSON mode: pretty-printed JSON.
 * Interactive mode: formatted output.
 */
export function outputResult(data: unknown, opts: GlobalOpts): void {
  if (shouldOutputJson(opts)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    if (typeof data === 'string') {
      process.stdout.write(data + '\n')
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    }
  }
}

/**
 * Outputs an error to stderr.
 * JSON mode: JSON error envelope.
 * Interactive mode: colored error message.
 */
export function outputError(
  error: { code: string; message: string },
  opts: GlobalOpts
): void {
  if (shouldOutputJson(opts)) {
    process.stderr.write(JSON.stringify({ error }, null, 2) + '\n')
  } else {
    process.stderr.write(pc.red(`Error: ${error.message}`) + '\n')
    if (error.code && error.code !== 'API_ERROR') {
      process.stderr.write(pc.dim(`  Code: ${error.code}`) + '\n')
    }
  }
}

/**
 * Outputs data in JSON mode or calls humanFn for interactive mode.
 * Convenience wrapper for commands that have both modes.
 */
export function outputFormatted<T>(data: T, humanFn: () => void, opts: GlobalOpts): void {
  if (shouldOutputJson(opts)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    humanFn()
  }
}

/**
 * Formats a dollar amount with currency symbol.
 * e.g. formatCurrency(392, 'usd') → '$392.00'
 */
export function formatCurrency(amount: number, currency: string = 'usd'): string {
  const lower = currency.toLowerCase()
  const symbol = lower === 'usd' ? '$' : lower === 'eur' ? '€' : lower === 'gbp' ? '£' : currency.toUpperCase() + ' '
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * Formats a percentage value with one decimal place.
 * e.g. formatPercent(66.7) → '66.7%'
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}
