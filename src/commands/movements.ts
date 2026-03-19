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
import { calculateMrrMovements } from '../core/calculations.js'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

export function makeMovementsCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('movements')
    .description('Show MRR movements breakdown for a period')
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

        const newIds = new Set(newSubs.map((s) => s.id))
        const previousSubs = [...activeSubs, ...canceledSubs].filter(
          (s) => !newIds.has(s.id)
        )

        const result = calculateMrrMovements(activeSubs, previousSubs, allCanceledSubs)
        // Stamp the period on the result
        result.period = { start: startDate, end: endDate }

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Type', 'Amount', 'Currency']
          const cur = result.currency
          const rows = [
            ['New', formatCurrency(result.newMrr, cur), cur.toUpperCase()],
            ['Expansion', formatCurrency(result.expansionMrr, cur), cur.toUpperCase()],
            ['Contraction', formatCurrency(result.contractionMrr, cur), cur.toUpperCase()],
            ['Churned', formatCurrency(result.churnedMrr, cur), cur.toUpperCase()],
            ['Reactivation', formatCurrency(result.reactivationMrr, cur), cur.toUpperCase()],
            ['Net', formatCurrency(result.netNewMrr, cur), cur.toUpperCase()],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        const cur = result.currency
        const netSign = result.netNewMrr >= 0 ? '+' : ''
        const netColor = result.netNewMrr >= 0 ? pc.green : pc.red

        process.stdout.write(`MRR Movements (${startDate} → ${endDate})\n`)
        process.stdout.write(`├─ New          ${pc.green(`+${formatCurrency(result.newMrr, cur)}`)}\n`)
        process.stdout.write(`├─ Expansion    ${pc.green(`+${formatCurrency(result.expansionMrr, cur)}`)}\n`)
        process.stdout.write(`├─ Contraction  ${pc.yellow(`-${formatCurrency(result.contractionMrr, cur)}`)}\n`)
        process.stdout.write(`├─ Churned      ${pc.red(`-${formatCurrency(result.churnedMrr, cur)}`)}\n`)
        process.stdout.write(`├─ Reactivation ${pc.green(`+${formatCurrency(result.reactivationMrr, cur)}`)}\n`)
        process.stdout.write(`└─ Net          ${netColor(`${netSign}${formatCurrency(result.netNewMrr, cur)}`)}\n`)

        if (result.reactivations.length > 0 && !opts.verbose) {
          process.stdout.write(pc.dim(`Note: ${result.reactivations.length} subscription(s) reclassified as reactivation (use --verbose for details)\n`))
        }

        if (opts.verbose && result.reactivations.length > 0) {
          process.stdout.write(`\nReactivations:\n`)
          for (const r of result.reactivations) {
            process.stdout.write(`  Customer: ${r.customerId}\n`)
            process.stdout.write(`    Prior sub:    ${r.previousSubscriptionId}  canceled ${r.canceledAt}\n`)
            process.stdout.write(`    New sub:      ${r.newSubscriptionId}  reactivated ${r.reactivatedAt}\n`)
            process.stdout.write(`    MRR:          ${formatCurrency(r.mrrCents / 100, cur)}\n`)
          }
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
