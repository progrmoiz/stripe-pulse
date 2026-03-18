import { Command } from '@commander-js/extra-typings'
import * as fs from 'node:fs'
import pc from 'picocolors'
import {
  readCredentials,
  writeCredentials,
  getCredentialsPath,
  getActiveProfile,
} from '../lib/config.js'
import type { GlobalOpts } from '../lib/config.js'
import { ExitCode } from '../lib/output.js'

export function makeLogoutCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('logout')
    .description('Remove authentication credentials')
    .option('--profile <name>', 'Profile to log out (defaults to active)')
    .action((opts) => {
      const merged: GlobalOpts = {
        ...globalOpts(),
        ...(opts.profile ? { profile: opts.profile } : {}),
      }

      const creds = readCredentials()
      if (!creds || Object.keys(creds.profiles).length === 0) {
        process.stderr.write('No profiles configured.\n')
        process.exit(ExitCode.SUCCESS)
      }

      // Determine which profile to remove
      const profileName = opts.profile ?? merged.profile ?? getActiveProfile()

      if (!creds.profiles[profileName]) {
        process.stderr.write(
          pc.red(`Error: Profile "${profileName}" not found`) + '\n'
        )
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      delete creds.profiles[profileName]

      const remaining = Object.keys(creds.profiles)

      if (remaining.length === 0) {
        // No profiles left — delete the credentials file
        try {
          fs.unlinkSync(getCredentialsPath())
        } catch {
          // File may have already been removed
        }
        process.stderr.write(pc.green('✓') + ` Logged out of ${pc.bold(profileName)}\n`)
        return
      }

      // Set active to the first remaining profile
      creds.active_profile = remaining[0]!
      writeCredentials(creds)

      process.stderr.write(
        pc.green('✓') +
          ` Logged out of ${pc.bold(profileName)}\n`
      )
      process.stderr.write(
        pc.dim(`  Active profile is now: ${remaining[0]}`) + '\n'
      )
    })
}
