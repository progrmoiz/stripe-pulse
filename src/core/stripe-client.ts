import Stripe from "stripe";

export function createStripeClient(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    apiVersion: "2025-02-24.acacia",
    appInfo: { name: "stripe-pulse" },
  });
}
