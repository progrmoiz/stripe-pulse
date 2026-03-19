import Stripe from "stripe";
import type {
  MrrResult,
  MrrByPlan,
  MrrMovements,
  ChurnResult,
  RevenueChurnResult,
  CustomerMetrics,
  ArpuResult,
  LtvResult,
  QuickRatioResult,
  NetRevenueRetentionResult,
  ClassificationResult,
  ReactivationDetail,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────

/** Normalize a price amount (in cents) to monthly cents. */
function normalizeToMonthlyCents(
  amountCents: number,
  interval: string,
  intervalCount: number,
): number {
  switch (interval) {
    case "day":
      return amountCents * 30;
    case "week":
      return amountCents * (52 / 12);
    case "month":
      return amountCents / intervalCount;
    case "year":
      return amountCents / (12 * intervalCount);
    default:
      return amountCents;
  }
}

/** Check whether a subscription is currently trialing. */
function isTrialing(sub: Stripe.Subscription): boolean {
  if (sub.status === "trialing") return true;
  if (sub.trial_end && sub.trial_end > Math.floor(Date.now() / 1000))
    return true;
  return false;
}

/** Check whether a subscription should count toward MRR. */
function isActiveForMrr(sub: Stripe.Subscription): boolean {
  if (isTrialing(sub)) return false;
  return sub.status === "active" || sub.status === "past_due";
}

/** Resolve a product reference to its name. */
function resolveProductName(
  product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined,
): string {
  if (!product) return "Unknown";
  if (typeof product === "string") return product;
  if ("name" in product && product.name) return product.name;
  return product.id;
}

/** Detect currency from subscriptions, defaulting to 'usd'. */
export function detectCurrency(subs: Stripe.Subscription[]): string {
  for (const sub of subs) {
    if (sub.currency) return sub.currency;
    for (const item of sub.items?.data ?? []) {
      if (item.price?.currency) return item.price.currency;
    }
  }
  return "usd";
}

/** Extract customer ID from a subscription, handling both string and object forms. */
export function getCustomerId(s: Stripe.Subscription): string {
  return typeof s.customer === "string" ? s.customer : s.customer.id;
}

/**
 * Check whether a canceled subscription ever generated revenue.
 * A trial-only sub that never converted should not count as a prior
 * "paying" relationship for reactivation purposes.
 *
 * Heuristic: if the sub's plan MRR > 0 AND it was not trialing at cancellation,
 * it was paying. We also check if the status ever reached 'active' or 'past_due'
 * by looking at the current status field (for canceled subs, Stripe preserves
 * the status as 'canceled' but we can check if trial_end < canceled_at, meaning
 * the trial ended before cancellation, implying the sub was active at some point).
 */
export function wasPaying(sub: Stripe.Subscription): boolean {
  // If the plan has zero MRR, it was never paying (free plan)
  if (calculateSubscriptionPlanMrr(sub) === 0) return false;

  // If there was no trial, it was paying from the start
  if (!sub.trial_end) return true;

  // If trial ended before cancellation, the sub converted to paid at some point
  if (sub.canceled_at && sub.trial_end < sub.canceled_at) return true;

  // If trial_end is in the past and sub is canceled, it likely converted
  // (trial ended, then customer used it, then canceled)
  const now = Math.floor(Date.now() / 1000);
  if (sub.trial_end < now) return true;

  // Trial was still active at cancellation -- never paid
  return false;
}

/**
 * Partition new-in-period subscriptions into truly-new vs reactivation.
 *
 * A subscription is a "reactivation" if:
 * 1. Its customer ID matches a previously-canceled subscription's customer ID
 * 2. The prior canceled sub was actually paying (not trial-only)
 *
 * Same-period netting: if canceledInPeriod is provided, customers who both
 * canceled AND resubscribed within the same period are netted out -- their
 * new sub is classified as reactivation but their cancellation is flagged
 * for exclusion from churn counts.
 *
 * @param newSubs - Subscriptions created within the measurement period
 * @param allCanceledSubs - ALL canceled subscriptions (all-time), for customer matching
 * @param canceledInPeriod - Canceled subs within THIS period, for same-period netting
 */
export function classifyNewSubscriptions(
  newSubs: Stripe.Subscription[],
  allCanceledSubs: Stripe.Subscription[],
  canceledInPeriod?: Stripe.Subscription[],
): ClassificationResult {
  // Minimum gap between cancellation and resubscription to count as reactivation.
  // Shorter gaps are likely plan switches, payment retries, or accidental cancels.
  const MIN_REACTIVATION_GAP_SECONDS = 24 * 60 * 60; // 24 hours

  // Build map: customer ID -> best matching canceled sub (paying only)
  // "Best" = most recently canceled, so the detail output is meaningful
  const canceledByCustomer = new Map<string, Stripe.Subscription>();
  for (const sub of allCanceledSubs) {
    if (!wasPaying(sub)) continue;  // Skip trial-only subs
    const custId = getCustomerId(sub);
    const existing = canceledByCustomer.get(custId);
    if (!existing || (sub.canceled_at ?? 0) > (existing.canceled_at ?? 0)) {
      canceledByCustomer.set(custId, sub);
    }
  }

  const trulyNew: Stripe.Subscription[] = [];
  const reactivations: Stripe.Subscription[] = [];
  const reactivationDetails: ReactivationDetail[] = [];

  // Sort by created descending so we pick the most recent sub per customer
  const sorted = [...newSubs].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const seenCustomerIds = new Set<string>();

  for (const sub of sorted) {
    const custId = getCustomerId(sub);
    const priorSub = canceledByCustomer.get(custId);
    const newSubMrr = calculateSubscriptionPlanMrr(sub);

    // Check: prior paying sub exists, new sub has MRR > 0, not already seen, sufficient gap
    if (
      priorSub &&
      newSubMrr > 0 &&
      !seenCustomerIds.has(custId) &&
      (sub.created ?? 0) - (priorSub.canceled_at ?? 0) >= MIN_REACTIVATION_GAP_SECONDS
    ) {
      seenCustomerIds.add(custId);
      reactivations.push(sub);
      reactivationDetails.push({
        customerId: custId,
        previousSubscriptionId: priorSub.id,
        newSubscriptionId: sub.id,
        canceledAt: priorSub.canceled_at
          ? new Date(priorSub.canceled_at * 1000).toISOString().slice(0, 10)
          : "unknown",
        reactivatedAt: new Date((sub.created ?? 0) * 1000).toISOString().slice(0, 10),
        mrrCents: newSubMrr,
      });
    } else {
      trulyNew.push(sub);
    }
  }

  // Suppress unused parameter warning -- canceledInPeriod is available for callers
  // that need same-period netting (calculateCustomerChurn uses it directly)
  void canceledInPeriod;

  return { trulyNew, reactivations, reactivationDetails };
}

// ── Per-Subscription MRR ─────────────────────────────────

/**
 * Calculate the MRR value of a subscription's plan (in cents),
 * regardless of status. Used for churn calculations to know
 * what revenue was lost when a sub cancels.
 */
export function calculateSubscriptionPlanMrr(
  subscription: Stripe.Subscription,
): number {
  let totalMonthlyCents = 0;

  for (const item of subscription.items.data) {
    const unitAmount = item.price?.unit_amount ?? 0;
    const quantity = item.quantity ?? 1;
    const interval = item.price?.recurring?.interval ?? "month";
    const intervalCount = item.price?.recurring?.interval_count ?? 1;

    const itemCents = unitAmount * quantity;
    totalMonthlyCents += normalizeToMonthlyCents(
      itemCents,
      interval,
      intervalCount,
    );
  }

  // Apply forever coupon discounts
  const discount = subscription.discount;
  if (discount?.coupon?.duration === "forever") {
    const coupon = discount.coupon;
    if (coupon.percent_off) {
      totalMonthlyCents *= 1 - coupon.percent_off / 100;
    } else if (coupon.amount_off) {
      totalMonthlyCents -= coupon.amount_off;
    }
  }

  return Math.max(0, totalMonthlyCents);
}

/**
 * Calculate the MRR contribution of a single subscription (in cents).
 * Returns 0 for trialing or inactive subscriptions.
 */
export function calculateSubscriptionMrr(
  subscription: Stripe.Subscription,
): number {
  if (isTrialing(subscription)) return 0;
  if (!isActiveForMrr(subscription)) return 0;
  return calculateSubscriptionPlanMrr(subscription);
}

// ── Aggregate MRR ────────────────────────────────────────

export function calculateMrr(
  subscriptions: Stripe.Subscription[],
): MrrResult {
  const activeSubs = subscriptions.filter(isActiveForMrr);
  const currency = detectCurrency(subscriptions);

  let totalMrrCents = 0;
  const planMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      priceId: string;
      nickname: string | null;
      interval: string;
      mrrCents: number;
      count: number;
    }
  >();

  for (const sub of activeSubs) {
    const subMrr = calculateSubscriptionMrr(sub);
    totalMrrCents += subMrr;

    // Calculate raw (pre-discount) MRR for this subscription
    // to determine the discount ratio for breakdown allocation
    let rawSubMrrCents = 0;
    const itemMrrs: { item: Stripe.SubscriptionItem; mrrCents: number }[] = [];
    for (const item of sub.items.data) {
      const unitAmount = item.price?.unit_amount ?? 0;
      const quantity = item.quantity ?? 1;
      const interval = item.price?.recurring?.interval ?? "month";
      const intervalCount = item.price?.recurring?.interval_count ?? 1;
      const mrrCents = normalizeToMonthlyCents(
        unitAmount * quantity,
        interval,
        intervalCount,
      );
      rawSubMrrCents += mrrCents;
      itemMrrs.push({ item, mrrCents });
    }

    // Discount ratio: how much of the raw MRR survives after coupons
    const discountRatio = rawSubMrrCents > 0 ? subMrr / rawSubMrrCents : 0;

    // Build breakdown per price, applying discount proportionally
    for (const { item, mrrCents } of itemMrrs) {
      const priceId = item.price?.id ?? "unknown";
      const existing = planMap.get(priceId);
      const discountedMrrCents = mrrCents * discountRatio;

      if (existing) {
        existing.mrrCents += discountedMrrCents;
        existing.count += 1;
      } else {
        planMap.set(priceId, {
          productId:
            typeof item.price?.product === "string"
              ? item.price.product
              : item.price?.product?.id ?? "unknown",
          productName: resolveProductName(item.price?.product),
          priceId,
          nickname: item.price?.nickname ?? null,
          interval: item.price?.recurring?.interval ?? "month",
          mrrCents: discountedMrrCents,
          count: 1,
        });
      }
    }
  }

  const breakdown: MrrByPlan[] = Array.from(planMap.values()).map((p) => ({
    productId: p.productId,
    productName: p.productName,
    priceId: p.priceId,
    nickname: p.nickname,
    interval: p.interval,
    mrr: Math.round(p.mrrCents) / 100,
    subscriptionCount: p.count,
  }));

  const mrrDollars = Math.round(totalMrrCents) / 100;

  return {
    mrr: mrrDollars,
    arr: Math.round(mrrDollars * 12 * 100) / 100,
    currency,
    activeSubscriptions: activeSubs.length,
    breakdown,
  };
}

