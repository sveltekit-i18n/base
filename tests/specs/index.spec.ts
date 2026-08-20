import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import i18n from '../../src/index.js';
import type { I18n } from '../../src/index.js';
import { logger, loggerFactory, setLogger } from '../../src/logger.js';
import { read, sanitizeLocales, testRoute, toDotNotation, translate } from '../../src/utils.js';
import * as publicUtils from '../../src/exports/utils.js';
import type { DotNotation } from '../../src/exports/utils.js';
import { CONFIG, getTranslations } from '../data/index.js';
import { filterTranslationKeys } from '../utils/index.js';

const TRANSLATIONS = getTranslations();

const { initLocale = '', loaders = [], parser, log } = CONFIG;

describe('i18n instance', () => {
  it('exports all properties and methods', () => {
    const instance = new i18n();

    // Called per property: destructured matchers are not bound in vitest.
    expect(instance).toHaveProperty('locale');
    expect(instance).toHaveProperty('locales');
    expect(instance).toHaveProperty('loading');
    expect(instance).toHaveProperty('initialized');
    expect(instance).toHaveProperty('translations');
    expect(instance).toHaveProperty('rawTranslations');
    expect(instance).toHaveProperty('t');
    expect(instance).toHaveProperty('l');
    expect(instance).toHaveProperty('loadConfig');
    expect(instance).toHaveProperty('loadTranslations');
    expect(instance).toHaveProperty('addTranslations');
    expect(instance).toHaveProperty('setLocale');
    expect(instance).toHaveProperty('setRoute');
    expect(instance).toHaveProperty('invalidate');
    expect(instance).toHaveProperty('snapshot');
    expect(instance).toHaveProperty('destroy');
    // The v2 SSR hand-off primitive is deleted from v3, not deprecated — pin
    // its absence so it cannot quietly return.
    expect(instance).not.toHaveProperty('getTranslationProps');
  });
  it('`setRoute` does not trigger loading when no locale was requested', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('/');

    expect(instance.locale).toBe(undefined);
    expect(instance.initialized).toBe(false);
    expect(instance.loading).toBe(false);
  });
  it('`setRoute` triggers loading once a locale was requested', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setLocale(initLocale);

    const promise = instance.setRoute('/');

    expect(instance.loading).toBe(true);
    expect(instance.initialized).toBe(false);

    await promise;

    expect(instance.initialized).toBe(true);
  });
  it('`setLocale` does not trigger loading when no route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setLocale(initLocale);

    expect(instance.loading).toBe(false);
    expect(Object.keys(instance.translations).length).toBe(0);
  });
  it('`setLocale` triggers loading when a route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');

    const promise = instance.setLocale(initLocale);

    expect(instance.loading).toBe(true);

    await promise;

    expect(Object.keys(instance.translations).length).toBeGreaterThan(0);
  });
  it('`setLocale` does not set an unknown locale', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');
    await instance.setLocale('unknown');

    expect(instance.loading).toBe(false);
    expect(instance.locale).toBe(undefined);
  });
  it('assigning `locale` does not load until a route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    instance.locale = initLocale;

    expect(instance.loading).toBe(false);

    const promise = instance.setRoute('');

    expect(instance.loading).toBe(true);

    await promise;

    expect(instance.initialized).toBe(true);
  });
  it('the active `locale` is case-insensitive to the requested one', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');
    await instance.setLocale(initLocale.toUpperCase());

    expect(instance.locale).toBe(initLocale.toLowerCase());
  });
  it('`locale` can be non-standard', async () => {
    const nonStandardLocale = 'ku';
    const instance = new i18n({
      loaders: [{
        key: 'common',
        locale: nonStandardLocale.toUpperCase(),
        loader: async () => (await import(`../data/translations/${nonStandardLocale}/common.json`)).default,
      }],
      parser,
      log,
    });

    await instance.setRoute('');
    await instance.setLocale(nonStandardLocale);

    expect(instance.locale).toBe(nonStandardLocale);
    expect(instance.locales).toContainEqual(nonStandardLocale);
    expect(instance.translations[nonStandardLocale]).toEqual(
      expect.objectContaining(filterTranslationKeys(TRANSLATIONS[nonStandardLocale], ['common'])),
    );
  });
  it('`addTranslations` adds raw translations', () => {
    const instance = new i18n();

    const translations = getTranslations('none');

    instance.addTranslations(translations);

    expect(instance.rawTranslations).toStrictEqual(translations);
  });
  it('`addTranslations` adds preprocessed translations', () => {
    const instance = new i18n();

    instance.addTranslations(getTranslations('none'));

    expect(instance.translations).toStrictEqual(TRANSLATIONS);
  });
  it('`addTranslations` prevents a duplicit load', () => {
    const instance = new i18n({ loaders, parser, log });

    instance.addTranslations(TRANSLATIONS);
    void instance.loadTranslations(initLocale);

    expect(instance.loading).toBe(false);
  });
  it('a cache-served load still activates the locale', async () => {
    const instance = new i18n({ loaders, parser, log });

    instance.addTranslations(TRANSLATIONS);
    await instance.loadTranslations(initLocale);

    expect(instance.locale).toBe(initLocale);
  });
  it('`preprocess` works when set to `full`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'full' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations[initLocale]['common.preprocess.0.test.array']).toBe('passed');
  });
  it('`preprocess` works when set to `preserveArrays`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'preserveArrays' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations[initLocale]['common.preprocess']).toStrictEqual([
      { 'test.array': 'passed' },
      'string',
      null,
      0,
      1,
      -1,
      true,
      false,
    ]);
  });
  it('`preprocess` works when set to `none`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'none' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations).toStrictEqual(instance.rawTranslations);
    expect(instance.translations[initLocale].common.preprocess[0].test.array).toBe('passed');
  });
  it('`preprocess` set to a custom function stores its output as-is', async () => {
    const instance = new i18n({
      loaders,
      parser,
      log,
      preprocess: (input) => Object.fromEntries(
        Object.entries(input).map(([key, value]) => [`app.${key}`, value]),
      ),
    });

    await instance.loadTranslations(initLocale);

    // A custom function replaces the flattening rather than feeding it: the
    // nesting survives and the namespace is reachable only under the key the
    // function produced.
    expect(instance.translations[initLocale]['app.common'].preprocess[0].test.array).toBe('passed');
    expect(instance.translations[initLocale].common).toBeUndefined();
    expect(instance.rawTranslations[initLocale].common.preprocess[0].test.array).toBe('passed');
  });
  it('initializes properly with `initLocale`', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.initialized).toBe(true);
  });
  it('does not initialize without `initLocale`', async () => {
    const instance = new i18n();

    await instance.loadConfig({ loaders, parser, log });

    expect(instance.initialized).toBe(false);
  });
  it('`loading` is set for the duration of a load and released after', async () => {
    const instance = new i18n({ loaders, parser, log });

    const promise = instance.loadTranslations(initLocale, '/');

    expect(instance.loading).toBe(true);

    await promise;

    expect(instance.loading).toBe(false);
  });
  it('includes `locales` after config load', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.locales).toContain(initLocale);
  });
  it('includes the current `locale` value', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.locale).toBe(initLocale);
  });
  it('includes `translations` for `initLocale` only after config load', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    const keys = loaders.filter(({ routes }) => !routes).map(({ key }) => key);

    instance.locales.forEach((locale) => {
      expect(instance.translations[locale]).toEqual(
        (locale === initLocale)
          ? expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys))
          : expect.not.objectContaining(TRANSLATIONS[locale]),
      );
    });
  });
  it('includes both `translations` when using `fallbackLocale`', async () => {
    const instance = new i18n();
    const fallbackLocale = loaders.find(({ locale }) => locale.toLowerCase() !== initLocale.toLowerCase())?.locale;

    await instance.loadConfig({ ...CONFIG, fallbackLocale });

    const keys = loaders.filter(({ routes }) => !routes).map(({ key }) => key);

    instance.locales.forEach((locale) => {
      expect(instance.translations[locale]).toEqual(
        expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys)),
      );
    });
  });
  it('`fallbackLocale` is used instead of an unknown locale', async () => {
    const fallbackLocale = loaders.find(({ locale }) => locale.toLowerCase() !== initLocale.toLowerCase())?.locale;

    const instance = new i18n({ loaders, parser, fallbackLocale });

    await instance.loadTranslations('de', '');

    expect(instance.locale).toBe(fallbackLocale);
  });
  it('includes `translations` only for loaders without routes', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    const keys = loaders.filter(({ routes }) => !!routes).map(({ key }) => key);

    expect(instance.translations[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );
  });
  it('`loadTranslations` works without a route', async () => {
    const instance = new i18n();

    await instance.loadConfig({ loaders, parser, log });
    expect(instance.initialized).toBe(false);

    await instance.loadTranslations(initLocale);
    expect(instance.initialized).toBe(true);
  });
  it('`loadTranslations` works for given routes only', async () => {
    const instance = new i18n({ loaders, parser, log });
    const url = '/path#hash?a=b&c=d';
    const keys = loaders.filter(({ routes }) => routes?.includes(url)).map(({ key }) => key);

    await instance.loadTranslations(initLocale, '/');
    expect(instance.translations[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );

    await instance.loadTranslations(initLocale, url);
    expect(instance.translations[initLocale]).toEqual(
      expect.objectContaining(TRANSLATIONS[initLocale]),
    );
  });
  it('a failed load rejects the returned promise', async () => {
    const instance = new i18n({
      parser,
      log,
      preprocess: () => { throw new Error('preprocess boom'); },
      loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await expect(instance.loadTranslations('en', '/')).rejects.toThrow('preprocess boom');

    // The failed load must not stay pending forever.
    expect(instance.loading).toBe(false);
  });
  it('`fallbackValue` works with a `string` value', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    expect(instance.t('unknown.key')).toBe(fallbackValue);
  });
  it('`fallbackValue` works with an `undefined` value', async () => {
    const fallbackValue = undefined;

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    expect(instance.t('unknown.key')).toBe(fallbackValue);
  });
  it('returns the translation key when `fallbackValue` is not present', async () => {
    const instance = new i18n(CONFIG);

    await instance.loadTranslations(initLocale);

    const key = 'unknown.key';

    expect(instance.t(key)).toBe(key);
  });
  it('treats `Object.prototype` keys as missing translations', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    // These keys exist on `Object.prototype`; they must not leak as translations.
    ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'].forEach((key) => {
      expect(instance.t(key)).toBe(fallbackValue);
    });
  });
  it('handles a locale named like an `Object.prototype` member', async () => {
    // A loader locale colliding with a prototype member must not throw when the
    // `loadedKeys` cache is indexed by it, must keep its data, and must still
    // be deduped by that cache.
    let calls = 0;
    const instance = new i18n({
      ...CONFIG,
      initLocale: undefined,
      loaders: [
        {
          key: 'common',
          locale: '__proto__',
          loader: async () => { calls += 1; return { greeting: 'Hi' }; },
        },
      ],
    });

    await expect(instance.loadTranslations('__proto__')).resolves.not.toThrow();

    expect(read(instance.translations, '__proto__')).toEqual(
      expect.objectContaining({ 'common.greeting': 'Hi' }),
    );

    // The dedupe cache must hold an OWN entry for the locale — on a plain
    // object the write would go through the `__proto__` setter instead, and
    // the loader would refire on every route change.
    await instance.loadTranslations('__proto__', '/second');
    expect(calls).toBe(1);
  });
  it('keeps a literal `__proto__` translation key as an own property', () => {
    const instance = new i18n({ parser, log });

    // JSON.parse creates real own '__proto__' keys (object literals would not).
    instance.addTranslations({ en: JSON.parse('{"__proto__": "boom", "plain": "ok"}') });

    const table = instance.translations.en;

    expect(read(table, '__proto__')).toBe('boom');
    expect(table.plain).toBe('ok');
    expect(({} as any).boom).toBe(undefined); // Object.prototype untouched
  });
  it('`addTranslations` fails soft on a `null` payload', () => {
    const instance = new i18n({ parser, log });

    // A module that resolved to `null` is consumer input, not a bug in the
    // instance: every other step tolerates it, so the whole call must too.
    expect(() => instance.addTranslations({ en: null as any, de: { greeting: 'Hallo' } })).not.toThrow();

    expect(read(instance.translations, 'de')).toEqual(
      expect.objectContaining({ greeting: 'Hallo' }),
    );
  });
  it('merges two loaders sharing a prototype-named locale into one table', async () => {
    const instance = new i18n({
      ...CONFIG,
      initLocale: undefined,
      loaders: [
        { key: 'a', locale: '__proto__', loader: async () => ({ one: '1' }) },
        { key: 'b', locale: '__proto__', loader: async () => ({ two: '2' }) },
      ],
    });

    await instance.loadTranslations('__proto__');

    expect(read(instance.translations, '__proto__')).toEqual(
      expect.objectContaining({ 'a.one': '1', 'b.two': '2' }),
    );
  });
  it('logger works as expected', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const instance = new i18n({
        ...CONFIG,
        initLocale: 'unknown',
        log: { level: 'debug', logger: console, prefix: '[PREFIX] ' },
      });

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith("[PREFIX] 'unknown' locale is non-standard.");
      });

      expect(debug).toHaveBeenCalledWith('[PREFIX] Setting config.');
      expect(instance.loading).toBe(false);
    } finally {
      debug.mockRestore();
      warn.mockRestore();
    }
  });
  it('keeps successful translations when one loader throws', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
        { key: 'broken', locale: 'en', loader: async () => { throw new Error('loader boom'); } },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.t('common.greeting')).toBe('Hello');
    expect(errorSpy).toHaveBeenCalled();
  });
  it('a loader receives its sanitized locale and the triggering route', async () => {
    const received: unknown[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { key: 'common', locale: 'EN', loader: async (props) => { received.push(props); return { greeting: 'Hello' }; } },
      ],
    });

    await instance.loadTranslations('en', '/path');

    expect(received).toEqual([{ locale: 'en', route: '/path' }]);
  });
  it('a fallback-locale loader receives its own locale, not the requested one', async () => {
    const received: unknown[] = [];
    const push = async (props: { locale: string; route: string }) => { received.push(props); return { greeting: 'Hello' }; };
    const instance = new i18n({
      parser,
      log,
      fallbackLocale: 'EN',
      loaders: [
        { key: 'common', locale: 'EN', loader: push },
        { key: 'common', locale: 'DE', loader: push },
      ],
    });

    await instance.loadTranslations('de', '/path');

    expect(received).toEqual(expect.arrayContaining([
      { locale: 'de', route: '/path' },
      { locale: 'en', route: '/path' },
    ]));
    expect(received).toHaveLength(2);
  });
  it('forwards a thrown loader value to the configured logger unwrapped', async () => {
    const errorSpy = vi.fn();
    const boom = new Error('loader boom');
    const instance = new i18n({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { key: 'broken', locale: 'en', loader: async () => { throw boom; } },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(errorSpy).toHaveBeenCalledWith(
      "[i18n]: Failed to load translation. Verify your 'en' > 'broken' Loader.",
      boom,
    );
  });
  it('matches `routes` through a custom matcher object', async () => {
    const seen: string[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          key: 'common',
          locale: 'en',
          routes: [{ test: (route: string) => { seen.push(route); return route.startsWith('/products'); } }],
          loader: async () => ({ greeting: 'Hello' }),
        },
      ],
    });

    await instance.loadTranslations('en', '/about');
    expect(instance.translations['en']).toBeUndefined();

    await instance.loadTranslations('en', '/products/123');
    expect(instance.translations['en']['common.greeting']).toBe('Hello');
    // The matcher may be consulted more than once per load — it is given the
    // bare route path every time, never a full URL.
    expect(Array.from(new Set(seen))).toEqual(['/about', '/products/123']);
  });
  it('reports a non-string loader key without throwing', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n();

    await expect(instance.loadConfig({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { key: Symbol('common') as unknown as string, locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
      ],
    })).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
  });
  it('reports a loader key containing a `.` character but keeps the loader', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n();

    await instance.loadConfig({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      initLocale: 'en',
      loaders: [
        { key: 'common.nested', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
      ],
    });

    expect(errorSpy).toHaveBeenCalledWith("[i18n]: Invalid 'common.nested' loader key. It shouldn't include the '.' character.");
    // Report-only: the loader still ran and its data landed in the table.
    expect(read(instance.translations['en'], 'common.nested.greeting')).toBe('Hello');
  });
  it('does not throw when `t`/`l` are used before a config is loaded', () => {
    const instance = new i18n();

    expect(() => instance.t('common.key')).not.toThrow();
    expect(() => instance.l('en', 'common.key')).not.toThrow();
  });
});

