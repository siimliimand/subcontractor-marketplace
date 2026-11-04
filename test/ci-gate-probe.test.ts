import { describe, expect, it } from "vitest";

// SUBC-013 CI-gate probe: a deliberately failing test that exists ONLY on the
// ci-gate-probe/* verification branch (never on main). Its failing runs
// exercise the notify job (ci-failure issue creation/commenting) and the
// ci-merge-gate-pilot ruleset (blocked PR merge) — see docs/decision-log.md.
describe("ci-gate-probe", () => {
  it("fails", () => {
    expect(false).toBe(true);
  });
});
