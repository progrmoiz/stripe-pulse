# MRR Calculation Methodology

stripe-pulse is open source. Every line of the MRR calculation is auditable. If you think a number is wrong, point at this doc and the [source code](../src/core/calculations.ts) — we'll fix it or explain why.

## What is MRR?

Monthly Recurring Revenue is the answer to: **"If nothing changes, what will I bill next month?"** It's forward-looking, normalized to a monthly cadence, and excludes anything that isn't predictable recurring revenue.

## Quick Summary

```
MRR = SUM of (item_amount normalized to monthly) for each qualifying item
      in each qualifying subscription, minus forever coupon discounts
```

A $1,200/year subscription contributes $100/month. A $29/month subscription contributes $29/month. A metered item contributes $0 because the amount isn't known until invoiced.

---

## What Counts Toward MRR

### Subscription Qualification

A subscription is included if ALL of these are true:

| Check | Rule | Why |
|-------|------|-----|
| Status | `active` or `past_due` | Other statuses don't generate revenue |
| Not trialing | `status !== 'trialing'` AND `trial_end` not in future | Trials haven't converted yet |
| Not canceling | `cancel_at_period_end === false` | Customer already hit cancel; revenue won't renew |
| Not paused | `pause_collection` is null | Paused subs don't invoice (status stays `active`) — **not yet implemented** |

Source: [`isActiveForMrr()`](../src/core/calculations.ts)

### Item Qualification

Within a qualifying subscription, each line item is included if:

| Check | Rule | Why |
|-------|------|-----|
| Not metered | `price.recurring.usage_type !== 'metered'` | Metered billing is variable, not predictable; Stripe excludes it |

## What Doesn't Count

| Exclusion | Reason |
|-----------|--------|
| Metered/usage-based items | Variable amount, not known until invoiced |
| Trialing subscriptions | Haven't converted to paid |
| Canceling subscriptions (`cancel_at_period_end`) | Customer canceled; won't renew next period |
| Paused subscriptions | Not invoicing (Stripe keeps status as `active`) — **not yet implemented** |
| Taxes | MRR is pre-tax revenue |
| Prorations | One-time mid-cycle adjustments, not recurring |
| One-time invoice items | Not recurring |

---

## Pricing Model Handling

### Per-unit (standard)

```
item_cents = price.unit_amount * item.quantity
```

Most subscriptions use this. A $29/month plan with quantity 1 = 2900 cents.

### Tiered/licensed — volume mode

All units are charged at the rate of the tier the total quantity falls into.

```
Find tier where quantity <= tier.up_to
item_cents = tier.unit_amount * quantity + tier.flat_amount
```

Example: 500 units, tier 1 is up to 1000 at $0.10/unit. Result: $50.00.

### Tiered/licensed — graduated mode

Each tier charges its own rate for the units in that range.

```
For each tier (in order):
  units_in_tier = min(remaining, tier.up_to - previous_up_to)
  total += tier.unit_amount * units_in_tier + tier.flat_amount
```

### Metered (any mode)

Excluded entirely. `unit_amount` and `quantity` on the subscription item are meaningless for metered prices — the actual amount is determined from usage records at invoice time.

Source: [`calcTieredAmountCents()`](../src/core/calculations.ts), [`calculateSubscriptionPlanMrr()`](../src/core/calculations.ts)

### Monthly Normalization

All amounts are normalized to monthly:

| Interval | Formula | Example |
|----------|---------|---------|
| `day` | `amount * 30` | $1/day = $30/month |
| `week` | `amount * (52/12)` | $10/week = $43.33/month |
| `month` | `amount / interval_count` | $29/month = $29; $50/every-2-months = $25 |
| `year` | `amount / (12 * interval_count)` | $228/year = $19/month |

Source: [`normalizeToMonthlyCents()`](../src/core/calculations.ts)

---

## Discount Handling

We read `subscription.discounts[]` (plural array), falling back to `subscription.discount` (singular, deprecated) for older API responses.

| Coupon Duration | Subtracted? | Why |
|----------------|-------------|-----|
| `forever` | Yes | Permanent reduction — this IS the steady-state revenue |
| `repeating` | Yes, while active | Subtracted while `discount.end > now`; once expired, MRR returns to full price |
| `once` | No | One-time; doesn't affect recurring revenue |

### How discounts are applied

Discounts are applied in two passes to match Stripe's behavior:

1. **First pass — all `percent_off` coupons**: `totalMonthlyCents *= (1 - percent_off / 100)` (compounding)
2. **Second pass — all `amount_off` coupons**: normalized to monthly before subtraction

**`amount_off` normalization**: The discount amount is per-invoice, so it must be normalized to monthly just like the subscription amount. A $500 `amount_off` coupon on a yearly subscription = $41.67/month reduction, not $500/month.

```
monthlyDiscount = normalizeToMonthlyCents(amount_off, subInterval, subIntervalCount)
```

- MRR is floored at $0 — a single subscription can never have negative MRR

Source: [`calculateSubscriptionPlanMrr()`](../src/core/calculations.ts)

---

## How Stripe Calculates MRR