describe('i18n locale keys', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('`addTranslations` normalizes the locale key so `t` reaches the data', async () => {
    const instance = new i18n({ parser: valueParser, log, initLocale: 'EN', translations: { EN: { greeting: 'Hello' } } });

    await instance.loadTranslations('EN');

    expect(instance.locale).toBe('en');
    expect(Object.keys(instance.translations)).toEqual(['en']);
    expect(instance.t('greeting')).toBe('Hello');
  });

  it('`addTranslations` merges spellings that normalize to the same locale', () => {
    const instance = new i18n({ parser: valueParser, log });

    instance.addTranslations({ EN: { greeting: 'Hello' }, en: { farewell: 'Bye' } });

    expect(instance.rawTranslations).toStrictEqual({ en: { greeting: 'Hello', farewell: 'Bye' } });
  });

  it('`l` reaches the table through a non-canonical locale', () => {
    const instance = new i18n({ parser: valueParser, log, translations: { en: { greeting: 'Hello' } } });

    expect(instance.l('EN', 'greeting')).toBe('Hello');
  });

  it('a non-canonical `config.translations` key still suppresses its loader', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      translations: { EN: { common: { greeting: 'Hello' } } },
      loaders: [{ key: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } }],
    });

    await instance.loadTranslations('en');

    expect(calls).toBe(0);
    expect(instance.t('common.greeting')).toBe('Hello');
  });

  it('`snapshot` carries data added under a non-canonical locale', async () => {
    const instance = new i18n({ parser: valueParser, log, translations: { EN: { common: { greeting: 'Hello' } } } });

    await instance.loadTranslations('EN');

    expect(instance.snapshot()).toEqual({ en: { common: { greeting: 'Hello' } } });
  });
});

