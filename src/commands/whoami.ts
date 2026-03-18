import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import { createStripeClient } from '../core/stripe-client.js'
import {
  resolveApiKey,
  getActiveProfile,
  maskApiKey,
  readCredentials,
  getKeySource,
} from '../lib/config.js'
import type { GlobalOpts } from '../lib/config.js'
import { shouldOutputJson, ExitCode } from '../lib/output.js'

function detectMode(apiKey: string): 'live' | 'test' {
  if (apiKey.startsWith('sk_live_') || apiKey.startsWith('rk_live_')) return 'live'
  return 'test'
}

export function makeWhoamiCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('whoami')
    .description('Show the current authenticated profile and Stripe account')
    .action(async () => {
      const opts = globalOpts()
      const apiKey = resolveApiKey(opts)

      if (!apiKey) {
        process.stderr.write(
          pc.red('Error: No API key found. Run `stripe-pulse login` or set STRIPE_API_KEY.') + '\n'
        )
        process.exit(ExitCode.AUTH_ERROR)
      }

      const keySource = getKeySource(opts)
      const mode = detectMode(apiKey)

      const creds = readCredentials()
      const profileName =
        opts.profile ??
        process.env.STRIPE_PULSE_PROFILE ??
        creds?.active_profile ??
        'default'

      const stripe = createStripeClient(apiKey)

      let accountName: string
      let accountId: string
      try {
        const account = await stripe.accounts.retrieve()
        accountName = account.business_profile?.name ?? account.email ?? account.id
        accountId = account.id
      } catch {
        // Restricted keys may not have accounts permission
        try {
          await stripe.subscriptions.list({ limit: 1 })
          accountName = 'Stripe account (restricted key)'
          accountId = 'restricted'
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(pc.red(`Error: Failed to connect to Stripe — ${msg}`) + '\n')
          process.exit(ExitCode.AUTH_ERROR)
        }
      }

      if (shouldOutputJson(opts)) {
        process.stdout.write(
          JSON.stringify(
            {
              profile: profileName,
              api_key_masked: maskApiKey(apiKey),
              key_source: keySource,
              mode,
              account_id: accountId,
              account_name: accountName,
            },
            null,
            2
          ) + '\n'
        )
        return
      }

      process.stdout.write(`${pc.bold('Profile:')}      ${profileName}\n`)
      process.stdout.write(
        `${pc.bold('API Key:')}      ${maskApiKey(apiKey)} ${pc.dim(`(via ${keySource})`)}\n`
      )
      process.stdout.write(`${pc.bold('Mode:')}         ${mode === 'live' ? pc.green('live') : pc.yellow('test')}\n`)
      process.stdout.write('\n')
      process.stdout.write(`${pc.bold('Account ID:')}   ${accountId}\n`)
      process.stdout.write(`${pc.bold('Account:')}      ${accountName}\n`)
    })
}
