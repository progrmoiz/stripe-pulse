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
import { calculateMrrMovements, calculateRevenueChurn, calculatePeriodMrr } from '../core/calculations.js'
import { revenueChurnBenchmark } from '../lib/benchmarks.js'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

export function makeRevenueChurnCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('revenue-churn')
    .description('Show revenue churn rate for a period')
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

        const [activeSubs, newSubs, canceledSubs, allCanceledSubs] = await withSpinner(
          'Fetching subscriptions...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getNewSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getCanceledSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getAllCanceledSubscriptions(),
          ]),
          opts
        )

        // Reconstruct start-of-period subs: active now + canceled during period - new during period
        const newIds = new Set(newSubs.map((s) => s.id))
        const previousSubs = [...activeSubs, ...canceledSubs].filter(
          (s) => !newIds.has(s.id)
        )

        const tiersMap = await fetcher.getPriceTiers(activeSubs)
        const movements = calculateMrrMovements(activeSubs, previousSubs, allCanceledSubs, tiersMap)
        const mrrAtStart = calculatePeriodMrr(previousSubs, tiersMap)
        const result = calculateRevenueChurn(mrrAtStart, movements.churnedMrr, startDate, endDate, movements.currency)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value', 'Period Start', 'Period End']
          const rows = [
            ['Revenue Churn Rate', formatPercent(result.revenueChurnRate), startDate, endDate],
            ['MRR Lost', formatCurrency(result.mrrLost, result.currency), '', ''],
            ['MRR at Start', formatCurrency(result.mrrAtStart, result.currency), '', ''],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        const benchmark = revenueChurnBenchmark(result.revenueChurnRate)
        process.stdout.write(
          `${pc.bold(formatPercent(result.revenueChurnRate))}  ${benchmark}\n`
        )
        process.stdout.write(
          `MRR lost:  ${pc.dim(formatCurrency(result.mrrLost, result.currency))}\n`
        )
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
