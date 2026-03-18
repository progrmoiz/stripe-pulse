import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import { readCredentials, setActiveProfile } from '../lib/config.js'
import type { GlobalOpts } from '../lib/config.js'
import { ExitCode } from '../lib/output.js'

export function makeSwitchCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('switch')
    .description('Switch the active profile')
    .argument('<profile>', 'Profile name to switch to')
    .action((profile) => {
      const creds = readCredentials()
      if (!creds || !creds.profiles[profile]) {
        const available = creds ? Object.keys(creds.profiles).join(', ') : 'none'
        process.stderr.write(pc.red(`Profile "${profile}" not found.`) + '\n')
        process.stderr.write(pc.dim(`Available: ${available}`) + '\n')
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      setActiveProfile(profile)
      process.stderr.write(pc.green('✓') + ` Switched to ${pc.bold(profile)}\n`)
    })
}