/**
 * Calculate the total MRR of a set of subscriptions using plan value,
 * regardless of current status. Used to reconstruct start-of-period MRR
 * where some subs may now be canceled but were active at the time.
 */
export function calculatePeriodMrr(subscriptions: Stripe.Subscription[]): number {
  let totalCents = 0;
  for (const sub of subscriptions) {
    totalCents += calculateSubscriptionPlanMrr(sub);
  }
  return Math.round(totalCents) / 100;
}

// ── MRR Movements ────────────────────────────────────────

export function calculateMrrMovements(
  currentSubs: Stripe.Subscription[],
  previousSubs: Stripe.Subscription[],
  allCanceledSubs: Stripe.Subscription[],  // REQUIRED -- no optional footgun
): MrrMovements {
  const currency = detectCurrency([...currentSubs, ...previousSubs]);

  // Build the reactivated sub ID set internally
  // "New" subs = in currentSubs but not in previousSubs (by sub ID)
  const prevIds = new Set(previousSubs.map(s => s.id));
  const newInPeriod = currentSubs.filter(s => !prevIds.has(s.id));
  const { reactivations, reactivationDetails } = classifyNewSubscriptions(newInPeriod, allCanceledSubs);
  const reactivatedSubIds = new Set(reactivations.map(s => s.id));

  const prevMap = new Map<string, number>();
  const prevStatusMap = new Map<string, string>();
  for (const sub of previousSubs) {
    prevMap.set(sub.id, calculateSubscriptionPlanMrr(sub));
    prevStatusMap.set(sub.id, sub.status);
  }

  const currMap = new Map<string, number>();
  const currStatusMap = new Map<string, string>();
  for (const sub of currentSubs) {
    currMap.set(sub.id, calculateSubscriptionPlanMrr(sub));
    currStatusMap.set(sub.id, sub.status);
  }

  let newMrr = 0;
  let expansionMrr = 0;
  let contractionMrr = 0;
  let churnedMrr = 0;
  let reactivationMrr = 0;

  // Analyze current subscriptions
  for (const sub of currentSubs) {
    const currMrr = currMap.get(sub.id) ?? 0;
    const prevMrr = prevMap.get(sub.id);

    if (prevMrr === undefined) {
      if (reactivatedSubIds.has(sub.id)) {
        // Returning customer with new subscription ID
        reactivationMrr += currMrr;
      } else {
        // Truly new subscription
        newMrr += currMrr;
      }
    } else {
      const prevStatus = prevStatusMap.get(sub.id);
      if (prevStatus === "canceled" && isActiveForMrr(sub)) {
        // Same-sub-ID reactivation (rare but possible)
        reactivationMrr += currMrr;
      } else if (currMrr > prevMrr) {
        expansionMrr += currMrr - prevMrr;
      } else if (currMrr < prevMrr) {
        contractionMrr += prevMrr - currMrr;
      }
    }
  }

  // Analyze churned subscriptions (in previous but not active in current)
  for (const sub of previousSubs) {
    const prevMrr = prevMap.get(sub.id) ?? 0;
    if (prevMrr === 0) continue;

    const currStatus = currStatusMap.get(sub.id);
    if (currStatus === undefined || currStatus === "canceled") {
      churnedMrr += prevMrr;
    }
  }

  const netNewMrr =
    newMrr + expansionMrr - contractionMrr - churnedMrr + reactivationMrr;

  // Convert all from cents to dollars
  return {
    period: { start: "", end: "" },
    newMrr: Math.round(newMrr) / 100,
    expansionMrr: Math.round(expansionMrr) / 100,
    contractionMrr: Math.round(contractionMrr) / 100,
    churnedMrr: Math.round(churnedMrr) / 100,
    reactivationMrr: Math.round(reactivationMrr) / 100,
    netNewMrr: Math.round(netNewMrr) / 100,
    reactivations: reactivationDetails,
    currency,
  };
}

