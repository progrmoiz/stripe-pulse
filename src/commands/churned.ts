import { Command } from '@commander-js/extra-typings'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiKey } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode, formatCurrency } from '../lib/output.js'
import { formatCsv, formatMarkdown } from '../lib/format.js'
import { withSpinner } from '../lib/spinner.js'
import { renderTable } from '../lib/table.js'
import { createStripeClient } from '../core/stripe-client.js'
import { Cache } from '../core/cache.js'
import { StripeFetcher } from '../core/fetchers.js'
import { calculateSubscriptionPlanMrr } from '../core/calculations.js'
import type { CustomerListResult, FormattedCustomer } from '../core/types.js'
import type Stripe from 'stripe'

function resolvePeriod(opts: GlobalOpts): { startDate: string; endDate: string } {
  const endDate = opts.to ?? new Date().toISOString().split('T')[0]
  const startDate = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { startDate, endDate }
}

function formatCustomerFromSub(sub: Stripe.Subscription, productMap: Map<string, string>): FormattedCustomer {
  const customer = sub.customer
  const isFullCustomer = typeof customer !== 'string' && 'email' in customer
  const planPrice = sub.items.data[0]?.price
  const productId =
    typeof planPrice?.product === 'string'
      ? planPrice.product
      : planPrice?.product?.id ?? 'unknown'
  const productName = productMap.get(productId) ?? productId

  const customerId = typeof customer === 'string' ? customer : (customer as { id: string }).id

  return {
    customerId,
    email: isFullCustomer ? (customer as Stripe.Customer).email ?? null : null,
    name: isFullCustomer ? (customer as Stripe.Customer).name ?? null : null,
    subscriptionId: sub.id,
    status: sub.status,
    plan: productName,
    interval: planPrice?.recurring?.interval ?? 'unknown',
    mrr: Math.round(calculateSubscriptionPlanMrr(sub)) / 100,
    created: new Date((sub.created ?? 0) * 1000).toISOString().slice(0, 10),
    canceledAt: sub.canceled_at
      ? new Date(sub.canceled_at * 1000).toISOString().slice(0, 10)
      : null,
    currency: sub.currency ?? 'usd',
  }
}

export function makeChurnedCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('churned')
    .description('List customers who canceled in a period')
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

        const [canceledSubs, productMap] = await withSpinner(
          'Fetching churned customers...',
          () => Promise.all([
            fetcher.getCanceledSubscriptionsInPeriod(new Date(startDate), new Date(endDate)),
            fetcher.getProductMap(),
          ]),
          opts
        )

        const customers = canceledSubs.map((s) => formatCustomerFromSub(s, productMap))
        const totalLostMrr = customers.reduce((sum, c) => sum + c.mrr, 0)
        const currency = customers[0]?.currency ?? 'usd'

        const result: CustomerListResult = {
          period: { start: startDate, end: endDate },
          count: customers.length,
          totalMrr: totalLostMrr,
          customers,
        }

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Email', 'Name', 'Plan', 'Lost MRR', 'Canceled']
          const rows = customers.map((c) => [
            c.email ?? '',
            c.name ?? '',
            c.plan,
            formatCurrency(c.mrr, c.currency),
            c.canceledAt ?? c.created,
          ])
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        if (customers.length === 0) {
          process.stdout.write(pc.dim(`No churned customers between ${startDate} and ${endDate}.\n`))
          return
        }

        process.stdout.write(`Churned Customers (${startDate} → ${endDate})\n\n`)

        const rows = customers.map((c) => ({
          customer: c.email ?? c.name ?? c.customerId,
          plan: c.plan,
          lostMrr: formatCurrency(c.mrr, c.currency),
          canceledAt: c.canceledAt ?? c.created,
        }))

        process.stdout.write(
          renderTable(rows, [
            { key: 'customer', header: 'Customer' },
            { key: 'plan', header: 'Plan' },
            { key: 'lostMrr', header: 'Lost MRR' },
            { key: 'canceledAt', header: 'Canceled' },
          ]) + '\n'
        )

        process.stdout.write(pc.dim(`\n${customers.length} churned customers  ·  Total lost MRR: ${formatCurrency(totalLostMrr, currency)}\n`))
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
