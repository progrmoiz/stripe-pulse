import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey, resolveProfile, getActiveProfile } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency, formatPercent } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { banner } from '../lib/banner.js'
import { horizontalBar } from '../lib/bar.js'
import { churnBenchmark, nrrBenchmark, quickRatioBenchmark } from '../lib/benchmarks.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import {
  calculateMrr,
  calculatePeriodMrr,
  calculateArpu,
  calculateCustomerChurn,
  calculateRevenueChurn,
  calculateLtv,
  calculateMrrMovements,
  calculateNetRevenueRetention,
  calculateQuickRatio,
  calculateCustomerMetrics,
} from '../core/calculations.js'
import type { SaasDashboard } from '../core/types.js'

export function makeDashboardCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('dashboard')
    .description('Show full SaaS metrics dashboard')
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
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        const startStr = thirtyDaysAgo.toISOString().slice(0, 10)
        const endStr = now.toISOString().slice(0, 10)

        // Single spinner — fetch all data in parallel
        const [activeSubs, allSubs, newSubs, canceledSubs, productMap] = await withSpinner(
          'Fetching metrics...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getAllSubscriptions(),
            fetcher.getNewSubscriptionsInPeriod(thirtyDaysAgo, now),
            fetcher.getCanceledSubscriptionsInPeriod(thirtyDaysAgo, now),
            fetcher.getProductMap().catch(() => new Map<string, string>()),
          ]),
          opts
        )

        // ── Calculations ──────────────────────────────────────────────────────

        // MRR + breakdown
        const mrrResult = calculateMrr(activeSubs)

        // Customer metrics (active, trialing, past due)
        const customerMetrics = calculateCustomerMetrics(allSubs)

        // ARPU
        const arpuResult = calculateArpu(mrrResult.mrr, mrrResult.activeSubscriptions, mrrResult.currency)

        // Churn
        const churnResult = calculateCustomerChurn(activeSubs, canceledSubs, startStr, endStr)

        // MRR movements (same logic as movements.ts and dashboard MCP tool)
        const newIds = new Set(newSubs.map((s) => s.id))
        const previousSubs = [
          ...activeSubs.filter((s) => !newIds.has(s.id)),
          ...canceledSubs,
        ]
        const startMrr = calculatePeriodMrr(previousSubs)
        const movements = calculateMrrMovements(activeSubs, previousSubs)
        movements.period = { start: startStr, end: endStr }

        // Revenue churn
        const revChurn = calculateRevenueChurn(startMrr, movements.churnedMrr, startStr, endStr, mrrResult.currency)

        // LTV
        const ltvResult = calculateLtv(arpuResult.arpu, churnResult.customerChurnRate, mrrResult.currency)

        // NRR
        const nrrResult = calculateNetRevenueRetention(
          startMrr,
          movements.expansionMrr,
          movements.contractionMrr,
          movements.churnedMrr,
          startStr,
          endStr,
          mrrResult.currency,
        )

        // Quick Ratio
        const qrResult = calculateQuickRatio(
          movements.newMrr,
          movements.expansionMrr,
          movements.churnedMrr,
          movements.contractionMrr,
          mrrResult.currency,
        )

        // Trial conversion (90-day window)
        const startTs90 = Math.floor(ninetyDaysAgo.getTime() / 1000)
        const endTs = Math.floor(now.getTime() / 1000)
        const trialsStarted = allSubs.filter(
          (sub) =>
            sub.trial_start !== null &&
            sub.trial_start !== undefined &&
            sub.trial_start >= startTs90 &&
            sub.trial_start <= endTs,
        )
        const trialsConverted = trialsStarted.filter(
          (sub) => sub.status === 'active' || sub.status === 'past_due',
        )
        const trialConversionRate =
          trialsStarted.length === 0
            ? null
            : Math.round((trialsConverted.length / trialsStarted.length) * 100 * 100) / 100

        // ── Build JSON result ────────────────────────────────────────────────

        const dashboard: SaasDashboard = {
          mrr: mrrResult.mrr,
          arr: mrrResult.arr,
          activeSubscribers: mrrResult.activeSubscriptions,
          arpu: arpuResult.arpu,
          customerChurnRate: churnResult.customerChurnRate,
          revenueChurnRate: revChurn.revenueChurnRate,
          ltv: ltvResult.ltv,
          nrr: nrrResult.nrr,
          quickRatio: qrResult.quickRatio === Infinity ? null : qrResult.quickRatio,
          trialConversionRate,
          mrrByPlan: mrrResult.breakdown.map(p => ({
            ...p,
            productName: productMap.get(p.productId) ?? p.productName,
          })),
          currency: mrrResult.currency,
          dataAsOf: now.toISOString(),
        }

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(dashboard, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const cur = mrrResult.currency
          const headers = ['Metric', 'Value']
          const rows: string[][] = [
            ['MRR', formatCurrency(dashboard.mrr, cur)],
            ['ARR', formatCurrency(dashboard.arr, cur)],
            ['Customers', String(dashboard.activeSubscribers)],
            ['ARPU', formatCurrency(dashboard.arpu, cur)],
            ['Churn', dashboard.customerChurnRate === null ? 'N/A' : formatPercent(dashboard.customerChurnRate)],
            ['Revenue Churn', dashboard.revenueChurnRate === null ? 'N/A' : formatPercent(dashboard.revenueChurnRate)],
            ['LTV', dashboard.ltv === null ? 'N/A' : formatCurrency(dashboard.ltv, cur)],
            ['NRR', dashboard.nrr === null ? 'N/A' : formatPercent(dashboard.nrr)],
            ['Quick Ratio', dashboard.quickRatio === null ? '∞' : String(dashboard.quickRatio)],
            ['Trial Conversion', dashboard.trialConversionRate === null ? 'N/A' : formatPercent(dashboard.trialConversionRate)],
          ]
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        // ── Human output ─────────────────────────────────────────────────────

        const cur = mrrResult.currency
        const profileObj = resolveProfile(opts)
        const profileLabel = profileObj?.name ?? getActiveProfile()
        const modeLabel = (apiKey.startsWith('sk_live') || apiKey.startsWith('rk_live')) ? 'live' : 'test'

        // Banner
        process.stdout.write('\n')
        process.stdout.write(banner(`${profileLabel} (${modeLabel})`) + '\n\n')

        // ── Core metrics ────────────────────────────────────────────────────

        const col1 = 14  // label width
        const col2 = 12  // value width

        function metricLine(label: string, value: string, note?: string): string {
          const line = `  ${pc.bold(label.padEnd(col1))}${value.padStart(col2)}`
          return note ? `${line}   ${note}` : line
        }

        process.stdout.write(metricLine('MRR', formatCurrency(mrrResult.mrr, cur)) + '\n')
        process.stdout.write(metricLine('ARR', formatCurrency(mrrResult.arr, cur)) + '\n')

        const customerNote = pc.dim(
          `(${customerMetrics.trialingCustomers} trialing, ${customerMetrics.pastDueCustomers} past due)`
        )
        process.stdout.write(metricLine('Customers', String(mrrResult.activeSubscriptions), customerNote) + '\n')
        process.stdout.write(metricLine('ARPU', formatCurrency(arpuResult.arpu, cur)) + '\n')
        process.stdout.write(metricLine('Churn', formatPercent(churnResult.customerChurnRate), churnBenchmark(churnResult.customerChurnRate)) + '\n')
        process.stdout.write(metricLine('LTV', formatCurrency(ltvResult.ltv, cur)) + '\n')
        process.stdout.write(metricLine('NRR', formatPercent(nrrResult.nrr), nrrBenchmark(nrrResult.nrr)) + '\n')

        const qr = qrResult.quickRatio === Infinity ? '∞' : String(qrResult.quickRatio)
        const qrBenchmark = qrResult.quickRatio === Infinity ? pc.green('✓ No churn') : quickRatioBenchmark(qrResult.quickRatio)
        process.stdout.write(metricLine('Quick Ratio', qr, qrBenchmark) + '\n')

        process.stdout.write('\n')

        // ── MRR Movements ───────────────────────────────────────────────────

        process.stdout.write(`  ${pc.bold('MRR Movements')} ${pc.dim('(last 30 days)')}\n`)

        const netSign = movements.netNewMrr >= 0 ? '+' : ''
        const netColor = movements.netNewMrr >= 0 ? pc.green : pc.red

        process.stdout.write(`  ├─ New          ${pc.green(`+${formatCurrency(movements.newMrr, cur)}`)}\n`)
        process.stdout.write(`  ├─ Expansion    ${pc.green(`+${formatCurrency(movements.expansionMrr, cur)}`)}\n`)
        process.stdout.write(`  ├─ Contraction  ${pc.yellow(`-${formatCurrency(movements.contractionMrr, cur)}`)}\n`)
        process.stdout.write(`  ├─ Churned      ${pc.red(`-${formatCurrency(movements.churnedMrr, cur)}`)}\n`)
        process.stdout.write(`  ├─ Reactivation ${pc.green(`+${formatCurrency(movements.reactivationMrr, cur)}`)}\n`)
        process.stdout.write(`  └─ Net          ${netColor(`${netSign}${formatCurrency(movements.netNewMrr, cur)}`)}\n`)

        process.stdout.write('\n')

        // ── Revenue by Plan ─────────────────────────────────────────────────

        if (mrrResult.breakdown.length > 0) {
          process.stdout.write(`  ${pc.bold('Revenue by Plan')}\n`)

          // Filter out $0 MRR plans from display
          const visiblePlans = mrrResult.breakdown.filter(p => p.mrr > 0)
          const displayPlans = visiblePlans.length > 0 ? visiblePlans : mrrResult.breakdown

          const maxPlanMrr = Math.max(...displayPlans.map((p) => p.mrr), 1)
          const breakdownTotal = displayPlans.reduce((sum, p) => sum + p.mrr, 0) || 1

          // Calculate column widths from data
          const nameCol = Math.max(
            ...displayPlans.map(p => {
              const resolvedName = productMap.get(p.productId) ?? p.productName
              return (p.nickname ?? (resolvedName.startsWith('prod_') ? `Plan ${p.priceId.slice(-6)}` : resolvedName)).length
            }),
            12,
          ) + 2

          for (const plan of displayPlans) {
            const resolvedName = productMap.get(plan.productId) ?? plan.productName
            const label = plan.nickname ?? (resolvedName.startsWith('prod_') ? `Plan ${plan.priceId.slice(-6)}` : resolvedName)
            const intervalLabel = plan.interval === 'year' ? '/yr' : '/mo'
            const unitPrice = plan.subscriptionCount > 0
              ? plan.interval === 'year'
                ? plan.mrr / plan.subscriptionCount * 12
                : plan.mrr / plan.subscriptionCount
              : 0
            const priceStr = `(${formatCurrency(Math.round(unitPrice * 100) / 100, cur)}${intervalLabel})`
            const bar = horizontalBar(plan.mrr, maxPlanMrr, 12)
            const pct = `${Math.round((plan.mrr / breakdownTotal) * 100)}%`

            process.stdout.write(
              `  ${label.padEnd(nameCol)}` +
              `${pc.dim(priceStr.padEnd(16))}` +
              `${formatCurrency(plan.mrr, cur).padStart(11)}  ` +
              `${bar}  ${pct.padStart(4)}  ` +
              `${pc.dim(`${plan.subscriptionCount} subs`)}\n`
            )
          }
        }

        process.stdout.write('\n')
        process.stdout.write(pc.dim(`  Updated: ${now.toISOString().replace('T', ' ').slice(0, 16)}\n`))
        process.stdout.write('\n')
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