// ── Customer Churn ───────────────────────────────────────

export function calculateCustomerChurn(
  activeSubs: Stripe.Subscription[],
  canceledInPeriod: Stripe.Subscription[],
  startDate: string,
  endDate: string,
  allCanceledSubs: Stripe.Subscription[],    // REQUIRED
  newSubsInPeriod: Stripe.Subscription[],    // REQUIRED -- for same-period netting
): ChurnResult {
  const currency = detectCurrency([...activeSubs, ...canceledInPeriod]);

  // Classify new subs, passing canceledInPeriod for same-period netting
  const { reactivations } = classifyNewSubscriptions(newSubsInPeriod, allCanceledSubs, canceledInPeriod);
  const reactivatedCustomerIds = new Set(reactivations.map(s => getCustomerId(s)));

  // Same-period netting: customers who canceled AND resubscribed in the same period
  const canceledCustomerIds = new Set(canceledInPeriod.map(getCustomerId));
  const nettedCustomerIds = new Set(
    [...reactivatedCustomerIds].filter(id => canceledCustomerIds.has(id))
  );

  // Customers at start = currently active + those who canceled in the period
  // (because they were active at start before they churned)
  const uniqueCustomersAtStart = new Set([
    ...activeSubs.filter(isActiveForMrr).map(getCustomerId),
    ...canceledInPeriod.map(getCustomerId),
  ]);

  // Customers lost = canceled in period, MINUS those who resubscribed in the same period
  const uniqueCustomersLost = new Set(
    canceledInPeriod.map(getCustomerId),
  );
  // Remove netted customers from lost count
  for (const id of nettedCustomerIds) {
    uniqueCustomersLost.delete(id);
  }

  const customersAtStart = uniqueCustomersAtStart.size;
  const customersLost = uniqueCustomersLost.size;
  const churnRate =
    customersAtStart === 0 ? 0 : (customersLost / customersAtStart) * 100;

  // Reactivated = all reactivations (including those that netted within period)
  const reactivatedCount = reactivatedCustomerIds.size;

  return {
    period: { start: startDate, end: endDate },
    customerChurnRate: Math.round(churnRate * 100) / 100,
    customersAtStart,
    customersLost,
    reactivatedCustomers: reactivatedCount,
    currency,
  };
}

