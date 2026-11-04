/**
 * SUBC-018 probe artifact — deliberately failing test, PROBE ONLY.
 *
 * Lives only on the ci-gate-probe/20261104-headref branch (never merged,
 * deleted after the probe): it makes the `test` job fail so the `notify`
 * job fires, letting us verify live that a pull_request failure alert now
 * names the PR head branch instead of the merge ref. Lint, typecheck and
 * build stay green — only the test step fails.
 */
import { expect, it } from "vitest";

it("deliberately fails so notify fires (SUBC-018 head-ref probe)", () => {
  expect(1).toBe(2);
});
