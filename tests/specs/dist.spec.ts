import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import I18n, { type Loader } from '../../dist/index.js';
import { read } from '../../src/utils.js';
import { describeCost } from '../utils/cost.js';
import { describeRegistry } from '../utils/registry.js';

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
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.locale).toBe('en');
    expect(instance.t('common.greeting')).toBe('Hi');
  });

  it('hands a preload\'s token to the commit of the same locale and route', async () => {
    let runs = 0;
    const instance = new I18n({
      parser,
      log,
      loaders: [{ namespace: 'item', locale: 'en', cache: false, loader: async () => ({ title: `v${runs += 1}` }) }],
    });

    const preloaded: Loader.Preloaded | undefined = await instance.preload('en', '/');

    expect(preloaded).toBeDefined();
    expect(instance.locale).toBe(undefined);

    await instance.loadTranslations('en', '/', { preloaded });

    expect(instance.locale).toBe('en');
    expect(instance.t('item.title')).toBe('v1');
    expect(runs).toBe(1);
  });

  it('keeps a locale named like an `Object.prototype` member as an own key', async () => {
    const instance = new I18n({
      parser,
      log,
      loaders: [{ namespace: 'common', locale: '__proto__', loader: async () => ({ greeting: 'Hi' }) }],
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
    const { matchLocale, resolveLoaders, sanitizeLocales, textDirection, toDotNotation } = await import(specifier);

    expect(toDotNotation({ user: { name: 'Name' } })).toEqual({ 'user.name': 'Name' });
    expect(sanitizeLocales('en-us', null)).toEqual(['en-US']);
    expect(matchLocale('en-GB,cs;q=0.8', ['cs', 'en'])).toBe('en');
    expect(resolveLoaders([{ locale: ['en-us', 'cs'], namespace: 'common', loader: async () => ({}) }]).map(({ locale }: { locale: string }) => locale)).toEqual(['en-US', 'cs']);
    expect(textDirection('ar-EG')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
  });

  it('serves the SvelteKit wiring, with the server half on the server only', async ({ task }) => {
    const specifier = '@sveltekit-i18n/base/kit';
    const { defineI18n } = await import(specifier);
    const { handle, load } = defineI18n({
      parser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => ({}) }],
    });
    const url = new URL('https://x.test/');
    const event = {
      url,
      params: {},
      route: { id: '/' },
      isDataRequest: true,
      cookies: { get: () => undefined },
      request: new Request(url, { headers: { 'accept-language': 'en' } }),
    };

    // The `imports` map picks the half by the `browser` condition.
    if (task.file.projectName === 'client') expect(() => handle({ event, resolve: () => new Response() })).toThrow('run on the server only');
    else expect(await load(event)).toEqual({ i18n: { locale: 'en', route: '/' } });
  });

  // SvelteKit reads a module's role off its path once the package's real path
  // lies outside the app root's `node_modules`: it refuses a server-only
  // module within the app root in the browser (a vendored copy, a workspace
  // whose root is the app), and serves a remote one as an endpoint wherever it
  // lies. The patterns of `@sveltejs/kit`'s `src/exports/vite/utils.js`.
  it('ships no path SvelteKit takes for a server-only or a remote module', () => {
    const kitPatterns = [/[/.]server\.[^/]+$/, /\/server\//, /[/.]remote\.[^/]+$/];
    const shipped = readdirSync(new URL('../../dist/', import.meta.url), { recursive: true, encoding: 'utf8' })
      .map((path) => `/dist/${path.replaceAll('\\', '/')}`);

    expect(shipped).toContain('/dist/index.js');
    expect(shipped.filter((path) => kitPatterns.some((pattern) => pattern.test(path)))).toEqual([]);
  });
});

// The registry's `declare global` has to survive `svelte-package`.
describeRegistry('dist');

// The shipped declarations keep a call's cost off the size of the schema.
describeCost('dist');