// ── Revenue Churn ────────────────────────────────────────

export function calculateRevenueChurn(
  mrrAtStart: number,
  churnedMrr: number,
  startDate: string,
  endDate: string,
  currency = "usd",
): RevenueChurnResult {
  const revenueChurnRate =
    mrrAtStart === 0 ? 0 : (churnedMrr / mrrAtStart) * 100;

  return {
    period: { start: startDate, end: endDate },
    revenueChurnRate: Math.round(revenueChurnRate * 100) / 100,
    mrrAtStart,
    mrrLost: churnedMrr,
    currency,
  };
}

// ── ARPU ─────────────────────────────────────────────────

export function calculateArpu(
  mrr: number,
  activeSubscribers: number,
  currency = "usd",
): ArpuResult {
  const arpu =
    activeSubscribers === 0 ? 0 : mrr / activeSubscribers;

  return {
    arpu: Math.round(arpu * 100) / 100,
    mrr,
    activeSubscribers,
    currency,
  };
}

// ── LTV ──────────────────────────────────────────────────

export function calculateLtv(
  arpu: number,
  monthlyChurnRate: number,
  currency = "usd",
): LtvResult {
  let avgLifespanMonths: number;
  let ltv: number;

  if (monthlyChurnRate === 0) {
    avgLifespanMonths = 60; // cap at 5 years
    ltv = arpu * 60;
  } else {
    avgLifespanMonths = 1 / (monthlyChurnRate / 100);
    ltv = arpu * avgLifespanMonths;
  }

  return {
    ltv: Math.round(ltv * 100) / 100,
    arpu,
    monthlyChurnRate,
    avgLifespanMonths: Math.round(avgLifespanMonths * 100) / 100,
    currency,
  };
}

