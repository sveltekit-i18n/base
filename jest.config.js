import { createDefaultEsmPreset } from 'ts-jest';

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default ({
  // Compiled with `tests/tsconfig.json` (see the comment there). The preset
  // helper owns the transform pattern, so an upgrade cannot leave a second,
  // stale entry behind that the `tsconfig` override would not reach.
  ...createDefaultEsmPreset({ tsconfig: '<rootDir>/tests/tsconfig.json' }),
  testEnvironment: 'node',
  // `dist.spec.ts` asserts on a built bundle and only runs through
  // `npm run test:dist`, which builds it first; a bare `jest` would otherwise
  // resolve nothing on a fresh clone or assert against a stale artifact.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/specs/dist\\.spec\\.ts$'],
});
