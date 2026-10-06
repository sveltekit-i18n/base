import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TYPES = resolve(dirname(fileURLToPath(import.meta.url)), '../types');
// The compiler's own entry, run by the runtime running the suite. The
// `node_modules/.bin` shim is an extensionless shell script on Windows, which
// `execFile` cannot spawn at all; Deno runs a script only with permissions.
const TSC = resolve(TYPES, '../../node_modules/typescript/bin/tsc');
const RUNTIME_ARGS = 'Deno' in globalThis ? ['run', '-A'] : [];

/**
 * Compiles the program of `project`, a tsconfig under tests/types/, and
 * returns what `tsc` reported.
 */
export const compile = async (project: string, ...options: string[]): Promise<string> => {
  try {
    await run(process.execPath, [...RUNTIME_ARGS, TSC, '-p', resolve(TYPES, project), ...options]);

    return '';
  } catch (failure) {
    const reported = `${(failure as { stdout?: string }).stdout ?? ''}`.trim();

    // `tsc` reports on stdout and exits non-zero. A rejection carrying nothing
    // is the compiler failing to run, and reading that as a clean compile
    // would pass every case silently.
    if (!reported) throw failure;

    return reported;
  }
};
