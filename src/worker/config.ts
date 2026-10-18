export const PILOT_TRADES = [
  "electrical",
  "plumbing",
  "hvac",
  "drywall",
  "flooring",
  "painting",
] as const;

export type Trade = (typeof PILOT_TRADES)[number];

export const PRICING_MODELS = ["hour", "m2", "project"] as const;

export type PricingModel = (typeof PRICING_MODELS)[number];

export const PROVIDER_STATUSES = ["active", "inactive", "opted_out"] as const;

export const TRADE_PILOT_MINIMUMS: Record<Trade, number> = {
  electrical: 6,
  plumbing: 5,
  hvac: 4,
  drywall: 5,
  flooring: 4,
  painting: 6,
};

export const REQUEST_STATUSES = [
  "draft",
  "approved",
  "matched",
  "in_outreach",
  "responded",
  "booked",
  "closed",
  "cancelled",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const RESPONSE_TYPES = ["interest", "quote", "decline"] as const;

export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const BOOKING_OUTCOMES = ["completion_confirmed", "accepted_but_not_delivered"] as const;

export const CANCELLATION_ATTRIBUTIONS = ["customer", "provider"] as const;

export function isTrade(value: string): value is Trade {
  return (PILOT_TRADES as readonly string[]).includes(value);
}

export function isPricingModel(value: string): value is PricingModel {
  return (PRICING_MODELS as readonly string[]).includes(value);
}

export function isProviderStatus(value: string): value is (typeof PROVIDER_STATUSES)[number] {
  return (PROVIDER_STATUSES as readonly string[]).includes(value);
}

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}