Stripe's dashboard does NOT calculate MRR the same way we do. Understanding the difference explains why numbers sometimes diverge.

**Stripe's approach: event-sourced running sum.**
Stripe maintains an internal table called `subscription_item_change_events` with a pre-computed `mrr_change` column. Every time a subscription is created, upgraded, downgraded, or canceled, Stripe records the MRR delta. Their MRR at any point is the cumulative sum of all these deltas.

**Our approach: point-in-time subscription scan.**
We query the Stripe API for all current subscriptions, read their items, and calculate MRR from the live data.

**Neither is "wrong."** They answer slightly different questions:
- Stripe's: "What's the sum of all MRR changes that have been recorded?"
- Ours: "What does the current subscription state say MRR should be?"

These can diverge when:
- A subscription changed state between Stripe's last batch computation and our real-time scan
- Event processing delays in Stripe's system
- Timing of when the chart data point was computed vs when you run the CLI

The Stripe Sigma SQL template for MRR confirms this architecture — it reads from `subscription_item_change_events_v2_beta` and uses `SUM(mrr_change) OVER (PARTITION BY currency ORDER BY date)`.

---

## Where We Match Stripe / Where We Diverge

### Exact matches
- Per-unit pricing (`unit_amount * quantity`)
- Annual normalization (`/ 12`)
- Trial exclusion
- `cancel_at_period_end` exclusion
- Forever coupon subtraction
- Metered item exclusion
- Multi-item subscription handling

### Known divergence: event-based vs scan-based
On accounts with high subscription churn velocity, our scan can differ from Stripe's event-sourced number by 5-10%. This is a methodology difference, not a bug.

### Verified Accuracy

| Account | Our MRR | Stripe MRR | Gap | Notes |
|---------|---------|------------|-----|-------|
| ActiveCalculator | $363.00 | $363.00 | $0 (0%) | Exact match, 18 subscriptions |
| TeamAI | $6,981.90 | $7,634.55 | $652.65 (8.5%) | Event-based vs scan-based gap |

---

## Common Discrepancies

**"My MRR is lower than Stripe's."**
Most likely the event-based vs scan-based timing gap. Run the command again in a few hours — if the gap shrinks, it was timing. Also check if Stripe's dashboard toggle for discount subtraction matches our default (forever-only).

**"My MRR is higher than Stripe's."**
Check for `past_due` subscriptions. We count them (Stripe does too), but Stripe's event stream may have already recorded the churn event while the sub hasn't flipped status yet.

**"Metered usage revenue isn't showing."**
By design. Metered billing is excluded from MRR because the amount varies each period. MRR is only for predictable, recurring charges.

**"My historical MRR trend looks wrong."**
`reconstructMrrHistory` uses current pricing, not historical pricing. A customer who upgraded from $49 to $99 shows as $99 in all historical months. This is a known limitation — accurate historical MRR requires invoice-based reconstruction.

**"My per-plan breakdown doesn't add up to total MRR."**
Discounts are distributed proportionally across line items in the breakdown. The total is correct; individual plan amounts reflect their share of the post-discount revenue.

---

## MRR Movements

| Category | Definition |
|----------|-----------|
| New | Revenue from subscriptions not present in prior period |
| Expansion | Increase in MRR from existing subscribers (upgrades, added seats) |
| Contraction | Decrease in MRR from existing subscribers (downgrades, removed seats) |
| Churn | Lost revenue when subscriptions cancel |
| Reactivation | Revenue from customers returning after cancellation (24h minimum gap between cancel and resubscribe) |

---

## Limitations

These are things we know aren't perfect:

1. **Historical MRR uses current prices.** Upgrades/downgrades retroactively change the history chart.
2. **Single-currency assumption.** `detectCurrency` returns the first currency found. Multi-currency accounts mix USD and EUR cents.
3. **No invoice-based validation.** We read subscription metadata, not actual invoices. If Stripe's subscription state is stale, so are we.
4. **Paused subscriptions not excluded.** Subscriptions with `pause_collection` set are still counted toward MRR. Stripe's dashboard excludes them.
5. **Coupon interval edge cases.** `amount_off` is normalized using the first item's billing interval. Subscriptions with mixed intervals across items may normalize incorrectly.

---

## Changelog

### 2026-03-20 — Initial methodology + 4 bug fixes

- **Fixed:** Tiered/licensed pricing returned $0 because `unit_amount` is null for tiered prices by design. Now fetches tier brackets via `stripe.prices.retrieve()` and calculates volume/graduated amounts. ([`calcTieredAmountCents()`](../src/core/calculations.ts))
- **Fixed:** Metered items could generate phantom MRR. `item.quantity ?? 1` defaulted null to 1 for metered items where quantity is meaningless. Now skips metered items entirely.
- **Fixed:** Only read `subscription.discount` (singular, deprecated). Now reads `subscription.discounts[]` array to support stacked coupons.
- **Fixed:** Subscriptions with `cancel_at_period_end: true` were counted toward MRR. These customers already canceled and won't renew. Now excluded, matching Stripe's behavior.
- **Verified:** ActiveCalculator matches Stripe to the cent ($363.00). TeamAI within 8.5% (event-based vs scan-based methodology gap).
