import { describe, expect, it, vi } from 'vitest';
import i18n from '../../src/index.js';
import { logger, loggerFactory, setLogger } from '../../src/logger.js';
import { read, sanitizeLocales, testRoute, toDotNotation, translate } from '../../src/utils.js';
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
  it('does not throw when `t`/`l` are used before a config is loaded', () => {
    const instance = new i18n();

    expect(() => instance.t('common.key')).not.toThrow();
    expect(() => instance.l('en', 'common.key')).not.toThrow();
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

describe('utils', () => {
  // The library logs through one module-level singleton, so a test that
  // asserts on its output installs a capturing logger and restores the
  // previous one afterwards — restoring anything else would silently change
  // the level for every later test.
  const captureLogs = () => {
    const previous = logger;
    const captured = { error: [] as string[], warn: [] as string[] };

    setLogger(loggerFactory({
      level: 'warn',
      logger: {
        error: (value: any) => { captured.error.push(`${value}`); },
        warn: (value: any) => { captured.warn.push(`${value}`); },
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

    expect(captured.warn.filter((message) => message.includes('qqq-alpha'))).toHaveLength(2);
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
    // `Loader.Route` is typed `string | RegExp`, but this ships as JS, so
    // anything object-shaped is asked for `test` and consumers rely on it.
    const matcher = { test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/shop/cart')(matcher as any)).toBe(true);
    expect(testRoute('/about')(matcher as any)).toBe(false);

    // Its own `test` decides even when it carries pattern-shaped properties:
    // copying it would produce `new RegExp(undefined)`, i.e. match everything.
    const flagged = { global: true, test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/about')(flagged as any)).toBe(false);
    expect(testRoute('/shop')({ sticky: true, source: 'nope', test: () => false } as any)).toBe(false);

    // The route reaches a custom matcher unchanged, so it can tell an unset
    // route from the string 'undefined'.
    expect(testRoute(undefined as any)({ test: (route: any) => route === undefined } as any)).toBe(true);
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
    expect(captured.error.some((message) => message.includes('Invalid route config!'))).toBe(true);
  });
});
