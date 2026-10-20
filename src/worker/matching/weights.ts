/**
 * Matching v1 ranking (details/04): transparent, deterministic, weighted.
 * Every factor is computed only from data that exists; a factor without
 * supporting data contributes zero and is reported as missing. Weights are
 * hypotheses to be tuned in Phase 3 from real outcomes.
 *
 * Phase 4: reliability and review quality honour the details/05 minimum
 * samples — below them the factor is missing (neutral), because history
 * absence is never scored as a negative signal.
 */
import { MIN_SAMPLE_COMPLETION, MIN_SAMPLE_REVIEWS } from "../reliability";

export const MATCH_WEIGHTS = {
  confirmedCapacity: 0.25,
  specialisationDepth: 0.2,
  responseHistory: 0.15,
  reliability: 0.15,
  proximity: 0.1,
  reviewQuality: 0.1,
  priceFit: 0.05,
} as const;

export type MatchFactorKey = keyof typeof MATCH_WEIGHTS;

/** Phase 3: runtime-tunable weights (effective = latest match_weights row per factor). */
export type EffectiveWeights = Record<MatchFactorKey, number>;

export function isMatchFactorKey(value: string): value is MatchFactorKey {
  return Object.prototype.hasOwnProperty.call(MATCH_WEIGHTS, value);
}

export const DEFAULT_WEIGHTS: EffectiveWeights = { ...MATCH_WEIGHTS };

export type FactorResult = {
  /** Normalised factor value in [0, 1]. */
  value: number;
  /** value * weight. */
  weighted: number;
  /** True when no supporting data exists — factor contributes zero. */
  missing: boolean;
  /** Human-readable raw inputs behind the value (explainability). */
  inputs: Record<string, unknown>;
};

export type FactorInputs = {
  /** Sum of fresh declaration workers for the trade intersecting the request range. */
  confirmedWorkers: number;
  /** Whether any fresh booking_system declaration exists. */
  hasFreshDeclarations: boolean;
  /** Requested crew size (normaliser for capacity). */
  crewSize: number;
  /** Provider's services for the trade. */
  tradeServices: { skills: string | null; isPrimaryTrade: boolean; pricingApproach: string | null }[];
  /** Past outreach entries for this provider (any request). */
  pastOutreach: { responded: boolean; responseHours: number | null }[];
  /** Past bookings for this provider. */
  pastBookings: { outcome: string | null }[];
  /** Provider-attributed cancellations count. */
  providerCancellations: number;
  /** Request location (free text). */
  requestLocation: string;
  /** Provider service areas for the trade. */
  serviceAreas: string[];
  /** Request budget (free text, may be unparseable). */
  requestBudget: string | null;
  /** Phase 4: undisputed review ratings for the provider (optional for
   * backwards compatibility with pure-function call sites). */
  reviews?: { rating: number }[];
};

export type FactorBreakdown = Record<MatchFactorKey, FactorResult>;

function factor(
  key: MatchFactorKey,
  value: number | null,
  inputs: Record<string, unknown>,
  weight: number = MATCH_WEIGHTS[key],
): FactorResult {
  if (value === null || Number.isNaN(value)) {
    return { value: 0, weighted: 0, missing: true, inputs };
  }
  const clamped = Math.max(0, Math.min(1, value));
  return { value: clamped, weighted: clamped * weight, missing: false, inputs };
}

/** Capacity relative to the requested crew; data missing when no fresh declarations exist. */
function confirmedCapacity(i: FactorInputs, w: EffectiveWeights): FactorResult {
  if (!i.hasFreshDeclarations) {
    return factor("confirmedCapacity", null, { confirmedWorkers: 0, crewSize: i.crewSize, note: "no fresh availability declaration" }, w.confirmedCapacity);
  }
  const ratio = i.crewSize > 0 ? i.confirmedWorkers / i.crewSize : i.confirmedWorkers > 0 ? 1 : 0;
  return factor("confirmedCapacity", ratio, {
    confirmedWorkers: i.confirmedWorkers,
    crewSize: i.crewSize,
  }, w.confirmedCapacity);
}

/** Specialisation depth: skills listed and the trade marked primary. */
function specialisationDepth(i: FactorInputs, w: EffectiveWeights): FactorResult {
  if (i.tradeServices.length === 0) {
    return factor("specialisationDepth", null, { services: 0 }, w.specialisationDepth);
  }
  const withSkills = i.tradeServices.filter((s) => s.skills && s.skills.trim()).length;
  const primary = i.tradeServices.some((s) => s.isPrimaryTrade);
  const skillList = i.tradeServices
    .map((s) => (s.skills ?? "").split(",").map((x) => x.trim()).filter(Boolean))
    .flat();
  const value = Math.min(1, (withSkills > 0 ? 0.5 : 0) + (primary ? 0.3 : 0) + Math.min(0.2, skillList.length * 0.05));
  return factor("specialisationDepth", value, { withSkills, primaryTrade: primary, skills: skillList }, w.specialisationDepth);
}

