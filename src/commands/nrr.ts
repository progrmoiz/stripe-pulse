import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatPercent, formatCurrency } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrrMovements, calculateNetRevenueRetention, calculatePeriodMrr } from '../core/calculations.js'
import { nrrBenchmark } from '../lib/benchmarks.js'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

export function makeNrrCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('nrr')
    .description('Show Net Revenue Retention for a period')
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

        const [activeSubs, newSubs, canceledSubs] = await withSpinner(
          'Fetching subscriptions...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getNewSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getCanceledSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
          ]),
          opts
        )

        const previousSubs = [...activeSubs, ...canceledSubs].filter(
          (sub) => !newSubs.find((n) => n.id === sub.id)
        )

        const movements = calculateMrrMovements(activeSubs, previousSubs)
        const startingMrr = calculatePeriodMrr(previousSubs)
        const result = calculateNetRevenueRetention(
          startingMrr,
          movements.expansionMrr,
          movements.contractionMrr,
          movements.churnedMrr,
          startDate,
          endDate,
          movements.currency
        )

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value', 'Period Start', 'Period End']
          const rows = [
            ['NRR', formatPercent(result.nrr), startDate, endDate],
            ['Starting MRR', formatCurrency(result.startingMrr, result.currency), '', ''],
            ['Expansion MRR', formatCurrency(result.expansionMrr, result.currency), '', ''],
            ['Contraction MRR', formatCurrency(result.contractionMrr, result.currency), '', ''],
            ['Churned MRR', formatCurrency(result.churnedMrr, result.currency), '', ''],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        const benchmark = nrrBenchmark(result.nrr)
        process.stdout.write(
          `${pc.bold(formatPercent(result.nrr))}  ${benchmark}\n`
        )

        if (opts.verbose) {
          process.stdout.write(`Starting MRR:   ${formatCurrency(result.startingMrr, result.currency)}\n`)
          process.stdout.write(`Expansion:      +${formatCurrency(result.expansionMrr, result.currency)}\n`)
          process.stdout.write(`Contraction:    -${formatCurrency(result.contractionMrr, result.currency)}\n`)
          process.stdout.write(`Churned:        -${formatCurrency(result.churnedMrr, result.currency)}\n`)
          process.stdout.write(`Period:         ${startDate} → ${endDate}\n`)
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
