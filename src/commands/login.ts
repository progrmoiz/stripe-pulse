import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import { createStripeClient } from '../core/stripe-client.js'
import {
  addProfile,
  setActiveProfile,
  maskApiKey,
} from '../lib/config.js'
import type { GlobalOpts } from '../lib/config.js'
import { ExitCode } from '../lib/output.js'
import { isInteractive } from '../lib/tty.js'

function detectMode(apiKey: string): 'live' | 'test' {
  if (apiKey.startsWith('sk_live_') || apiKey.startsWith('rk_live_')) return 'live'
  return 'test'
}

function validateKeyFormat(apiKey: string): boolean {
  return (
    apiKey.startsWith('sk_live_') ||
    apiKey.startsWith('sk_test_') ||
    apiKey.startsWith('rk_live_') ||
    apiKey.startsWith('rk_test_')
  )
}

export function makeLoginCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('login')
    .description('Authenticate with your Stripe API key')
    .option('--key <key>', 'API key to use (skips interactive prompt)')
    .option('--profile <name>', 'Profile name to save as (default: "default")')
    .action(async (opts) => {
      const merged: GlobalOpts = {
        ...globalOpts(),
        ...(opts.profile ? { profile: opts.profile } : {}),
      }

      let apiKey: string | undefined = opts.key

      // If no key flag provided, prompt interactively
      if (!apiKey) {
        if (!isInteractive()) {
          process.stderr.write(
            'Error: Non-interactive mode requires --key <key>\n'
          )
          process.exit(ExitCode.VALIDATION_ERROR)
        }

        const { password, isCancel } = await import('@clack/prompts')
        const result = await password({
          message: 'Enter your Stripe API key:',
          validate(value) {
            if (!value || value.trim().length === 0) return 'API key is required'
            if (!validateKeyFormat(value.trim())) {
              return 'Key must start with sk_live_, sk_test_, rk_live_, or rk_test_'
            }
          },
        })

        if (isCancel(result)) {
          process.stderr.write('Cancelled.\n')
          process.exit(ExitCode.SUCCESS)
        }

        apiKey = result as string
      }

      apiKey = apiKey.trim()

      // Validate format
      if (!validateKeyFormat(apiKey)) {
        process.stderr.write(
          pc.red('Error: Invalid API key format. Key must start with sk_live_, sk_test_, rk_live_, or rk_test_') + '\n'
        )
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      // Validate the key by calling Stripe
      const stripe = createStripeClient(apiKey)
      let accountName: string
      try {
        // Try accounts.retrieve first (full API keys)
        const account = await stripe.accounts.retrieve()
        accountName = account.business_profile?.name ?? account.email ?? account.id
      } catch {
        // Restricted keys may not have accounts permission — try subscriptions instead
        try {
          await stripe.subscriptions.list({ limit: 1 })
          accountName = `Stripe account (restricted key)`
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(
            pc.red(`Authentication failed: ${msg}`) + '\n'
          )
          process.exit(ExitCode.AUTH_ERROR)
        }
      }

      // Determine profile name
      const profileName = opts.profile ?? merged.profile ?? 'default'
      const mode = detectMode(apiKey)

      // Store credentials
      addProfile(profileName, { api_key: apiKey, name: accountName })
      setActiveProfile(profileName)

      process.stderr.write(
        pc.green('✓') +
          ` Connected to ${pc.bold(accountName)} (${mode})\n`
      )
      process.stderr.write(
        pc.dim(`  Profile: ${profileName} · Key: ${maskApiKey(apiKey)}`) + '\n'
      )
    })
}
