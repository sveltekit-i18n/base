import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
// eslint-disable-next-line import/extensions -- the built ESM bundle is the subject under test
import I18n from '../../dist/index.js';

// The suite compiles `src` with a newer target than the published bundle, so
// prototype safety proven there says nothing about what ships. esbuild lowers
// object spread to its own helper; these assertions pin that the built artifact
// keeps a prototype-named locale as an own property.
describe('published bundle', () => {
  const parser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };
  const log = { level: 'error' as const };

  it('keeps a locale named like an `Object.prototype` member as an own key', async () => {
    const instance = new (I18n as any)({
      parser,
      log,
      loaders: [{ key: 'common', locale: '__proto__', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await instance.loadTranslations('__proto__');

    const table = instance.translations.get();
    const descriptor = Object.getOwnPropertyDescriptor(table, '__proto__');

    expect(descriptor).toBeDefined();
    expect(descriptor?.value).toEqual(
      expect.objectContaining({ 'common.greeting': 'Hi' }),
    );
    expect(Object.getPrototypeOf(table)).toBe(Object.prototype); // not reparented
  });

  it('keeps a literal `__proto__` translation key as an own property', async () => {
    const instance = new (I18n as any)({ parser, log });

    instance.addTranslations({ en: JSON.parse('{"__proto__": "boom", "plain": "ok"}') });

    const table = instance.translations.get().en;

    expect(Object.getOwnPropertyDescriptor(table, '__proto__')?.value).toBe('boom');
    expect(table.plain).toBe('ok');
    expect(Object.getPrototypeOf(table)).toBe(Object.prototype); // not reparented
  });
});

// `dist/index.cjs` is a separate esbuild pass with its own copy of the spread
// helper, so the ESM assertions above say nothing about it. It has to run in a
// real Node process: jest's ESM runtime cannot `require()` the bundle, and
// neither can a Node old enough to reject `require()` of an ESM dependency
// (svelte ships its store as ESM only) — where that is the case there is no
// loadable CJS entry to assert on.
const probeCjs = () => {
  // Resolved relative to this spec, like the ESM import above — `process.cwd()`
  // is wherever jest was invoked from, which is not necessarily the package
  // root. JSON-encoded because the path contains backslashes on Windows, which
  // a raw interpolation would turn into escape sequences (`\\a` -> `a`).
  const entry = JSON.stringify(fileURLToPath(new URL('../../dist/index.cjs', import.meta.url)));

  // The child reports which outcome happened rather than the spec guessing from
  // an error message, and the reason is checked: ONLY this Node being unable to
  // `require()` svelte's ESM-only store is tolerated. A missing, malformed or
  // otherwise broken bundle has to fail, or it would ship as a green skip.
  const script = `
    let bundle;
    try {
      bundle = require(${entry});
    } catch (error) {
      console.log(JSON.stringify({ loadable: false, reason: String((error && error.code) || error) }));
      process.exit(0);
    }

    const I18n = bundle.default || bundle;
    const instance = new I18n({ parser: { parse: (text, params, locale, key) => (text === undefined ? key : text) }, log: { level: 'error' } });
    instance.addTranslations({ en: JSON.parse('{"__proto__": "boom", "plain": "ok"}') });
    const table = instance.translations.get().en;
    console.log(JSON.stringify({
      loadable: true,
      own: Object.getOwnPropertyDescriptor(table, '__proto__') && Object.getOwnPropertyDescriptor(table, '__proto__').value,
      plain: table.plain,
      keepsPrototype: Object.getPrototypeOf(table) === Object.prototype,
    }));
  `;

  let result;
  try {
    // Runs at module evaluation, where jest's per-test timeout does not apply.
    result = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 }));
  } catch (error: any) {
    throw new Error(`CJS bundle probe failed:\n${error?.stderr || error?.message || error}`);
  }

  if (!result.loadable && result.reason !== 'ERR_REQUIRE_ESM') {
    throw new Error(`The published CJS entry could not be loaded: ${result.reason}`);
  }

  return result;
};

const cjs = probeCjs();

(cjs.loadable ? describe : describe.skip)('published bundle (CJS entry)', () => {
  it('keeps a literal `__proto__` translation key as an own property', () => {
    expect(cjs.own).toBe('boom');
    expect(cjs.plain).toBe('ok');
    expect(cjs.keepsPrototype).toBe(true);
  });
});
