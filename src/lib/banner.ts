import pc from 'picocolors'
import { VERSION } from './constants.js'

export function banner(profile?: string): string {
  const info = pc.bold('stripe-pulse') + pc.dim(` v${VERSION}`) + (profile ? pc.dim(` — ${profile}`) : '')
  const lines = [
    pc.green('  ╭─╮'),
    pc.green('──╯ ╰──╮ ╭──') + '   ' + info,
    pc.green('       ╰─╯'),
  ]
  return lines.join('\n')
}