describe('i18n sanitizeLocales config', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('`false` keeps every locale exactly as it was authored', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: false,
      initLocale: 'CS',
      translations: { CS: { greeting: 'Ahoj' } },
    });

    await instance.loadTranslations('CS');

    expect(instance.locale).toBe('CS');
    expect(instance.locales).toEqual(['CS']);
    expect(Object.keys(instance.translations)).toEqual(['CS']);
    expect(instance.t('greeting')).toBe('Ahoj');
    expect(instance.l('CS', 'greeting')).toBe('Ahoj');
  });

  it('`false` keeps spellings of one locale apart', () => {
    const instance = new i18n({ parser: valueParser, log, sanitizeLocales: false });

    instance.addTranslations({ CS: { greeting: 'Ahoj' }, cs: { farewell: 'Ahoj' } });

    expect(instance.rawTranslations).toStrictEqual({ CS: { greeting: 'Ahoj' }, cs: { farewell: 'Ahoj' } });
  });

  it('a custom transform keys loaders, tables and the active locale', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: (locale) => locale.toUpperCase(),
      loaders: [{ key: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } }],
    });

    await instance.loadTranslations('en');

    expect(calls).toBe(1);
    expect(instance.locale).toBe('EN');
    expect(instance.locales).toEqual(['EN']);
    expect(Object.keys(instance.translations)).toEqual(['EN']);
    expect(instance.t('common.greeting')).toBe('Hello');

    // The bookkeeping is keyed through the same transform, so an authored
    // locale reaches the entry the load created.
    instance.invalidate('en');
    await instance.loadTranslations('EN');

    expect(calls).toBe(2);
  });

  it('normalizes `initLocale` and `fallbackLocale` the way the INCOMING config asks', async () => {
    // They are normalized before the config is applied, so they must not be
    // read through the strategy the instance is still configured with.
    const instance = new i18n();

    await instance.loadConfig({
      parser: valueParser,
      log,
      sanitizeLocales: false,
      initLocale: 'EN',
      fallbackLocale: 'CS',
      translations: { CS: { greeting: 'Ahoj' }, EN: { farewell: 'Ahoj' } },
    });

    expect(instance.locale).toBe('EN');
    expect(instance.t('greeting')).toBe('Ahoj');
  });

  it('a throwing transform falls back to the locale as authored', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: () => { throw new Error('nope'); },
      translations: { en: { greeting: 'Hello' } },
    });

    await expect(instance.loadTranslations('en')).resolves.toBeUndefined();

    expect(instance.locale).toBe('en');
    expect(instance.t('greeting')).toBe('Hello');
  });
});

