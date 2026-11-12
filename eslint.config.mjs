import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build output, dependencies, tool state, prose docs, generated SQL migrations,
  // and generated/ambient declaration files are out of lint scope.
  {
    ignores: [
      'dist/',
      'node_modules/',
      '.wrangler/',
      '.fusion/',
      'docs/',
      'migrations/',
      '**/*.d.ts',
      '**/*.d.mts',
    ],
  },
  // TypeScript: worker + UI sources, test suite, root config files.
  {
    files: [
      'src/**/*.{ts,tsx}',
      'test/**/*.{ts,tsx}',
      'vite.config.ts',
      'vitest.config.ts',
      'vitest.ui.config.ts',
      'drizzle.config.ts',
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // SUBC-017 (docs/decision-log.md): `no-explicit-any` is now an error,
      // completing the SUBC-013 pilot-period deferral ahead of the pilot-end
      // re-evaluation trigger. The bindings plumbing that justified the
      // deferral is typed: src Hono helpers take real Context generics
      // (Context<AppEnv> / Context<{ Bindings: PortalEnv }>) and the test
      // suite reads a declared, typed `globalThis.__testAccessKey` global.
      // Per-file eslint-disable comments remain forbidden — rule changes
      // happen only here with a justification comment and decision-log record.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused bindings may be silenced with an underscore prefix.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Full react-hooks v7 rule suite, including the React Compiler rules
      // (purity, immutability, set-state-in-render, set-state-in-effect, ...).
      // This entry supersedes the SUBC-013 deferral (which kept the classic
      // pair only because the preset "requires behavioral rewrites across the
      // UI"): SUBC-016 found those rewrites are exactly five same-shaped
      // load-in-effect sites, restructured onto the module-level fetch helper
      // + effect-owned apply + stale-response guard pattern. exhaustive-deps
      // is promoted from SUBC-013's "warn" to "error", and the lint script
      // runs with --max-warnings 0, so the preset's two deliberate warn-level
      // rules (incompatible-library, unsupported-syntax) become real signal:
      // any future finding is a rule-level decision, not background noise.
      // Per-file eslint-disable comments remain forbidden — rule changes
      // happen only here with a justification comment and decision-log record.
      ...reactHooks.configs['recommended-latest'].rules,
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // Plain-Node scripts (and this config file itself).
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
