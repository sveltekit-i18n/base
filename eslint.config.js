import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build outputs; node_modules is ignored by default.
  { ignores: ['**/dist/', '**/lib/', '**/types/', '**/build/', '**/package/', '**/.svelte-kit/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The public contract (types.ts) deliberately types loader payloads and
      // translation values as `any` — v2 compatibility kept until the boundary
      // hardening pass (sveltekit-i18n/lib#220) retypes them as `unknown`.
      // Until then the unsafe-* family only restates that decision on every
      // line the payload flows through, so it is off; async correctness rules
      // (no-floating-promises, no-misused-promises, require-await) stay on.
      // Omission destructuring (`const { dropped, ...rest } = obj`) is this
      // codebase's idiom for excluding keys immutably — a rest sibling marks
      // the extracted names as intentionally unused (tsc's noUnusedLocals
      // already treats them that way).
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    plugins: { 'import-x': importX },
    rules: {
      // The published package has zero runtime dependencies, so any bare
      // import reachable from src/ that isn't the svelte peer is a bug.
      'import-x/no-extraneous-dependencies': ['error', {
        devDependencies: [
          '**/*.config.ts',
          '**/*.config.js',
          'tests/**',
        ],
      }],
    },
  },
  {
    // The airbnb-era formatting contract (AGENTS.md §10), now via @stylistic.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/eol-last': 'error',
      '@stylistic/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
    },
  },
  {
    // The public type surface is namespace-shaped (Config.T, Loader.Module…)
    // since v1; its fate is a pending v3 decision (sveltekit-i18n/lib#219,
    // #221), not a lint-migration side effect.
    files: ['src/types.ts'],
    rules: {
      '@typescript-eslint/no-namespace': 'off',
    },
  },
  {
    // Mock loaders are async by the Loader contract with nothing to await.
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Plain JS (this config, vitest workaround shims) sits outside
    // tsconfig's program (no allowJs) — lint it untyped, with node globals
    // so no-undef doesn't fire on console/process in one-off scripts.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
