import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Pin NODE_ENV to vitest's own default ("test") before the config resolves.
// An ambient NODE_ENV=production (the fusion host's agent shell exports it)
// would make Vite resolve the production React build, where act() is
// unsupported and every RTL test fails; CI leaves NODE_ENV unset and vitest
// defaults it to "test" — pinning here makes the lane behave identically
// everywhere (host shell, CI).
process.env.NODE_ENV = "test";

// Dedicated jsdom lane for UI (React page) tests — SUBC-016.
//
// Isolation guarantee: every file in this lane ends in `.uitest.tsx`. The
// filename segment "uitest" contains no `.test`/`.spec` boundary, and every
// vitest test-name glob (the default `**/*.{test,spec}.?(c|m)[jt]s?(x)` used
// by vitest.config.ts, or any narrower variant) requires that literal
// boundary immediately before the extension — so the worker-side suite
// (vitest-pool-workers, no DOM) cannot collect these files, and this lane
// cannot collect the worker tests. Preserve the suffix property in any
// future rename.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/ui/**/*.uitest.tsx"],
  },
});