// ── Customer Metrics ─────────────────────────────────────

export function calculateCustomerMetrics(
  subscriptions: Stripe.Subscription[],
): CustomerMetrics {
  const customerStatuses = new Map<string, Set<string>>();

  for (const sub of subscriptions) {
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (!customerStatuses.has(customerId)) {
      customerStatuses.set(customerId, new Set());
    }
    customerStatuses.get(customerId)!.add(sub.status);
  }

  let activeSubscribers = 0;
  let trialingCustomers = 0;
  let pastDueCustomers = 0;

  for (const [, statuses] of customerStatuses) {
    if (statuses.has("active")) activeSubscribers++;
    if (statuses.has("trialing")) trialingCustomers++;
    if (statuses.has("past_due")) pastDueCustomers++;
  }

  return {
    totalCustomers: customerStatuses.size,
    activeSubscribers,
    trialingCustomers,
    pastDueCustomers,
  };
}

// ── Quick Ratio ──────────────────────────────────────────

export function calculateQuickRatio(
  newMrr: number,
  expansionMrr: number,
  reactivationMrr: number,  // NEW required param
  churnedMrr: number,
  contractionMrr: number,
  currency = "usd",
): QuickRatioResult {
  const denominator = churnedMrr + contractionMrr;
  const quickRatio =
    denominator === 0 ? Infinity : (newMrr + expansionMrr + reactivationMrr) / denominator;

  return {
    quickRatio: quickRatio === Infinity ? Infinity : Math.round(quickRatio * 100) / 100,
    newMrr,
    expansionMrr,
    reactivationMrr,
    churnedMrr,
    contractionMrr,
    currency,
  };
}