describe('i18n extensions', () => {
  it('constructs the plain instance when no extensions are configured', () => {
    // Assignability doubles as the type-level assertion: without extensions
    // the construction-time type stays the instance type.
    const instance: I18n = new i18n({ parser, log });

    expect(instance).toBeInstanceOf(i18n);
  });
  it('pipes the instance through the extensions left to right', () => {
    const order: string[] = [];
    const instance = new i18n({
      parser,
      log,
      extensions: [
        (input: I18n) => { order.push('first'); return Object.assign(input, { first: true as const }); },
        (input: I18n & { first: true }) => { order.push('second'); return Object.assign(input, { second: true as const }); },
      ],
    });

    expect(order).toEqual(['first', 'second']);
    // Property accesses double as type-level assertions: the construction-time
    // type is the instance folded through the extension tuple.
    expect(instance.first).toBe(true);
    expect(instance.second).toBe(true);
    expect(instance).toBeInstanceOf(i18n);
  });
  it('an augmenting extension keeps the instance surface intact', () => {
    // Synchronous translations + `initLocale` activate the locale within the
    // constructor, so `t` resolves right after construction.
    const instance = new i18n({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => Object.assign(input, { flag: true as const })],
    });

    expect(instance.flag).toBe(true);
    // The no-op test parser returns the key, so `t` resolving proves the
    // reactive surface survived the pipe.
    expect(instance.t('common.key')).toBe('common.key');
  });
  it('a transforming extension replaces the constructed surface', () => {
    const instance = new i18n({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => ({ translate: input.t, instance: input })],
    });

    expect(instance).not.toBeInstanceOf(i18n);
    expect(instance.instance).toBeInstanceOf(i18n);

    // Bound fields survive being carried off the instance by a transform.
    const { translate } = instance;
    expect(translate('common.key')).toBe('common.key');
  });
  it('extensions receive an already configured instance', () => {
    let seenLocales: string[] = [];

    void new i18n({
      parser,
      log,
      loaders,
      extensions: [(input: I18n) => {
        seenLocales = input.locales;
        return input;
      }],
    });

    expect(seenLocales).toContain('en');
  });
  it('`loadConfig` ignores `extensions` — the pipe is construction-only', async () => {
    const calls = vi.fn();
    const instance = new i18n();

    await instance.loadConfig({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => { calls(); return input; }],
    });

    expect(calls).not.toHaveBeenCalled();
    expect(instance.t('common.key')).toBe('common.key');
  });
});

