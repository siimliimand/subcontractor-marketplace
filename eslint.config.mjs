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
      'test/**/*.ts',
      'vite.config.ts',
      'vitest.config.ts',
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
      // Classic react-hooks pair only. eslint-plugin-react-hooks v7's
      // "recommended" preset additionally enables the React Compiler rule suite
      // (purity, immutability, set-state-in-render, ...), which requires
      // behavioral rewrites across the UI — out of scope for this non-behavioral
      // lint baseline. exhaustive-deps starts at "warn" per the SUBC-013
      // decision; rules-of-hooks stays an error.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
