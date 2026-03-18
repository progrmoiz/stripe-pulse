import Stripe from "stripe";
import { Cache } from "./cache.js";

const SUB_EXPAND = ["data.items.data.price", "data.discount", "data.customer"];
const PAGE_LIMIT = 10_000;

export class StripeFetcher {
  private stripe: Stripe;
  private cache: Cache;

  constructor(stripe: Stripe, cache: Cache) {
    this.stripe = stripe;
    this.cache = cache;
  }

  async getActiveSubscriptions(): Promise<Stripe.Subscription[]> {
    const cached = this.cache.get<Stripe.Subscription[]>("active_subs");
    if (cached) return cached;

    const [active, pastDue] = await Promise.all([
      this.stripe.subscriptions
        .list({ status: "active", expand: SUB_EXPAND })
        .autoPagingToArray({ limit: PAGE_LIMIT }),
      this.stripe.subscriptions
        .list({ status: "past_due", expand: SUB_EXPAND })
        .autoPagingToArray({ limit: PAGE_LIMIT }),
    ]);

    const result = [...active, ...pastDue];
    this.cache.set("active_subs", result);
    return result;
  }

  async getAllSubscriptions(): Promise<Stripe.Subscription[]> {
    const cached = this.cache.get<Stripe.Subscription[]>("all_subs");
    if (cached) return cached;

    const result = await this.stripe.subscriptions
      .list({ expand: SUB_EXPAND })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    this.cache.set("all_subs", result);
    return result;
  }

  async getCustomers(): Promise<Stripe.Customer[]> {
    const cached = this.cache.get<Stripe.Customer[]>("customers");
    if (cached) return cached;

    const result = await this.stripe.customers
      .list()
      .autoPagingToArray({ limit: PAGE_LIMIT });

    this.cache.set("customers", result);
    return result;
  }

  async getSubscriptionsByStatus(
    status: Stripe.Subscription.Status
  ): Promise<Stripe.Subscription[]> {
    const cacheKey = `subs_${status}`;
    const cached = this.cache.get<Stripe.Subscription[]>(cacheKey);
    if (cached) return cached;

    const result = await this.stripe.subscriptions
      .list({ status, expand: SUB_EXPAND })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    this.cache.set(cacheKey, result);
    return result;
  }

  async getCanceledSubscriptionsInPeriod(
    startDate: Date,
    endDate: Date
  ): Promise<Stripe.Subscription[]> {
    const cacheKey = `canceled_${startDate.toISOString()}_${endDate.toISOString()}`;
    const cached = this.cache.get<Stripe.Subscription[]>(cacheKey);
    if (cached) return cached;

    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    const allCanceled = await this.stripe.subscriptions
      .list({
        status: "canceled",
        expand: SUB_EXPAND,
      })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    const result = allCanceled.filter(
      (sub) =>
        sub.canceled_at !== null &&
        sub.canceled_at >= startTs &&
        sub.canceled_at <= endTs
    );

    this.cache.set(cacheKey, result);
    return result;
  }

  async getProductMap(): Promise<Map<string, string>> {
    const cached = this.cache.get<Map<string, string>>("product_map");
    if (cached) return cached;

    const products = await this.stripe.products
      .list({ active: undefined })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    const map = new Map<string, string>();
    for (const p of products) {
      map.set(p.id, p.name);
    }
    this.cache.set("product_map", map);
    return map;
  }

  async getAllCanceledSubscriptions(): Promise<Stripe.Subscription[]> {
    const cached = this.cache.get<Stripe.Subscription[]>("all_canceled");
    if (cached) return cached;

    const result = await this.stripe.subscriptions
      .list({ status: "canceled", expand: SUB_EXPAND })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    this.cache.set("all_canceled", result);
    return result;
  }

  async getNewSubscriptionsInPeriod(
    startDate: Date,
    endDate: Date
  ): Promise<Stripe.Subscription[]> {
    const cacheKey = `new_${startDate.toISOString()}_${endDate.toISOString()}`;
    const cached = this.cache.get<Stripe.Subscription[]>(cacheKey);
    if (cached) return cached;

    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    const result = await this.stripe.subscriptions
      .list({
        created: { gte: startTs, lte: endTs },
        expand: SUB_EXPAND,
      })
      .autoPagingToArray({ limit: PAGE_LIMIT });

    this.cache.set(cacheKey, result);
    return result;
  }
}
