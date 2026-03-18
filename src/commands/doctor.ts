import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import { createStripeClient } from '../core/stripe-client.js'
import {
  resolveApiKey,
  readCredentials,
  maskApiKey,
  getKeySource,
} from '../lib/config.js'
import type { GlobalOpts } from '../lib/config.js'
import { shouldOutputJson, ExitCode } from '../lib/output.js'
import { VERSION } from '../lib/constants.js'

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  detail?: string
}

export function makeDoctorCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('doctor')
    .description('Run diagnostic checks on your stripe-pulse setup')
    .action(async () => {
      const opts = globalOpts()
      const jsonMode = shouldOutputJson(opts)
      const checks: CheckResult[] = []

      const pass = (name: string, message: string, detail?: string): CheckResult => ({
        name,
        status: 'pass',
        message,
        detail,
      })

      const fail = (name: string, message: string, detail?: string): CheckResult => ({
        name,
        status: 'fail',
        message,
        detail,
      })

      // 1. CLI Version
      checks.push(pass('CLI Version', `v${VERSION}`))
      if (!jsonMode) {
        process.stderr.write(`${pc.green('✓')} CLI Version: v${VERSION}\n`)
      }

      // 2. Node.js Version
      const nodeVersion = process.version
      const nodeMajor = parseInt(nodeVersion.slice(1), 10)
      if (nodeMajor >= 20) {
        checks.push(pass('Node.js', nodeVersion, 'Meets minimum requirement (>=20)'))
        if (!jsonMode) {
          process.stderr.write(`${pc.green('✓')} Node.js: ${nodeVersion}\n`)
        }
      } else {
        checks.push(fail('Node.js', nodeVersion, 'Requires Node.js >= 20'))
        if (!jsonMode) {
          process.stderr.write(
            `${pc.red('✗')} Node.js: ${nodeVersion} ${pc.red('(requires >=20)')}\n`
          )
        }
      }

      // 3. Config file
      const creds = readCredentials()
      const profileName =
        opts.profile ??
        process.env.STRIPE_PULSE_PROFILE ??
        creds?.active_profile ??
        'default'

      if (creds) {
        checks.push(pass('Config File', 'Found', `Active profile: ${profileName}`))
        if (!jsonMode) {
          process.stderr.write(
            `${pc.green('✓')} Config File: Found ${pc.dim(`(profile: ${profileName})`)}\n`
          )
        }
      } else {
        checks.push(fail('Config File', 'Not found', 'Run `stripe-pulse login` to create'))
        if (!jsonMode) {
          process.stderr.write(
            `${pc.red('✗')} Config File: ${pc.red('Not found')}\n`
          )
          process.stderr.write(
            pc.dim('  Run `stripe-pulse login` to create\n')
          )
        }
      }

      // 4. API Key
      const apiKey = resolveApiKey(opts)

      if (apiKey) {
        const keySource = getKeySource(opts)
        const masked = maskApiKey(apiKey)
        checks.push(
          pass('API Key', `Configured (${masked})`, `Source: ${keySource} · Profile: ${profileName}`)
        )
        if (!jsonMode) {
          process.stderr.write(
            `${pc.green('✓')} API Key: ${masked} ${pc.dim(`(${keySource})`)}\n`
          )
        }
      } else {
        checks.push(fail('API Key', 'Not configured', 'Run `stripe-pulse login` or set STRIPE_API_KEY'))
        if (!jsonMode) {
          process.stderr.write(
            `${pc.red('✗')} API Key: ${pc.red('Not configured')}\n`
          )
          process.stderr.write(
            pc.dim('  Run `stripe-pulse login` or set STRIPE_API_KEY\n')
          )
        }
      }

      // 5. Stripe Connection
      if (!apiKey) {
        checks.push(fail('Stripe Connection', 'Skipped (no API key)'))
        checks.push(fail('Account Info', 'Skipped (no API key)'))

        if (!jsonMode) {
          process.stderr.write(`${pc.red('✗')} Stripe Connection: Skipped (no API key)\n`)
          process.stderr.write(`${pc.red('✗')} Account Info: Skipped (no API key)\n`)
        }
      } else {
        const stripe = createStripeClient(apiKey)
        const connStart = Date.now()

        try {
          let accountName: string
          let accountId: string
          try {
            const account = await stripe.accounts.retrieve()
            accountName = account.business_profile?.name ?? account.email ?? account.id
            accountId = account.id
          } catch {
            // Restricted keys may not have accounts permission — try subscriptions
            await stripe.subscriptions.list({ limit: 1 })
            accountName = 'Stripe account (restricted key)'
            accountId = 'restricted'
          }
          const latencyMs = Date.now() - connStart

          checks.push(
            pass('Stripe Connection', `Connected (${latencyMs}ms)`, `Account: ${accountId}`)
          )
          if (!jsonMode) {
            process.stderr.write(
              `${pc.green('✓')} Stripe Connection: Connected ${pc.dim(`(${latencyMs}ms)`)}\n`
            )
          }

          checks.push(
            pass('Account Info', accountName, `ID: ${accountId}`)
          )
          if (!jsonMode) {
            process.stderr.write(
              `${pc.green('✓')} Account Info: ${accountName} ${pc.dim(`(${accountId})`)}\n`
            )
          }
        } catch (err) {
          const latencyMs = Date.now() - connStart
          const msg = err instanceof Error ? err.message : String(err)
          checks.push(fail('Stripe Connection', `Failed — ${msg}`, `Latency: ${latencyMs}ms`))
          if (!jsonMode) {
            process.stderr.write(
              `${pc.red('✗')} Stripe Connection: ${pc.red(`Failed — ${msg}`)}\n`
            )
          }
          checks.push(fail('Account Info', 'Skipped (connection failed)'))
          if (!jsonMode) {
            process.stderr.write(`${pc.red('✗')} Account Info: Skipped (connection failed)\n`)
          }
        }
      }

      const allOk = checks.every((c) => c.status === 'pass')

      if (jsonMode) {
        process.stdout.write(
          JSON.stringify({ ok: allOk, checks }, null, 2) + '\n'
        )
      } else {
        process.stderr.write('\n')
        if (allOk) {
          process.stderr.write(pc.green('All checks passed.') + '\n')
        } else {
          const failed = checks.filter((c) => c.status === 'fail').length
          process.stderr.write(
            pc.red(`${failed} check${failed === 1 ? '' : 's'} failed.`) + '\n'
          )
          process.exit(ExitCode.API_ERROR)
        }
      }
    })
}
