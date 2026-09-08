// Stripe can't charge in NPR (it's not a Stripe-supported settlement
// currency), so an NPR-priced event routed through Stripe is billed in USD
// instead — the attendee sees/pays a converted amount, the event's own
// price record is untouched. NPR_USD_RATE is a static, env-overridable
// approximation (NPR per 1 USD) rather than a live FX lookup, since exact
// live rates aren't needed for a rough conversion and avoids taking a
// dependency on a third-party rates API.
export const NPR_USD_RATE: number = Number(process.env.NPR_USD_RATE) || 133;

// Stripe rejects charges below roughly $0.50 on most currencies, so very
// small NPR amounts are floored here rather than failing at checkout.
export const STRIPE_MIN_USD: number = 0.5;

// Converts an NPR amount to a USD amount suitable for Stripe's unit_amount
// (which is applied in cents by the caller), rounded to 2 decimal places.
export const nprToUsd = (amountNpr: number): number => {
  const usd = amountNpr / NPR_USD_RATE;
  return Math.max(STRIPE_MIN_USD, Math.round(usd * 100) / 100);
};

export default { nprToUsd, NPR_USD_RATE, STRIPE_MIN_USD };
