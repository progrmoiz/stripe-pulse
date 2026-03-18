import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrrMovements, calculateQuickRatio } from '../core/calculations.js'
import { quickRatioBenchmark } from '../lib/benchmarks.js'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

export function makeQuickRatioCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('quick-ratio')
    .description('Show SaaS quick ratio (growth efficiency) for a period')
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
        const result = calculateQuickRatio(
          movements.newMrr,
          movements.expansionMrr,
          movements.churnedMrr,
          movements.contractionMrr,
          movements.currency
        )

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value']
          const rows = [
            ['Quick Ratio', result.quickRatio === Infinity ? '∞' : result.quickRatio.toFixed(2)],
            ['New MRR', formatCurrency(result.newMrr, result.currency)],
            ['Expansion MRR', formatCurrency(result.expansionMrr, result.currency)],
            ['Churned MRR', formatCurrency(result.churnedMrr, result.currency)],
            ['Contraction MRR', formatCurrency(result.contractionMrr, result.currency)],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        const displayRatio = result.quickRatio === Infinity ? '∞' : result.quickRatio.toFixed(2)
        const benchmark = quickRatioBenchmark(result.quickRatio === Infinity ? 999 : result.quickRatio)
        process.stdout.write(
          `${pc.bold(displayRatio)}  ${benchmark}\n`
        )
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
