import pc from 'picocolors'
import type { GlobalOpts } from './config.js'
import { isInteractive } from './tty.js'
import { shouldOutputJson } from './output.js'

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_INTERVAL_MS = 80

/**
 * Wraps an async function with a braille spinner on stderr.
 * Only shows spinner if running in an interactive terminal.
 * In non-interactive (JSON/quiet/piped), just runs the function silently.
 * On error, clears spinner and rethrows.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  opts: GlobalOpts
): Promise<T> {
  const quiet = shouldOutputJson(opts)
  const interactive = isInteractive() && !quiet

  let frameIndex = 0
  let timer: ReturnType<typeof setInterval> | undefined

  if (interactive) {
    process.stderr.write(`${BRAILLE_FRAMES[0]} ${message}`)
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % BRAILLE_FRAMES.length
      process.stderr.write(`\r${BRAILLE_FRAMES[frameIndex]} ${message}`)
    }, FRAME_INTERVAL_MS)
  }

  try {
    const result = await fn()

    if (timer) clearInterval(timer)
    if (interactive) {
      process.stderr.write(`\r${pc.green('✓')} ${message}\n`)
    }

    return result
  } catch (err) {
    if (timer) clearInterval(timer)
    if (interactive) {
      process.stderr.write(`\r${pc.red('✗')} ${message}\n`)
    }
    throw err
  }
}
