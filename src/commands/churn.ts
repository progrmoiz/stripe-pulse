import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatPercent } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateCustomerChurn, getCustomerId } from '../core/calculations.js'
import { churnBenchmark } from '../lib/benchmarks.js'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

export function makeChurnCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('churn')
    .description('Show customer churn rate for a period')
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
        const { startDate, endDate } = resolvePeriod(opts)

        const [activeSubs, canceledSubs, newSubs, allCanceledSubs] = await withSpinner(
          'Fetching subscriptions...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getCanceledSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getNewSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getAllCanceledSubscriptions(),
          ]),
          opts
        )

        const result = calculateCustomerChurn(activeSubs, canceledSubs, startDate, endDate, allCanceledSubs, newSubs)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value', 'Period Start', 'Period End']
          const rows = [
            ['Customer Churn Rate', formatPercent(result.customerChurnRate), startDate, endDate],
            ['Customers Lost', String(result.customersLost), '', ''],
            ['Customers at Start', String(result.customersAtStart), '', ''],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        const benchmark = churnBenchmark(result.customerChurnRate)
        process.stdout.write(
          `${pc.bold(formatPercent(result.customerChurnRate))}  ${benchmark}\n`
        )

        if (opts.verbose) {
          process.stdout.write(`Customers at start:  ${result.customersAtStart}\n`)
          process.stdout.write(`Customers lost:      ${result.customersLost}\n`)
          process.stdout.write(`Reactivated:         ${result.reactivatedCustomers}\n`)
          process.stdout.write(`Period:              ${startDate} → ${endDate}\n`)
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
