import { Command } from '@commander-js/extra-typings'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrr, calculateArpu } from '../core/calculations.js'

export function makeArpuCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('arpu')
    .description('Show Average Revenue Per User')
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

        const subs = await withSpinner('Fetching subscriptions...', () => fetcher.getActiveSubscriptions(), opts)
        const mrrResult = calculateMrr(subs)
        const result = calculateArpu(mrrResult.mrr, mrrResult.activeSubscriptions, mrrResult.currency)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value', 'Currency']
          const rows = [
            ['ARPU', formatCurrency(result.arpu, result.currency), result.currency.toUpperCase()],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        process.stdout.write(formatCurrency(result.arpu, result.currency) + '\n')
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
