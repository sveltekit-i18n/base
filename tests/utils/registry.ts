import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compile as compileProject } from './tsc.js';

type Target = 'source' | 'dist';

/**
 * Compiles one fixture program. Each is a program of its own, since a
 * registration types every instance in the program it is part of.
 */
const compile = (program: string, target: Target, ...options: string[]): Promise<string> =>
  compileProject(join('registry', program, target === 'dist' ? 'tsconfig.dist.json' : 'tsconfig.json'), ...options);

/**
 * The `SvelteKitI18n.Register` registry, compiled by `tsc` at
 * `skipLibCheck: false` against `target`: the source (`npm test`) or the
 * shipped declarations (`npm run test:dist`). A fixture that stops narrowing
 * fails on its unused `@ts-expect-error`; a `declare global` lost to the
 * build fails the library program, which registers nothing, so the core's own
 * declaration is the only one it has.
 */
export const describeRegistry = (target: Target) => describe(`the type registry, against the ${target}`, () => {
  it('types a schema-less instance by the registered schema, and yields to a stated one', async () => {
    expect(await compile('registered', target)).toBe('');
  }, 60_000);

  it('keeps plain string keys for a registration without keys', async () => {
    expect(await compile('placeholder', target)).toBe('');
  }, 60_000);

  it('emits no schema into the declarations of a library built without one', async () => {
    const out = await mkdtemp(join(tmpdir(), 'registry-'));

    try {
      // Emitted only into `out`: the fixture's tsconfig emits nothing, so
      // compiling it by hand leaves no declarations next to the sources.
      expect(await compile('library', target, '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', out)).toBe('');

      // The source target emits the core alongside, so the fixture lands
      // under its path from the repository root.
      const emitted = await readFile(target === 'dist' ? join(out, 'index.d.ts') : join(out, 'tests/types/registry/library/index.d.ts'), 'utf8');

      expect(emitted).toContain('t: import("@sveltekit-i18n/base").Translations.TranslationFunction<unknown[], string, never>;');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 60_000);
});
