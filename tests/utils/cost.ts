import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const COST = resolve(dirname(fileURLToPath(import.meta.url)), '../types/cost');

type Target = 'source' | 'dist';

/**
 * The instantiations each call of the probe costs, and the assignability
 * relations it records, by its text. Counts, not durations: one compiler
 * version counts the same on every machine and runtime.
 */
const measure = (target: Target) => {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(COST, target === 'dist' ? 'tsconfig.dist.json' : 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); },
  });

  if (!config) throw new Error('The probe has no config.');

  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options, configFileParsingDiagnostics: config.errors });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(resolve(COST, 'probe.ts'));

  if (!file) throw new Error('The probe is not in its program.');

  const counts: Record<string, number> = {};
  const relations: Record<string, number> = {};

  // In source order, before anything else checks the file: each call pays for
  // what no earlier call instantiated.
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;

    const before = program.getInstantiationCount();
    const related = program.getRelationCacheSizes().assignable;

    checker.getResolvedSignature(statement.expression);
    counts[statement.expression.getText(file)] = program.getInstantiationCount() - before;
    relations[statement.expression.getText(file)] = program.getRelationCacheSizes().assignable - related;
  }

  const diagnostics = ts.getPreEmitDiagnostics(program).map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, '\n'));

  return { counts, relations, diagnostics };
};

/**
 * What a call of `t` or `l` costs the checker, against `target`: the source
 * (`npm test`) or the shipped declarations (`npm run test:dist`). The probe
 * calls the same keys on a schema of 10 keys and one of 1,010, and a call has
 * to cost about the same on both. A key outside a schema of 100 keys and one of
 * 1,000, which types the payload over every key, records assignability
 * relations linear in it.
 */
export const describeCost = (target: Target) => describe(`the cost of a call, against the ${target}`, () => {
  let probe: ReturnType<typeof measure> | undefined;
  const measured = () => (probe ??= measure(target));

  it('compiles the probe, where a wrapper spelled with `Schema.Key` and `Schema.Params` is the type of `t`', () => {
    expect(measured().diagnostics).toEqual([]);
  }, 60_000);

  it('does not grow with the size of the schema', () => {
    const { counts } = measured();

    expect(counts["controlLarge('ns.4', { name: 'x' })"]).toBeGreaterThan(10 * counts["controlSmall('ns.4', { name: 'x' })"]);

    for (const [small, large] of [
      ["small.t('ns.1', { name: 'x' })", "large.t('ns.1', { name: 'x' })"],
      ["small.t('ns.0')", "large.t('ns.0')"],
      ["small.t('ns.5')", "large.t('ns.5')"],
      ["small.t(pair, { name: 'x' })", "large.t(pair, { name: 'x' })"],
      ["small.l('en', 'ns.2', { name: 'x' })", "large.l('en', 'ns.2', { name: 'x' })"],
      ["wrapperSmall('ns.3', { name: 'x' })", "wrapperLarge('ns.3', { name: 'x' })"],
    ]) {
      expect(counts[large], large).toBeLessThan(2 * counts[small]);
    }
  }, 60_000);

  it('records relations linear in the schema where a key outside it types the payload over every key', () => {
    const { relations } = measured();

    // Ten times the keys: a linear cost takes about ten times the relations,
    // and a quadratic one, which relates the intersection of the payloads to
    // each of them, about a hundred times.
    expect(relations["thousand.t('missing')"]).toBeLessThan(20 * relations["hundred.t('missing')"]);
  }, 60_000);
});