// ── Net Revenue Retention ────────────────────────────────

export function calculateNetRevenueRetention(
  startingMrr: number,
  expansionMrr: number,
  contractionMrr: number,
  churnedMrr: number,
  startDate: string,
  endDate: string,
  currency = "usd",
): NetRevenueRetentionResult {
  const nrr =
    startingMrr === 0
      ? 0
      : ((startingMrr + expansionMrr - contractionMrr - churnedMrr) /
          startingMrr) *
        100;

  return {
    period: { start: startDate, end: endDate },
    nrr: Math.round(nrr * 100) / 100,
    startingMrr,
    expansionMrr,
    contractionMrr,
    churnedMrr,
    currency,
  };
}

// ── Historical MRR Reconstruction ───────────────────────

export interface MrrHistoryPoint {
  date: string       // YYYY-MM label
  mrr: number        // MRR in dollars
  customers: number  // active subscription count
}

/**
 * Reconstruct approximate monthly MRR for the last N months.
 *
 * Method: For each month-end boundary, determine which subscriptions
 * were active at that point:
 *   - created before or at the month-end
 *   - NOT canceled before the month-end (canceled_at is null OR > month-end timestamp)
 *   - NOT trialing at that point
 *
 * Then calculate MRR from those subscriptions using current pricing.
 *
 * Limitations:
 *   - Uses current price, not historical price (upgrades/downgrades not reflected)
 *   - Coupon changes mid-period not captured
 *   - Approximate, not invoice-based
 */
export function reconstructMrrHistory(
  activeSubs: Stripe.Subscription[],
  canceledSubs: Stripe.Subscription[],
  months = 6,
): MrrHistoryPoint[] {
  const allSubs = [...activeSubs, ...canceledSubs]
  const now = new Date()
  const points: MrrHistoryPoint[] = []

  for (let i = months; i >= 0; i--) {
    // End of month boundary (or current date for i=0)
    const date = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    if (i === 0) {
      date.setTime(now.getTime()) // current moment for "this month"
    }
    const ts = Math.floor(date.getTime() / 1000)

    // Filter subs that were active at this point
    const activeAtDate = allSubs.filter(sub => {
      // Must have been created before this date
      if (sub.created > ts) return false
      // Must not have been canceled before this date
      if (sub.canceled_at !== null && sub.canceled_at !== undefined && sub.canceled_at <= ts) return false
      // Skip trialing (rough check: if trial_end > ts, it was trialing)
      if (sub.trial_end && sub.trial_end > ts && sub.status !== 'active') return false
      return true
    })

    // Calculate MRR from those subs
    let totalCents = 0
    for (const sub of activeAtDate) {
      totalCents += calculateSubscriptionPlanMrr(sub)
    }

    const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    points.push({
      date: label,
      mrr: Math.round(totalCents) / 100,
      customers: activeAtDate.length,
    })
  }

  return points
}