describe('i18n loading concurrency', () => {
  // Unlike the shared no-op parser, this one returns the loaded value, so the
  // specs below can assert on actual translation output.
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('concurrent identical load triggers share one in-flight load', async () => {
    let calls = 0;
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { key: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } },
      ],
    });

    const first = instance.loadTranslations('en', '/');
    const second = instance.loadTranslations('en', '/');
    const third = instance.setLocale('en');

    // Duplicates must resolve with the load already in flight, not a new one.
    expect(second).toBe(first);
    expect(third).toBe(first);

    await first;

    expect(calls).toBe(1);
  });

  it('activates the most recently requested locale when loads resolve out of order', async () => {
    const gates: Record<string, () => void> = {};
    const blockUntilOpened = (locale: string) => new Promise<void>((resolve) => { gates[locale] = resolve; });

    const instance = new i18n({
      parser,
      log,
      loaders: [
        { key: 'common', locale: 'en', loader: async () => { await blockUntilOpened('en'); return { greeting: 'Hello' }; } },
        { key: 'common', locale: 'cs', loader: async () => { await blockUntilOpened('cs'); return { greeting: 'Ahoj' }; } },
      ],
    });

    await instance.setRoute('/');

    const first = instance.setLocale('en');
    const second = instance.setLocale('cs');

    // The superseded 'en' load resolves AFTER the current 'cs' one.
    gates.cs();
    await second;
    expect(instance.locale).toBe('cs');

    gates.en();
    await first;

    expect(instance.locale).toBe('cs');
  });

  it('an unknown requested locale does not block activation of a completed load', async () => {
    const gates: Record<string, () => void> = {};
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          key: 'common',
          locale: 'en',
          loader: async () => {
            await new Promise<void>((resolve) => { gates.en = resolve; });
            return { greeting: 'Hello' };
          },
        },
      ],
    });

    const first = instance.loadTranslations('en', '/');
    // 'xx' matches no loader and no fallback, so it resolves to no known
    // locale — a request that supersedes nothing.
    const second = instance.setLocale('xx');

    gates.en();
    await Promise.all([first, second]);

    expect(instance.locale).toBe('en');
  });

  it('does not mark a loader as loaded because of a similarly named sibling key', async () => {
    // 'navbar' data must never satisfy the 'nav' loader — a failed 'nav' load
    // has to retry on the next navigation.
    let attempts = 0;
    const instance = new i18n({
      parser: valueParser,
      log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
      loaders: [
        { key: 'navbar', locale: 'en', loader: async () => ({ title: 'Navbar' }) },
        {
          key: 'nav',
          locale: 'en',
          loader: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('nav boom');
            return { items: 'Items' };
          },
        },
      ],
    });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('en', '/other');

    expect(attempts).toBe(2);
    expect(instance.t('nav.items')).toBe('Items');
  });
});

