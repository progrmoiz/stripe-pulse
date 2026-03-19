import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { horizontalBarChart } from '../lib/bar.js'
import { sparkline } from '../lib/sparkline.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateMrr, calculateMrrMovements, calculatePeriodMrr, reconstructMrrHistory } from '../core/calculations.js'
import plot from 'simple-ascii-chart'

export function makeMrrCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('mrr')
    .description('Show Monthly Recurring Revenue')
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
        const result = calculateMrr(subs)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Metric', 'Value', 'Currency']
          const rows = [
            ['MRR', formatCurrency(result.mrr, result.currency), result.currency.toUpperCase()],
            ['ARR', formatCurrency(result.arr, result.currency), result.currency.toUpperCase()],
            ['Active Subscriptions', String(result.activeSubscriptions), ''],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        if (opts.chart) {
          const cur = result.currency

          // Fetch all canceled subs + movements data
          const [allCanceled, newSubs, canceledInPeriod] = await withSpinner('Fetching history...', () => {
            const now = new Date()
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            return Promise.all([
              fetcher.getAllCanceledSubscriptions(),
              fetcher.getNewSubscriptionsInPeriod(thirtyDaysAgo, now),
              fetcher.getCanceledSubscriptionsInPeriod(thirtyDaysAgo, now),
            ])
          }, opts)

          // ── 1. MRR Trend (last 6 months) ──
          const history = reconstructMrrHistory(subs, allCanceled, 6)
          const mrrValues = history.map(p => p.mrr)

          // Header with sparkline
          const spark = sparkline(mrrValues)
          process.stdout.write(`\n  ${pc.bold('MRR')}  ${pc.bold(formatCurrency(result.mrr, cur))}  ${spark}    ${pc.dim('ARR')}  ${pc.dim(formatCurrency(result.arr, cur))}\n\n`)

          // ASCII line chart
          if (history.length > 1) {
            const chartData: [number, number][] = history.map((p, i) => [i, p.mrr])
            const chart = plot(chartData, {
              width: 50,
              height: 8,
              formatter: (v, { axis }) => axis === 'y' ? `$${v}` : history[v]?.date ?? String(v),
            })
            process.stdout.write(chart + '\n\n')
          }

          // ── 2. Movements Waterfall ──
          const now = new Date()
          const newIds = new Set(newSubs.map(s => s.id))
          const previousSubs = [...subs, ...canceledInPeriod].filter(
            s => !newIds.has(s.id)
          )
          const movements = calculateMrrMovements(subs, previousSubs, allCanceled)

          process.stdout.write(`  ${pc.bold('MRR Movements')} ${pc.dim('(last 30 days)')}\n`)

          const barW = 30
          const growthItems = [
            { label: 'New', value: movements.newMrr, formatted: `+${formatCurrency(movements.newMrr, cur)}` },
            { label: 'Expansion', value: movements.expansionMrr, formatted: `+${formatCurrency(movements.expansionMrr, cur)}` },
            { label: 'Reactivation', value: movements.reactivationMrr, formatted: `+${formatCurrency(movements.reactivationMrr, cur)}` },
          ].filter(i => i.value > 0)

          const lossItems = [
            { label: 'Contraction', value: movements.contractionMrr, formatted: `-${formatCurrency(movements.contractionMrr, cur)}` },
            { label: 'Churned', value: movements.churnedMrr, formatted: `-${formatCurrency(movements.churnedMrr, cur)}` },
          ].filter(i => i.value > 0)

          if (growthItems.length > 0) {
            process.stdout.write(horizontalBarChart(growthItems, barW) + '\n')
          }
          if (lossItems.length > 0) {
            const maxLabel = Math.max(...lossItems.map(i => i.label.length), 1)
            const maxFmt = Math.max(...lossItems.map(i => i.formatted.length), 1)
            const maxVal = Math.max(...lossItems.map(i => i.value), 1)
            for (const item of lossItems) {
              const filled = Math.round((item.value / maxVal) * barW)
              process.stdout.write(`  ${item.label.padEnd(maxLabel)}  ${pc.bold(item.formatted.padStart(maxFmt))}  ${pc.red('█'.repeat(Math.max(filled, 1)))}\n`)
            }
          }

          // Net line
          const net = movements.netNewMrr
          const netSign = net >= 0 ? '+' : ''
          const netColor = net >= 0 ? pc.green : pc.red
          const arrow = net > 0 ? '↑' : net < 0 ? '↓' : '→'
          const growthPct = result.mrr > 0 ? ((net / (result.mrr - net)) * 100).toFixed(1) : '0.0'
          process.stdout.write(`  ${'─'.repeat(50)}\n`)
          process.stdout.write(`  ${pc.bold('Net')}           ${netColor(`${netSign}${formatCurrency(Math.abs(net), cur)}`)}  ${netColor(`${arrow} ${growthPct}%`)}\n\n`)
          return
        }

        if (opts.verbose) {
          process.stdout.write(`MRR:          ${pc.bold(formatCurrency(result.mrr, result.currency))}\n`)
          process.stdout.write(`ARR:          ${formatCurrency(result.arr, result.currency)}\n`)
          process.stdout.write(`Active subs:  ${result.activeSubscriptions}\n`)
          process.stdout.write(`Currency:     ${result.currency.toUpperCase()}\n`)
        } else {
          process.stdout.write(formatCurrency(result.mrr, result.currency) + '\n')
        }
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
