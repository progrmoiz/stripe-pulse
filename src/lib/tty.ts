/**
 * Returns true if we're running in an interactive terminal session.
 * False in CI environments, piped output, or dumb terminals.
 */
export function isInteractive(): boolean {
  if (!process.stdout.isTTY) return false
  if (process.env.CI) return false
  if (process.env.TERM === 'dumb') return false
  return true
}
