import { describe, expect, it } from 'vitest';
import I18n from '../../dist/index.js';
import { read } from '../../src/utils.js';

// The published artifact ships UNCOMPILED rune modules (`dist/I18n.svelte.js`)
// for the consumer's bundler to compile — which is exactly what this suite's
// svelte plugin does here. These tests therefore exercise the real shipped
// shape: entry resolution, the preserved `.svelte.js` infix, and prototype
// safety of the built table.
describe('published artifact', () => {
  const parser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };
  const log = { level: 'error' as const };

  it('loads and activates a locale through the shipped entry', async () => {
    const instance = new I18n({
      parser,
      log,
      loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.locale).toBe('en');
    expect(instance.t('common.greeting')).toBe('Hi');
  });

  it('keeps a locale named like an `Object.prototype` member as an own key', async () => {
    const instance = new I18n({
      parser,
      log,
      loaders: [{ key: 'common', locale: '__proto__', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await instance.loadTranslations('__proto__');

    const descriptor = Object.getOwnPropertyDescriptor(instance.translations, '__proto__');

    expect(descriptor).toBeDefined();
    expect(Object.getPrototypeOf(instance.translations)).toBe(Object.prototype); // not reparented
  });

  it('keeps a literal `__proto__` translation key as an own property', () => {
    const instance = new I18n({ parser, log });

    instance.addTranslations({ en: JSON.parse('{"__proto__": "boom", "plain": "ok"}') });

    const table = instance.translations.en;

    expect(read(table, '__proto__')).toBe('boom');
    expect(table.plain).toBe('ok');
    expect(({} as any).boom).toBe(undefined); // Object.prototype untouched
  });

  it('serves the reusable helpers from the shipped subpath', async () => {
    // Imported by package name, through the `exports` map — the subpath the
    // consumer writes, not the file path it happens to resolve to. The
    // specifier is a variable so that TypeScript leaves the self-reference to
    // Node instead of demanding a `rootDir`.
    const specifier = '@sveltekit-i18n/base/utils';
    const { sanitizeLocales, toDotNotation } = await import(specifier);

    expect(toDotNotation({ user: { name: 'Name' } })).toEqual({ 'user.name': 'Name' });
    expect(sanitizeLocales('en-us', null)).toEqual(['en-US']);
  });
});
