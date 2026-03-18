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
    canceledAt: null,
    currency: sub.currency ?? 'usd',
  }
}

export function makeActiveCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('active')
    .description('List all active customers sorted by MRR')
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

        const [subs, productMap] = await withSpinner(
          'Fetching active customers...',
          () => Promise.all([
            fetcher.getActiveSubscriptions(),
            fetcher.getProductMap(),
          ]),
          opts
        )

        const customers = subs
          .map((s) => formatCustomerFromSub(s, productMap))
          .sort((a, b) => b.mrr - a.mrr)

        const totalMrr = customers.reduce((sum, c) => sum + c.mrr, 0)
        const currency = customers[0]?.currency ?? 'usd'

        const result: CustomerListResult = {
          count: customers.length,
          totalMrr,
          customers,
        }

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }

        if (opts.format === 'csv' || opts.format === 'markdown') {
          const headers = ['Email', 'Name', 'Plan', 'MRR', 'Since']
          const rows = customers.map((c) => [
            c.email ?? '',
            c.name ?? '',
            c.plan,
            formatCurrency(c.mrr, c.currency),
            c.created,
          ])
          process.stdout.write(opts.format === 'csv' ? formatCsv(headers, rows) : formatMarkdown(headers, rows))
          return
        }

        if (customers.length === 0) {
          process.stdout.write(pc.dim('No active customers found.\n'))
          return
        }

        process.stdout.write(`Active Customers (${customers.length} total)\n\n`)

        const rows = customers.map((c) => ({
          customer: c.email ?? c.name ?? c.customerId,
          plan: c.plan,
          mrr: formatCurrency(c.mrr, c.currency),
          since: c.created,
        }))

        process.stdout.write(
          renderTable(rows, [
            { key: 'customer', header: 'Customer' },
            { key: 'plan', header: 'Plan' },
            { key: 'mrr', header: 'MRR' },
            { key: 'since', header: 'Since' },
          ]) + '\n'
        )

        process.stdout.write(pc.dim(`\n${customers.length} active customers  ·  Total MRR: ${formatCurrency(totalMrr, currency)}\n`))
      } catch (err) {
        outputError({ code: 'API', message: err instanceof Error ? err.message : 'Unknown error' }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
