import type { companyVerifications } from "./db/schema";

/**
 * Phase 3: register-backed trust badges. All data comes from the offline
 * imports (see scripts/import-*.mjs) — no runtime register API calls. The
 * MTR/Tarvik trade-notification badge is display-gated behind
 * MTR_BADGES_ENABLED until the TTJA licence confirmation (CC BY-SA 3.0
 * share-alike) is recorded; see docs/phase0/register-findings.md.
 */

export type VerificationRow = typeof companyVerifications.$inferSelect;

export const VERIFICATION_TYPES = ["registry_active", "trade_notification"] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];
export const VERIFICATION_STATUSES = ["valid", "invalid", "unknown"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type BadgeInfo = {
  displayable: boolean;
  status: VerificationStatus;
  checkedAt: string;
  sourceDataset: string;
  sourceLicence: string;
};

export type ComputedBadges = {
  registryActive: BadgeInfo | null;
  /** Per-trade trade-notification badges (MTR/Tarvik). */
  trades: Record<string, BadgeInfo>;
};

export function isVerificationStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

function badgeFrom(row: VerificationRow, mtrEnabled: boolean): BadgeInfo {
  return {
    displayable: row.type === "registry_active" ? true : mtrEnabled,
    status: isVerificationStatus(row.status) ? row.status : "unknown",
    checkedAt: row.checkedAt,
    sourceDataset: row.sourceDataset,
    sourceLicence: row.sourceLicence,
  };
}

/**
 * Latest verification per type/trade wins (imports upsert, so normally one
 * row per key; the latest checkedAt is authoritative regardless).
 */
export function computeBadges(
  rows: VerificationRow[],
  opts: { mtrEnabled: boolean },
): ComputedBadges {
  const latest = new Map<string, VerificationRow>();
  for (const row of rows) {
    const key = `${row.type}:${row.trade ?? ""}`;
    const prev = latest.get(key);
    if (!prev || row.checkedAt > prev.checkedAt) latest.set(key, row);
  }

  const registryRow = latest.get("registry_active:");
  const badges: ComputedBadges = {
    registryActive: registryRow ? badgeFrom(registryRow, opts.mtrEnabled) : null,
    trades: {},
  };
  for (const [_key, row] of latest) {
    if (row.type !== "trade_notification" || !row.trade) continue;
    badges.trades[row.trade] = badgeFrom(row, opts.mtrEnabled);
  }
  return badges;
}

/** True when the badge should actually render (valid + display gate passed). */
export function badgeShows(badge: BadgeInfo | undefined | null): boolean {
  return !!badge && badge.displayable && badge.status === "valid";
}

// --- Phase 4: platform-history "Established" badge (details/05) ---

/** Minimum 3 completed bookings with positive outcomes. */
export const ESTABLISHED_MIN_BOOKINGS = 3;

export type EstablishedBadge = {
  displayable: boolean;
  /** Completed, positively-attributed bookings behind the badge. */
  basis: number;
  minBookings: number;
};

/**
 * The Established badge comes from platform history, not registers — a
 * provider earns it by completing bookings. Customer-caused cancellations
 * never enter the count (the caller filters them out).
 */
export function computeEstablished(positiveCompletions: number): EstablishedBadge {
  return {
    displayable: positiveCompletions >= ESTABLISHED_MIN_BOOKINGS,
    basis: positiveCompletions,
    minBookings: ESTABLISHED_MIN_BOOKINGS,
  };
}
