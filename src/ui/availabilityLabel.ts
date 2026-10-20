/**
 * Display rules for provider capacity (details/03 + booking-core spec):
 * an empty/unknown state is never presented as confirmed. Email-only
 * providers, missing declarations and expired declarations are all
 * "Unconfirmed"; stale capacity requires reconfirmation before it can be
 * trusted; aging capacity shows a reconfirmation recommendation.
 */
export type AvailabilityLabelTone = "confirmed" | "reconfirm" | "unconfirmed";

export type AvailabilityLabel = { label: string; tone: AvailabilityLabelTone };

export type DeclarationLike = {
  channel: string;
  freshness?: string | null;
};

export function availabilityLabel(decl: DeclarationLike | null | undefined): AvailabilityLabel {
  if (!decl) return { label: "Unconfirmed", tone: "unconfirmed" };
  if (decl.channel === "email_only") return { label: "Unconfirmed", tone: "unconfirmed" };
  switch (decl.freshness) {
    case "current":
      return { label: "Confirmed available", tone: "confirmed" };
    case "aging":
      return { label: "Likely current — reconfirmation recommended", tone: "reconfirm" };
    case "stale":
      return { label: "Uncertain — reconfirmation required", tone: "reconfirm" };
    default:
      // expired or unknown freshness
      return { label: "Unconfirmed", tone: "unconfirmed" };
  }
}
