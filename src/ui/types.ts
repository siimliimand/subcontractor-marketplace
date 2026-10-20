export type Company = {
  id: string;
  legalName: string;
  registrationIdentifier: string;
  contactEmail: string;
  contactPhone: string | null;
  status: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  services?: Service[];
};

export type Service = {
  id: string;
  companyId: string;
  trade: string;
  skills: string | null;
  serviceArea: string;
  pricingApproach: string | null;
  pricingModel: string;
  status: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
};

/**
 * Phase 4: the UI trade list is catalog-driven — the cockpit fetches
 * `/api/catalog` and falls back to the pilot six when unavailable.
 */
export const FALLBACK_TRADES = ["electrical", "plumbing", "hvac", "drywall", "flooring", "painting"];
export const TRADES = FALLBACK_TRADES;
export const PRICING_MODELS = ["hour", "m2", "project"];
export const PROVIDER_STATUSES = ["active", "inactive", "opted_out"];
export const REQUEST_STATUSES = [
  "draft",
  "approved",
  "matched",
  "in_outreach",
  "responded",
  "booked",
  "closed",
  "cancelled",
];
export const RESPONSE_TYPES = ["interest", "quote", "decline"];

export function statusBadge(status: string) {
  switch (status) {
    case "active":
    case "approved":
    case "booked":
    case "closed":
      return "bg-green-100 text-green-800";
    case "opted_out":
    case "cancelled":
      return "bg-red-100 text-red-800";
    case "inactive":
    case "draft":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-blue-100 text-blue-800";
  }
}