describe('i18n cache and invalidation', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  const counterLoader = (locale: string, calls: Record<string, number>) => ({
    key: 'common',
    locale,
    loader: async () => {
      calls[locale] = (calls[locale] ?? 0) + 1;
      return { greeting: `Hello ${locale}` };
    },
  });

  it('loaded translations never expire by default', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
      await instance.loadTranslations('en', '/');

      expect(calls.en).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a finite `cache` expires translations exactly after the window elapses', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, cache: 1000, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(1);

      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(1);

      vi.advanceTimersByTime(1);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(2);

      // The refetch opens a NEW freshness window measured from its own data —
      // the original load's stamp must be gone, or the next trigger would
      // treat the fresh data as already expired.
      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(2);

      vi.advanceTimersByTime(1);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('`cache: 0` treats translations as always stale', async () => {
    // Fake timers pin `Date.now()`, proving the refetch is not a side effect
    // of time passing between the two calls.
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, cache: 0, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      await instance.loadTranslations('en', '/');

      expect(calls.en).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('each locale expires independently', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({
        parser,
        log,
        cache: 1000,
        loaders: [counterLoader('en', calls), counterLoader('cs', calls)],
      });

      await instance.loadTranslations('en', '/');
      vi.advanceTimersByTime(600);
      await instance.loadTranslations('cs', '/');
      vi.advanceTimersByTime(500);

      // 1100ms after the 'en' load, 500ms after the 'cs' one.
      await instance.loadTranslations('en', '/');
      await instance.loadTranslations('cs', '/');

      expect(calls.en).toBe(2);
      expect(calls.cs).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('`invalidate` keeps translations and triggers no load, but the next load refetches', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser: valueParser, log, loaders: [counterLoader('en', calls)] });

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(1);

    // Sanitized like every other locale input — 'EN' must hit the 'en' entry.
    instance.invalidate('EN');

    // No load was triggered and the loaded data is still served.
    expect(instance.loading).toBe(false);
    expect(instance.t('common.greeting')).toBe('Hello en');

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(2);
  });

  it('`invalidate` without a locale marks every locale stale', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls), counterLoader('cs', calls)] });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    instance.invalidate();

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    expect(calls.en).toBe(2);
    expect(calls.cs).toBe(2);
  });

  it('`invalidate` with an empty locale is a no-op instead of clearing every locale', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls), counterLoader('cs', calls)] });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    // Falsy locale inputs no-op everywhere else (`setLocale('')`,
    // `loadTranslations('')`) — '' must not select the clear-all branch.
    instance.invalidate('');

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    expect(calls.en).toBe(1);
    expect(calls.cs).toBe(1);
  });

  it('`invalidate` severs an in-flight load so its data cannot resurrect the loaded state', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { key: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    expect(calls).toBe(1);

    instance.invalidate('en');

    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    // The severed load's data is discarded — it predates the invalidation —
    // and a discarded load activates nothing.
    expect(instance.rawTranslations).toEqual({});
    expect(instance.locale).toBeUndefined();

    const fresh = instance.loadTranslations('en', '/');
    expect(calls).toBe(2);

    resolvers[1]?.({ greeting: 'fresh' });
    await fresh;

    expect(instance.t('common.greeting')).toBe('fresh');
    expect(instance.locale).toBe('en');
  });

  it('a load trigger after a mid-flight `invalidate` refetches instead of joining the severed load', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { key: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');

    const fresh = instance.loadTranslations('en', '/');

    // The post-invalidation trigger must start a NEW load, not join the
    // severed one.
    expect(fresh).not.toBe(stale);
    expect(calls).toBe(2);

    resolvers[1]?.({ greeting: 'fresh' });
    await fresh;
    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    // The stale settle must neither overwrite the fresh data nor resurrect
    // the bookkeeping the invalidation dropped.
    expect(instance.t('common.greeting')).toBe('fresh');

    await instance.loadTranslations('en', '/');
    expect(calls).toBe(2);
  });

  it('`loadConfig` marks previous loads stale so a reconfiguration refetches', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls)] });

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(1);

    let reconfiguredCalls = 0;
    await instance.loadConfig({
      parser,
      log,
      loaders: [{ key: 'common', locale: 'en', loader: async () => { reconfiguredCalls += 1; return { greeting: 'Hi' }; } }],
    });
    await instance.loadTranslations('en', '/');

    expect(reconfiguredCalls).toBe(1);
  });

  it('`loadConfig` during an in-flight load discards it and fetches through the new loaders', async () => {
    const resolvers: Array<(value: any) => void> = [];
    let oldCalls = 0;
    let newCalls = 0;

    const instance = new i18n({
      parser: valueParser,
      log,
      initLocale: 'en',
      loaders: [
        { key: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { oldCalls += 1; resolvers.push(resolve); }) },
      ],
    });
    expect(oldCalls).toBe(1);

    const reconfigured = instance.loadConfig({
      parser: valueParser,
      log,
      initLocale: 'en',
      loaders: [
        { key: 'common', locale: 'en', loader: async () => { newCalls += 1; return { greeting: 'new' }; } },
      ],
    });

    resolvers[0]?.({ greeting: 'old' });
    await reconfigured;

    // The reconfiguration must fetch through the NEW loaders, not adopt the
    // old-config load that was still in flight.
    expect(newCalls).toBe(1);
    expect(instance.t('common.greeting')).toBe('new');

    await instance.loadTranslations('en');
    expect(newCalls).toBe(1);
  });
});

describe('i18n snapshot', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  const countingLoaders = (calls: Record<string, number>) => [
    { key: 'common', locale: 'en', loader: async () => { calls.common = (calls.common ?? 0) + 1; return { greeting: 'Hello' }; } },
    { key: 'home', locale: 'en', routes: ['/'], loader: async () => { calls.home = (calls.home ?? 0) + 1; return { title: 'Home' }; } },
    { key: 'about', locale: 'en', routes: ['/about'], loader: async () => { calls.about = (calls.about ?? 0) + 1; return { title: 'About' }; } },
    { key: 'common', locale: 'cs', loader: async () => { calls.cs = (calls.cs ?? 0) + 1; return { greeting: 'Ahoj' }; } },
  ];

  it('returns nothing before anything loaded', () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    expect(instance.snapshot()).toEqual({});
  });

  it('narrows the active locale to the current route', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/about');
    await instance.setRoute('/');

    // '/about' data is still held, but it belongs to another route — sending
    // it would let the client hydrate keys its own loaders never claim back.
    expect(instance.snapshot()).toEqual({
      en: {
        common: { greeting: 'Hello' },
        home: { title: 'Home' },
      },
    });
  });

  it('keeps keys no loader claims', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');
    instance.addTranslations({ en: { extra: { note: 'kept' } } });

    expect(instance.snapshot().en).toHaveProperty('extra');
  });

  it('includes the fallback locale', async () => {
    const instance = new i18n({ parser: valueParser, log, fallbackLocale: 'cs', loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');

    expect(Object.keys(instance.snapshot()).sort()).toEqual(['cs', 'en']);
  });

  it('is pre-preprocess, so the receiving instance applies its own', async () => {
    const instance = new i18n({ parser: valueParser, log, preprocess: 'none', loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');

    // Nested, not dot-notated — `rawTranslations` shape, not `translations`.
    expect(instance.snapshot().en.common).toEqual({ greeting: 'Hello' });
  });

  it('hydrates a fresh instance through `config.translations` without refetching', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await server.loadTranslations('en', '/');

    const calls: Record<string, number> = {};
    const client = new i18n({ parser: valueParser, log, translations: server.snapshot(), loaders: countingLoaders(calls) });

    await client.loadTranslations('en', '/');

    expect(calls).toEqual({});
    expect(client.t('common.greeting')).toBe('Hello');
    expect(client.t('home.title')).toBe('Home');
  });

  it('leaves the loaders of other routes to run on navigation', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await server.loadTranslations('en', '/about');
    await server.setRoute('/');

    const calls: Record<string, number> = {};
    const client = new i18n({ parser: valueParser, log, translations: server.snapshot(), loaders: countingLoaders(calls) });

    await client.loadTranslations('en', '/');
    expect(calls).toEqual({});

    await client.setRoute('/about');
    expect(calls).toEqual({ about: 1 });
    expect(client.t('about.title')).toBe('About');
  });
});

