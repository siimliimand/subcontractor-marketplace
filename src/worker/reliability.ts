/**
 * Phase 4: reliability metrics from real funnel data (details/05). Pure
 * functions — aggregated rows in, metrics out. Each metric carries the
 * sample it was computed from and the minimum sample required; below the
 * minimum the metric reports "insufficient history" and consumers must
 * treat it as neutral (never a zero, never a penalty). Customer-caused
 * cancellations are excluded from the provider's completion record.
 *
 * Minimum samples (details/05):
 *   response rate        — 5 requests
 *   median response time — 5 responses
 *   completion rate      — 3 bookings
 *   review score         — 3 reviews
 */

export const MIN_SAMPLE_RESPONSE = 5;
export const MIN_SAMPLE_RESPONSE_TIME = 5;
export const MIN_SAMPLE_COMPLETION = 3;
export const MIN_SAMPLE_REVIEWS = 3;

export type MetricResult<T> = {
  /** The computed value — null when the sample is insufficient. */
  value: T | null;
  /** Sample actually behind the value. */
  sample: number;
  /** Minimum sample before display. */
  minSample: number;
  /** Convenience flag: value !== null. */
  sufficient: boolean;
  /** Sample-band label per details/05 ("percentage with confidence indicator"). */
  confidence: "low" | "solid";
  /** Where a metric was computed, the raw inputs behind it (explainability). */
  inputs: Record<string, unknown>;
};

export type ReliabilityInput = {
  /** Past outreach for the provider (any request). */
  outreachCount: number;
  /** Of those, how many got a response. */
  respondedCount: number;
  /** Response times in hours for responded entries. */
  responseHours: number[];
  /** Finished bookings with attribution (customer-caused cancellations are
   * excluded by the caller). */
  completed: number;
  failed: number;
  providerCancellations: number;
  /** Undisputed review ratings. */
  ratings: number[];
};

function metric<T>(
  value: T | null,
  sample: number,
  minSample: number,
  inputs: Record<string, unknown>,
): MetricResult<T> {
  const sufficient = value !== null;
  return {
    value,
    sample,
    minSample,
    sufficient,
    confidence: sample >= minSample * 2 ? "solid" : "low",
    inputs,
  };
}

export function responseRate(i: ReliabilityInput): MetricResult<number> {
  const sufficient = i.outreachCount >= MIN_SAMPLE_RESPONSE;
  const value = sufficient ? round2(i.respondedCount / i.outreachCount) : null;
  return metric(value, i.outreachCount, MIN_SAMPLE_RESPONSE, {
    responded: i.respondedCount,
  });
}

export function medianResponseHours(i: ReliabilityInput): MetricResult<number> {
  const sufficient = i.responseHours.length >= MIN_SAMPLE_RESPONSE_TIME;
  const sorted = [...i.responseHours].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted[Math.floor((sorted.length - 1) / 2)]!
    : null;
  const value = sufficient && median !== null ? round2(median) : null;
  return metric(value, i.responseHours.length, MIN_SAMPLE_RESPONSE_TIME, {});
}

export function completionRate(i: ReliabilityInput): MetricResult<number> {
  // Customer-caused cancellations never entered the inputs — they are not
  // the provider's record.
  const denominator = i.completed + i.failed + i.providerCancellations;
  const sufficient = denominator >= MIN_SAMPLE_COMPLETION;
  const value = sufficient ? round2(i.completed / denominator) : null;
  return metric(value, denominator, MIN_SAMPLE_COMPLETION, {
    completed: i.completed,
    failed: i.failed,
    providerCancellations: i.providerCancellations,
  });
}

export function reviewScore(i: ReliabilityInput): MetricResult<number> {
  const sufficient = i.ratings.length >= MIN_SAMPLE_REVIEWS;
  const value = sufficient
    ? round2(i.ratings.reduce((a, r) => a + r, 0) / i.ratings.length)
    : null;
  return metric(value, i.ratings.length, MIN_SAMPLE_REVIEWS, {});
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeReliability(i: ReliabilityInput) {
  return {
    responseRate: responseRate(i),
    medianResponseHours: medianResponseHours(i),
    completionRate: completionRate(i),
    reviewScore: reviewScore(i),
  };
}
