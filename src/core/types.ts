import Stripe from "stripe";

// ── Cache ──────────────────────────────────────────────
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ── Fetched Data ───────────────────────────────────────
export interface StripeData {
  subscriptions: Stripe.Subscription[];
  customers: Stripe.Customer[];
}

// ── Metric Results ─────────────────────────────────────
export interface MrrResult {
  mrr: number;
  arr: number;
  currency: string;
  activeSubscriptions: number;
  breakdown: MrrByPlan[];
}

export interface MrrByPlan {
  productId: string;
  productName: string;
  priceId: string;
  nickname: string | null;
  interval: string;
  mrr: number;
  subscriptionCount: number;
}

export interface MrrMovements {
  period: { start: string; end: string };
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  reactivationMrr: number;
  netNewMrr: number;
  currency: string;
}

export interface ChurnResult {
  period: { start: string; end: string };
  customerChurnRate: number;
  customersAtStart: number;
  customersLost: number;
  currency: string;
}

export interface RevenueChurnResult {
  period: { start: string; end: string };
  revenueChurnRate: number;
  mrrAtStart: number;
  mrrLost: number;
  currency: string;
}

export interface CustomerMetrics {
  totalCustomers: number;
  activeSubscribers: number;
  trialingCustomers: number;
  pastDueCustomers: number;
}

export interface ArpuResult {
  arpu: number;
  mrr: number;
  activeSubscribers: number;
  currency: string;
}

export interface LtvResult {
  ltv: number;
  arpu: number;
  monthlyChurnRate: number;
  avgLifespanMonths: number;
  currency: string;
}

export interface TrialConversionResult {
  period: { start: string; end: string };
  conversionRate: number;
  trialsStarted: number;
  trialsConverted: number;
}

export interface NetRevenueRetentionResult {
  period: { start: string; end: string };
  nrr: number;
  startingMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  currency: string;
}

export interface QuickRatioResult {
  quickRatio: number;
  newMrr: number;
  expansionMrr: number;
  churnedMrr: number;
  contractionMrr: number;
  currency: string;
}

export interface SaasDashboard {
  mrr: number;
  arr: number;
  activeSubscribers: number;
  arpu: number;
  customerChurnRate: number | null;
  revenueChurnRate: number | null;
  ltv: number | null;
  nrr: number | null;
  quickRatio: number | null;
  trialConversionRate: number | null;
  mrrByPlan: MrrByPlan[];
  currency: string;
  dataAsOf: string;
}

// ── Tool Input Params ──────────────────────────────────
export interface PeriodParams {
  startDate?: string; // ISO date string YYYY-MM-DD
  endDate?: string;   // ISO date string YYYY-MM-DD
}

// ── CLI-specific Types ─────────────────────────────────
export interface FormattedCustomer {
  customerId: string;
  email: string | null;
  name: string | null;
  subscriptionId: string;
  status: string;
  plan: string;
  interval: string;
  mrr: number;
  created: string;
  canceledAt: string | null;
  currency: string;
}

export interface CustomerListResult {
  period?: { start: string; end: string };
  count: number;
  totalMrr?: number;
  customers: FormattedCustomer[];
}