/** Response history: response rate (70%) + speed (30%), needs past outreach. */
function responseHistory(i: FactorInputs, w: EffectiveWeights): FactorResult {
  if (i.pastOutreach.length === 0) {
    return factor("responseHistory", null, { outreachCount: 0, note: "no past outreach" }, w.responseHistory);
  }
  const responded = i.pastOutreach.filter((o) => o.responded).length;
  const rate = responded / i.pastOutreach.length;
  const hours = i.pastOutreach
    .map((o) => o.responseHours)
    .filter((h): h is number => h !== null);
  // 24h response → 1.0; 72h+ → 0. No responses yet → speed component neutral (rate only).
  const speed = hours.length
    ? hours.reduce((a, h) => a + Math.max(0, 1 - h / 72), 0) / hours.length
    : 0.5;
  const value = 0.7 * rate + 0.3 * speed;
  return factor("responseHistory", value, {
    outreachCount: i.pastOutreach.length,
    responseRate: rate,
    medianResponseHours: hours.length ? hours.sort((a, b) => a - b)[Math.floor(hours.length / 2)] : null,
  }, w.responseHistory);
}

/**
 * Reliability: completions minus failures and provider-attributed
 * cancellations — displayed (and scored) only above the details/05 minimum
 * sample of 3 finished bookings; below it the factor is neutral.
 */
function reliability(i: FactorInputs, w: EffectiveWeights): FactorResult {
  const denominator = i.pastBookings.length + i.providerCancellations;
  if (denominator < MIN_SAMPLE_COMPLETION) {
    return factor("reliability", null, {
      bookings: i.pastBookings.length,
      providerCancellations: i.providerCancellations,
      note: "insufficient history: minimum sample not met (neutral)",
    }, w.reliability);
  }
  const completed = i.pastBookings.filter((b) => b.outcome === "completion_confirmed").length;
  const failed = i.pastBookings.filter((b) => b.outcome === "accepted_but_not_delivered").length;
  const value = Math.max(0, Math.min(1, (completed - failed - i.providerCancellations) / denominator));
  return factor("reliability", value, {
    bookings: i.pastBookings.length,
    completed,
    failed,
    providerCancellations: i.providerCancellations,
    minSample: MIN_SAMPLE_COMPLETION,
  }, w.reliability);
}

/** Proximity: normalised substring match of request location in a service area (heuristic). */
function proximity(i: FactorInputs, w: EffectiveWeights): FactorResult {
  if (i.serviceAreas.length === 0) {
    return factor("proximity", null, { serviceAreas: [] }, w.proximity);
  }
  const loc = i.requestLocation.trim().toLowerCase();
  const areas = i.serviceAreas.map((a) => a.trim().toLowerCase());
  const exact = areas.some((a) => a === loc);
  const contains = areas.some((a) => (loc && a.includes(loc)) || (loc && loc.includes(a)));
  const value = exact ? 1 : contains ? 0.6 : 0;
  return factor("proximity", value, {
    serviceAreas: i.serviceAreas,
    requestLocation: i.requestLocation,
    heuristic: true,
  }, w.proximity);
}

/**
 * Reviews tied to completed bookings (phase 4) — average rating normalised
 * from the 1–5 scale; scored only above the details/05 minimum of 3
 * undisputed reviews.
 */
function reviewQuality(i: FactorInputs, w: EffectiveWeights): FactorResult {
  const ratings = (i.reviews ?? []).map((r) => r.rating);
  if (ratings.length < MIN_SAMPLE_REVIEWS) {
    return factor("reviewQuality", null, {
      reviews: ratings.length,
      note: ratings.length === 0 ? "no review data" : "insufficient history: minimum sample not met (neutral)",
    }, w.reviewQuality);
  }
  const avg = ratings.reduce((a, r) => a + r, 0) / ratings.length;
  const value = (avg - 1) / 4; // 1→0, 5→1
  return factor("reviewQuality", value, {
    reviews: ratings.length,
    averageRating: Math.round(avg * 100) / 100,
    minSample: MIN_SAMPLE_REVIEWS,
  }, w.reviewQuality);
}

/** Price fit: parse numbers from budget and pricing approach ranges; both needed. */
function priceFit(i: FactorInputs, w: EffectiveWeights): FactorResult {
  const budgetNum = i.requestBudget?.match(/\d+(?:[.,]\d+)?/)?.[0];
  const priceNums = i.tradeServices
    .flatMap((s) => [...(s.pricingApproach?.matchAll(/\d+(?:[.,]\d+)?/g) ?? [])].map((m) => m[0]))
    .filter((n): n is string => !!n);
  if (!budgetNum || priceNums.length === 0) {
    return factor("priceFit", null, {
      budget: i.requestBudget,
      note: "budget or price data missing/unparseable",
    }, w.priceFit);
  }
  const budget = parseFloat(budgetNum.replace(",", "."));
  const prices = priceNums.map((p) => parseFloat(p.replace(",", ".")));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Within provider range → 1; above the max decays by 25% steps; below min still fits.
  const value =
    budget >= min && budget <= max
      ? 1
      : budget > max
        ? Math.max(0, 1 - (budget - max) / max)
        : 1;
  return factor("priceFit", value, { budget, priceRange: [min, max] });
}

export function computeFactors(i: FactorInputs, w: EffectiveWeights = DEFAULT_WEIGHTS): FactorBreakdown {
  return {
    confirmedCapacity: confirmedCapacity(i, w),
    specialisationDepth: specialisationDepth(i, w),
    responseHistory: responseHistory(i, w),
    reliability: reliability(i, w),
    proximity: proximity(i, w),
    reviewQuality: reviewQuality(i, w),
    priceFit: priceFit(i, w),
  };
}

export function totalScore(breakdown: FactorBreakdown): number {
  return Object.values(breakdown).reduce((sum, f) => sum + f.weighted, 0);
}
