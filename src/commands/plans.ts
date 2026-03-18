import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency, formatPercent } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { labeledBar, horizontalBarChart } from '../lib/bar.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrr } from '../core/calculations.js'

export function makePlansCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('plans')
    .description('Show revenue breakdown by plan')
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

        const [subs, productMap] = await withSpinner('Fetching plans...', () => Promise.all([
          fetcher.getActiveSubscriptions(),
          fetcher.getProductMap().catch(() => new Map<string, string>()),
        ]), opts)
        const result = calculateMrr(subs)
        const breakdown = result.breakdown

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(breakdown, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Plan', 'Interval', 'MRR', 'Subscriptions', 'Share']
          const totalMrrForFormat = result.mrr || 1
          const rows = breakdown.map((plan) => {
            const resolvedName = productMap.get(plan.productId) ?? plan.productName
            const label = plan.nickname ?? (resolvedName.startsWith('prod_') ? `Plan ${plan.priceId.slice(-6)}` : resolvedName)
            const pct = totalMrrForFormat === 0 ? '0.0%' : formatPercent((plan.mrr / totalMrrForFormat) * 100)
            return [
              label,
              plan.interval,
              formatCurrency(plan.mrr, result.currency),
              String(plan.subscriptionCount),
              pct,
            ]
          })
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        if (opts.chart) {
          const items = breakdown
            .filter(p => p.mrr > 0)
            .sort((a, b) => b.mrr - a.mrr)
            .map(p => {
              const resolvedName = productMap.get(p.productId) ?? p.productName
              const label = p.nickname ?? (resolvedName.startsWith('prod_') ? `Plan ${p.priceId.slice(-6)}` : resolvedName)
              return { label, value: p.mrr, formatted: formatCurrency(p.mrr, result.currency) }
            })
          if (items.length > 0) {
            process.stdout.write(horizontalBarChart(items) + '\n')
          }
          return
        }

        if (breakdown.length === 0) {
          process.stdout.write(pc.dim('No active plans found.\n'))
          return
        }

        const maxMrr = Math.max(...breakdown.map((p) => p.mrr), 1)
        const totalMrr = result.mrr

        // Header
        process.stdout.write(
          pc.bold('Plan'.padEnd(28)) +
          pc.bold('Interval'.padEnd(10)) +
          pc.bold('MRR'.padStart(10)) +
          '  ' +
          pc.bold('Subs'.padStart(5)) +
          '  ' +
          pc.bold('Share') +
          '\n'
        )
        process.stdout.write(pc.dim('-'.repeat(70) + '\n'))

        for (const plan of breakdown) {
          const resolvedName = productMap.get(plan.productId) ?? plan.productName
          const label = (plan.nickname ?? (resolvedName.startsWith('prod_') ? `Plan ${plan.priceId.slice(-6)}` : resolvedName)).slice(0, 27)
          const mrrStr = formatCurrency(plan.mrr, result.currency)
          const pct = totalMrr === 0 ? '0.0%' : formatPercent((plan.mrr / totalMrr) * 100)
          const extra = pc.dim(`${plan.subscriptionCount} subs`)

          process.stdout.write(
            labeledBar(label, mrrStr, plan.mrr, maxMrr, pct, extra, 28, 12) + '\n'
          )
        }

        process.stdout.write(pc.dim('-'.repeat(70) + '\n'))
        process.stdout.write(`${'Total'.padEnd(28)}${' '.repeat(10)}${formatCurrency(totalMrr, result.currency).padStart(10)}\n`)
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