describe('i18n destroy', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('discards an in-flight load and clears the loading flag', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { key: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const pending = instance.loadTranslations('en', '/');
    expect(instance.loading).toBe(true);

    instance.destroy();
    expect(instance.loading).toBe(false);

    resolvers[0]?.({ greeting: 'late' });
    await pending;

    expect(calls).toBe(1);
    expect(instance.rawTranslations).toEqual({});
    expect(instance.locale).toBeUndefined();
  });

  it('ignores every further load and mutation', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ key: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } }],
    });

    await instance.loadTranslations('en', '/');
    expect(calls).toBe(1);

    instance.destroy();

    await instance.loadTranslations('en', '/about');
    await instance.setLocale('cs');
    await instance.setRoute('/about');
    instance.invalidate();
    instance.addTranslations({ en: { extra: { note: 'ignored' } } });

    expect(calls).toBe(1);
    expect(instance.locale).toBe('en');
    expect(instance.rawTranslations.en).not.toHaveProperty('extra');
  });

  it('keeps reads working, so a tearing-down component still renders', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) }],
    });

    await instance.loadTranslations('en', '/');
    instance.destroy();

    expect(instance.t('common.greeting')).toBe('Hello');
    expect(instance.l('en', 'common.greeting')).toBe('Hello');
    expect(instance.snapshot()).toEqual({ en: { common: { greeting: 'Hello' } } });
  });

  it('is idempotent', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) }],
    });

    await instance.loadTranslations('en', '/');

    instance.destroy();
    instance.destroy();

    expect(instance.t('common.greeting')).toBe('Hello');
  });
});

describe('logger', () => {
  it('skips silently when a custom logger omits a level', () => {
    const logger = { error: vi.fn() } as any;
    const output = loggerFactory({ level: 'debug', logger });

    expect(() => output.warn('missing level')).not.toThrow();
    expect(() => output.debug('missing level')).not.toThrow();

    output.error('present level');
    expect(logger.error).toHaveBeenCalledWith('[i18n]: present level');
  });
  it('survives a logger it cannot even call', () => {
    const output = loggerFactory({ level: 'debug', logger: null as any });

    expect(() => output.error('boom')).not.toThrow();
  });
  it('falls back to `warn` level for an unknown configured level', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const output = loggerFactory({ level: 'noise' as any, logger });

    output.warn('shown');
    output.debug('hidden');

    expect(logger.warn).toHaveBeenCalledWith('[i18n]: shown');
    expect(logger.debug).not.toHaveBeenCalled();
  });
  it('passes the raw error alongside the prefixed message', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const output = loggerFactory({ level: 'error', logger });
    const error = new Error('boom');

    output.error('context', error);
    expect(logger.error).toHaveBeenCalledWith('[i18n]: context', error);

    // No error → single-argument call, so `console` does not print `undefined`.
    output.error('no error attached');
    expect(logger.error).toHaveBeenLastCalledWith('[i18n]: no error attached');
  });
});

describe('translate', () => {
  it('returns the key when no parser is configured and the translation is missing', () => {
    const output = translate({
      parser: undefined as any,
      key: 'common.key',
      params: [],
      translations: { en: {} },
      locale: 'en',
    });

    expect(output).toBe('common.key');
  });
});

describe('type inference', () => {
  it('infers the `t`/`l` output type from the configured parser', () => {
    const richParser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => ({ html: key }) };
    const rich = new i18n({ parser: richParser, log });
    const plain = new i18n({ parser, log });

    // A parser declaring a rich output surfaces it on `t`/`l`.
    expectTypeOf(rich.t('key')).toEqualTypeOf<{ html: string }>();

    // An undeclared parser output (`any`) still surfaces as `string`.
    expectTypeOf(plain.t('key')).toEqualTypeOf<string>();
    expectTypeOf(plain.l('en', 'key')).toEqualTypeOf<string>();

    // Load methods resolve with no value.
    expectTypeOf(plain.setLocale('en')).toEqualTypeOf<Promise<void>>();

    expect(rich).toBeInstanceOf(i18n);
    expect(plain).toBeInstanceOf(i18n);
  });

  it('falls back to a `string` output for an untyped parser', () => {
    // A parser the consumer has no types for: inference has no return type to
    // read, so the output has to degrade to `string` like an undeclared one.
    const untypedParser: any = parser;
    const instance = new i18n({ parser: untypedParser, log });

    expectTypeOf(instance.t('key')).toEqualTypeOf<string>();
    expectTypeOf(instance.l('en', 'key')).toEqualTypeOf<string>();

    expect(instance).toBeInstanceOf(i18n);
  });
});

