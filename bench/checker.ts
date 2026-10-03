import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { expect, it } from 'vitest';

import { SRC } from '../vitest.config.js';

import { collect } from './collect.js';

const record = collect(import.meta.filename);

const PROBE = resolve(dirname(fileURLToPath(import.meta.url)), 'types/probe.ts');

// The tree measured, as `vitest.bench.config.ts` aliases it.
const source = resolve(process.env.BENCH_SOURCE ?? SRC);

const SUBJECTS: Record<string, string> = {
  flat1k: '1,000 flat keys',
  flat10k: '10,000 flat keys',
  namespaced10k: '10,000 keys in namespaces',
};

/** What a call is, by its method and whether it passes a payload. */
const describeCall = (call: ts.CallExpression, file: ts.SourceFile) => {
  const method = (call.expression as ts.PropertyAccessExpression).name.getText(file);
  const payload = call.arguments.length > (method === 'l' ? 2 : 1);

  return `${method} ${payload ? 'with' : 'without'} a payload`;
};

it('the instantiations of a call', () => {
  const program = ts.createProgram({
    rootNames: [PROBE],
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: ['svelte'],
      paths: {
        '@sveltekit-i18n/base': [resolve(source, 'index.ts')],
        '#kit-env': [resolve(source, 'kit/env.ts')],
        '#kit-server': [resolve(source, 'kit/server.ts')],
      },
    },
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(PROBE);

  if (!file) throw new Error('The probe is not in its program.');

  const warmed = new Set<string>();

  // In source order, before anything else checks the file: each call pays for
  // what no earlier call instantiated.
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;

    const call = statement.expression;
    const subject = ((call.expression as ts.PropertyAccessExpression).expression as ts.Identifier).text;
    const shape = `${describeCall(call, file)} (${SUBJECTS[subject]})`;
    const before = program.getInstantiationCount();

    checker.getResolvedSignature(call);

    if (!warmed.has(shape)) {
      warmed.add(shape);
      continue;
    }

    record(`instantiations, ${shape}`, 'count', 'instantiations', program.getInstantiationCount() - before);
  }

  expect(ts.getPreEmitDiagnostics(program).map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, '\n'))).toEqual([]);
}, 120_000);
