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
import type { TrialConversionResult } from '../core/types.js'
import Stripe from 'stripe'

/** Default look-back window for trial conversion analysis. */
const TRIAL_PERIOD_DAYS = 90

/**
 * Calculate trial conversion rate from a set of subscriptions.
 * A trial is "started" when a sub has/had a trial_start in the period.
 * A trial is "converted" when that sub is now active (non-trialing).
 */
function calculateTrialConversion(
  subs: Stripe.Subscription[],
  startDate: string,
  endDate: string,
): TrialConversionResult {
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate).getTime() / 1000)

  // Subs that started a trial in the period
  const trialsStarted = subs.filter((sub) => {
    const ts = sub.trial_start
    return ts !== null && ts >= startTs && ts <= endTs
  })

  // Converted = started trial in period AND is now active (not trialing)
  const trialsConverted = trialsStarted.filter(
    (sub) => sub.status === 'active' || sub.status === 'past_due'
  )

  const started = trialsStarted.length
  const converted = trialsConverted.length
  const conversionRate = started === 0 ? 0 : Math.round((converted / started) * 1000) / 10

  return {
    period: { start: startDate, end: endDate },
    conversionRate,
    trialsStarted: started,
    trialsConverted: converted,
  }
}

export function makeTrialsCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('trials')
    .description('Show trial-to-paid conversion rate')
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
        const periodStart = new Date(now.getTime() - TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000)
        const startDate = periodStart.toISOString().slice(0, 10)
        const endDate = now.toISOString().slice(0, 10)

        const subs = await withSpinner('Fetching subscriptions...', () => fetcher.getAllSubscriptions(), opts)
        const result = calculateTrialConversion(subs, startDate, endDate)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value']
          const rows = [
            ['Conversion Rate', formatPercent(result.conversionRate)],
            ['Trials Started', String(result.trialsStarted)],
            ['Trials Converted', String(result.trialsConverted)],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        process.stdout.write(
          `${pc.bold(formatPercent(result.conversionRate))}  ` +
          `${pc.dim(`${result.trialsStarted} started, ${result.trialsConverted} converted (last ${TRIAL_PERIOD_DAYS} days)`)}\n`
        )
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
