import { describe, expect, it } from "vitest";
import { computeFactors, totalScore, MATCH_WEIGHTS } from "../src/worker/matching/weights";

const baseInputs = {
  confirmedWorkers: 0,
  hasFreshDeclarations: false,
  crewSize: 3,
  tradeServices: [],
  pastOutreach: [],
  pastBookings: [],
  providerCancellations: 0,
  requestLocation: "Tallinn",
  serviceAreas: [],
  requestBudget: null,
};

describe("matching factor weights", () => {
  it("weights sum to 1", () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("all factors are missing with no data, score is 0 with zero contributions", () => {
    const f = computeFactors(baseInputs);
    for (const [key, result] of Object.entries(f)) {
      expect(result.missing, key).toBe(true);
      expect(result.weighted, key).toBe(0);
      expect(result.value, key).toBe(0);
    }
    expect(totalScore(f)).toBe(0);
  });

  it("review quality is always missing in phase 2 even with other data", () => {
    const f = computeFactors({
      ...baseInputs,
      hasFreshDeclarations: true,
      confirmedWorkers: 3,
      tradeServices: [{ skills: "panel, wiring", isPrimaryTrade: true, pricingApproach: "12 €/m2" }],
      serviceAreas: ["Tallinn"],
    });
    expect(f.reviewQuality.missing).toBe(true);
    expect(f.reviewQuality.weighted).toBe(0);
    expect(f.confirmedCapacity.missing).toBe(false);
  });

  it("confirmed capacity ratios against requested crew", () => {
    const f = computeFactors({ ...baseInputs, hasFreshDeclarations: true, confirmedWorkers: 6, crewSize: 3 });
    expect(f.confirmedCapacity.value).toBe(1); // 6/3 clamped
    expect(f.confirmedCapacity.weighted).toBeCloseTo(0.25);
    const half = computeFactors({ ...baseInputs, hasFreshDeclarations: true, confirmedWorkers: 1.5, crewSize: 3 });
    expect(half.confirmedCapacity.value).toBeCloseTo(0.5);
  });

  it("response history combines rate and speed, missing with no outreach", () => {
    const missing = computeFactors(baseInputs).responseHistory;
    expect(missing.missing).toBe(true);

    const fast = computeFactors({
      ...baseInputs,
      pastOutreach: [
        { responded: true, responseHours: 2 },
        { responded: true, responseHours: 4 },
      ],
    }).responseHistory;
    expect(fast.missing).toBe(false);
    expect(fast.value).toBeGreaterThan(0.9);

    const slowNone = computeFactors({
      ...baseInputs,
      pastOutreach: [
        { responded: false, responseHours: null },
        { responded: false, responseHours: null },
      ],
    }).responseHistory;
    // rate 0 with no response-time data: speed component neutral at 0.5 → 0.3*0.5
    expect(slowNone.value).toBeCloseTo(0.15);
  });

  it("reliability counts completions, failures and provider cancellations", () => {
    const f = computeFactors({
      ...baseInputs,
      pastBookings: [
        { outcome: "completion_confirmed" },
        { outcome: "completion_confirmed" },
        { outcome: "accepted_but_not_delivered" },
      ],
      providerCancellations: 0,
    }).reliability;
    expect(f.value).toBeCloseTo(1 / 3);
    expect(f.inputs).toMatchObject({ completed: 2, failed: 1 });
  });

  it("proximity scores exact above contains, zero for unrelated areas", () => {
    const exact = computeFactors({ ...baseInputs, serviceAreas: ["Tallinn"], requestLocation: "Tallinn" }).proximity;
    expect(exact.value).toBe(1);
    const contains = computeFactors({
      ...baseInputs,
      serviceAreas: ["Tallinn and Harju county"],
      requestLocation: "Tallinn",
    }).proximity;
    expect(contains.value).toBe(0.6);
    const far = computeFactors({ ...baseInputs, serviceAreas: ["Tartu"], requestLocation: "Tallinn" }).proximity;
    expect(far.value).toBe(0);
    expect(far.missing).toBe(false); // data exists, just no overlap
  });

  it("price fit needs parseable budget and price", () => {
    const missing = computeFactors({ ...baseInputs, requestBudget: "flexible" }).priceFit;
    expect(missing.missing).toBe(true);

    const fit = computeFactors({
      ...baseInputs,
      requestBudget: "budget 10000 EUR",
      tradeServices: [{ skills: null, isPrimaryTrade: false, pricingApproach: "80-120 €/h" }],
    }).priceFit;
    expect(fit.missing).toBe(false);
    expect(fit.value).toBe(0); // 10000 far above 120 → decays to 0

    const within = computeFactors({
      ...baseInputs,
      requestBudget: "around 100 per unit",
      tradeServices: [{ skills: null, isPrimaryTrade: false, pricingApproach: "80-120 €" }],
    }).priceFit;
    expect(within.value).toBe(1);
  });

  it("total score is the weighted sum and stays within [0,1]", () => {
    const f = computeFactors({
      ...baseInputs,
      hasFreshDeclarations: true,
      confirmedWorkers: 3,
      crewSize: 3,
      tradeServices: [{ skills: "a, b", isPrimaryTrade: true, pricingApproach: null }],
      serviceAreas: ["Tallinn"],
      pastOutreach: [{ responded: true, responseHours: 3 }],
      pastBookings: [{ outcome: "completion_confirmed" }],
    });
    const score = totalScore(f);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    // priceFit missing (no budget) and reviewQuality missing → two zeros
    expect(f.priceFit.missing).toBe(true);
  });
});
