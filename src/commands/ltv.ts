import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency, formatPercent } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrr, calculateArpu, calculateCustomerChurn, calculateLtv } from '../core/calculations.js'

export function makeLtvCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('ltv')
    .description('Show estimated Customer Lifetime Value')
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

        const now = new Date()
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        const startDate = thirtyDaysAgo.toISOString().slice(0, 10)
        const endDate = now.toISOString().slice(0, 10)

        const [activeSubs, allSubs, canceledSubs, newSubs, allCanceledSubs] = await withSpinner(
          'Fetching subscriptions...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getAllSubscriptions(),
            fetcher.getCanceledSubscriptionsInPeriod(thirtyDaysAgo, now),
            fetcher.getNewSubscriptionsInPeriod(thirtyDaysAgo, now),
            fetcher.getAllCanceledSubscriptions(),
          ]),
          opts
        )

        const tiersMap = await fetcher.getPriceTiers(activeSubs)
        const mrrResult = calculateMrr(activeSubs, tiersMap)
        const arpuResult = calculateArpu(mrrResult.mrr, mrrResult.activeSubscriptions, mrrResult.currency)
        const churnResult = calculateCustomerChurn(allSubs, canceledSubs, startDate, endDate, allCanceledSubs, newSubs)
        const result = calculateLtv(arpuResult.arpu, churnResult.customerChurnRate, mrrResult.currency)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value']
          const rows = [
            ['LTV', formatCurrency(result.ltv, result.currency)],
            ['ARPU', formatCurrency(result.arpu, result.currency)],
            ['Monthly Churn Rate', formatPercent(result.monthlyChurnRate)],
            ['Avg Lifespan Months', result.avgLifespanMonths.toFixed(1)],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        if (opts.verbose) {
          process.stdout.write(`LTV:              ${pc.bold(formatCurrency(result.ltv, result.currency))}\n`)
          process.stdout.write(`ARPU:             ${formatCurrency(result.arpu, result.currency)}\n`)
          process.stdout.write(`Monthly churn:    ${formatPercent(result.monthlyChurnRate)}\n`)
          process.stdout.write(`Avg lifespan:     ${result.avgLifespanMonths.toFixed(1)} months\n`)
        } else {
          process.stdout.write(formatCurrency(result.ltv, result.currency) + '\n')
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
