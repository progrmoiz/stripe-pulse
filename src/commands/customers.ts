import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateCustomerMetrics } from '../core/calculations.js'

export function makeCustomersCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('customers')
    .description('Show customer metrics by subscription status')
    .action(async () => {
      const opts = globalOpts()
      const apiKey = resolveApiKey(opts)
      if (!apiKey) {
        outputError({ code: 'AUTH', message: 'No API key. Run `stripe-pulse login` or set STRIPE_API_KEY.' }, opts)
        process.exit(ExitCode.AUTH_ERROR)
      }

      try {
        const stripe = createStripeClient(apiKey)
        const fetcher = new StripeFetcher(stripe, new Cache())

        const subs = await withSpinner('Fetching subscriptions...', () => fetcher.getAllSubscriptions(), opts)
        const result = calculateCustomerMetrics(subs)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value']
          const rows = [
            ['Active', String(result.activeSubscribers)],
            ['Trialing', String(result.trialingCustomers)],
            ['Past Due', String(result.pastDueCustomers)],
            ['Total', String(result.totalCustomers)],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        process.stdout.write(
          `${pc.bold(String(result.activeSubscribers))} active  ` +
          `${pc.bold(String(result.trialingCustomers))} trialing  ` +
          `${pc.bold(String(result.pastDueCustomers))} past due\n`
        )

        if (opts.verbose) {
          process.stdout.write(`\nTotal customers: ${result.totalCustomers}\n`)
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