describe('utils', () => {
  it('publishes the reusable helpers, and only those', () => {
    expect(publicUtils.toDotNotation).toBe(toDotNotation);
    expect(publicUtils.sanitizeLocales).toBe(sanitizeLocales);
    expect(Object.keys(publicUtils).sort()).toEqual(['sanitizeLocales', 'toDotNotation']);
    expectTypeOf(publicUtils.toDotNotation).toEqualTypeOf<DotNotation.T>();
  });
  // The library logs through one module-level singleton, so a test that
  // asserts on its output installs a capturing logger and restores the
  // previous one afterwards — restoring anything else would silently change
  // the level for every later test.
  const captureLogs = () => {
    const previous = logger;
    type Entry = { message: string; error?: unknown };
    const captured = { error: [] as Entry[], warn: [] as Entry[] };

    setLogger(loggerFactory({
      level: 'warn',
      logger: {
        error: (message: any, error?: unknown) => { captured.error.push({ message: `${message}`, error }); },
        warn: (message: any, error?: unknown) => { captured.warn.push({ message: `${message}`, error }); },
      } as any,
    }));

    return { captured, restore: () => { setLogger(previous); } };
  };

  it('`sanitizeLocales` caches successes but keeps warning for unknown locales', () => {
    const { captured, restore } = captureLogs();

    try {
      // A standard locale resolves identically whether or not it is cached.
      expect(sanitizeLocales('zh-Hans')).toEqual(sanitizeLocales('zh-Hans'));

      // Failures are never cached, so the warning is not deduplicated away —
      // deduplicating it would tie the diagnostic to whichever logger and
      // level happened to be installed on the first occurrence.
      sanitizeLocales('qqq-alpha');
      sanitizeLocales('qqq-alpha');
    } finally {
      restore();
    }

    expect(captured.warn.filter(({ message }) => message.includes('qqq-alpha'))).toHaveLength(2);
  });
  it('`sanitizeLocales` does not let a non-string input poison a string key', () => {
    const { restore } = captureLogs();

    try {
      // The array stringifies to 'de,fr'; caching it under that key would make
      // a later lookup of the literal string 'de,fr' return the array's result.
      const fromArray = sanitizeLocales(['de', 'fr'] as any);
      const fromString = sanitizeLocales('de,fr');

      expect(fromArray).toEqual(['de']);
      expect(fromString).toEqual(['de,fr']); // non-standard, lowercased as-is
    } finally {
      restore();
    }
  });
  it('`toDotNotation` keeps a literal `__proto__` key an own property', () => {
    // JSON.parse creates real own '__proto__' keys (object literals would not).
    const output: any = toDotNotation(JSON.parse('{"__proto__": {"polluted": "yes"}, "plain": "ok"}'));

    expect(({} as any).polluted).toBe(undefined); // Object.prototype untouched
    expect(output['__proto__.polluted']).toBe('yes');
    expect(output.plain).toBe('ok');
  });
  it('matches a `g`-flagged route pattern on every navigation', () => {
    // `test` advances `lastIndex` on a global/sticky pattern, so a route object
    // shared across navigations would match only every other time.
    const pattern = /\/shop/g;

    expect(testRoute('/shop')(pattern)).toBe(true);
    expect(testRoute('/shop/cart')(pattern)).toBe(true);
    expect(testRoute('/shop')(pattern)).toBe(true);
  });
  it('leaves a route pattern unmutated', () => {
    // The pattern belongs to the consumer's config; matching a route must not
    // write state into an object they may also use themselves.
    const pattern = /shop/g;

    testRoute('/shop/cart')(pattern);

    expect(pattern.lastIndex).toBe(0);
  });
  it('matches a frozen route pattern, including a stateful one', () => {
    // A deep-frozen config is legitimate: `lastIndex` is then read-only, so any
    // implementation that writes it throws, and the surrounding catch turns
    // that into a silent permanent non-match.
    expect(testRoute('/shop')(Object.freeze(/^\/shop/))).toBe(true);
    expect(testRoute('/other')(Object.freeze(/^\/shop/))).toBe(false);
    expect(testRoute('/shop/cart')(Object.freeze(/\/shop/g))).toBe(true);

    // Sticky still anchors at the start rather than degrading to a free match.
    expect(testRoute('/shop/cart')(Object.freeze(/\/shop/y))).toBe(true);
    expect(testRoute('/shop/cart')(Object.freeze(/cart/y))).toBe(false);
  });
  it('keeps matching a duck-typed route matcher', () => {
    // `Loader.Route` officially admits any object with a `test` method — the
    // matcher decides for itself.
    const matcher = { test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/shop/cart')(matcher)).toBe(true);
    expect(testRoute('/about')(matcher)).toBe(false);

    // Its own `test` decides even when it carries pattern-shaped properties:
    // copying it would produce `new RegExp(undefined)`, i.e. match everything.
    const flagged = { global: true, test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/about')(flagged)).toBe(false);
    expect(testRoute('/shop')({ sticky: true, source: 'nope', test: () => false })).toBe(false);

    // The route reaches a custom matcher unchanged, so it can tell an unset
    // route from the string 'undefined'.
    expect(testRoute(undefined as any)({ test: (route: any) => route === undefined })).toBe(true);
  });
  it('asks a callable route matcher for its `test` method', () => {
    // `Loader.Route` admits anything carrying `test`, and a function carries
    // properties like any other object — typing one as a matcher must not turn
    // it into a silent non-match.
    const matcher = Object.assign(() => true, { test: (route: string) => route.startsWith('/shop') });

    expect(testRoute('/shop/cart')(matcher)).toBe(true);
    expect(testRoute('/about')(matcher)).toBe(false);
  });
  it('reports a route that carries no `test` method', () => {
    const { captured, restore } = captureLogs();

    try {
      // A bare predicate is not a `Loader.Route` — it has to be reported, not
      // dropped without a trace.
      expect(testRoute('/contact')(((route: string) => route === '/contact') as any)).toBe(false);
    } finally {
      restore();
    }

    expect(captured.error.some(({ message }) => message.includes('Invalid route config!'))).toBe(true);
  });
  it('rejects a route that is not a pattern instead of coercing it', () => {
    const { captured, restore } = captureLogs();

    let matched: boolean | undefined;
    try {
      // Coercing this to a regex would yield /[object Object]/, which matches
      // any route containing one of those characters.
      matched = testRoute('/contact')({} as any);
    } finally {
      restore();
    }

    expect(matched).toBe(false);
    expect(captured.error.some(({ message }) => message.includes('Invalid route config!'))).toBe(true);
  });
  it('forwards the error a throwing route matcher raised', () => {
    const { captured, restore } = captureLogs();
    const boom = new Error('matcher boom');

    try {
      expect(testRoute('/contact')({ test: () => { throw boom; } })).toBe(false);
    } finally {
      restore();
    }

    // The context message alone cannot say WHICH matcher blew up or how — the
    // thrown value has to reach the consumer's logger unwrapped.
    const reported = captured.error.find(({ message }) => message.includes('Invalid route config!'));

    expect(reported?.error).toBe(boom);
  });
});
