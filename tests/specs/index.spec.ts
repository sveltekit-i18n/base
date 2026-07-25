import { get } from 'svelte/store';
import i18n from '../../src/index';
import { logger, loggerFactory, setLogger } from '../../src/logger';
import { read, testRoute, translate } from '../../src/utils';
import { CONFIG, getTranslations } from '../data';
import { filterTranslationKeys } from '../utils';

const TRANSLATIONS = getTranslations();

const { initLocale = '', loaders = [], parser, log } = CONFIG;

// The library logs through one module-level singleton, so a test that asserts
// on its output has to install a capturing logger. Doing it through this helper
// keeps install and restore symmetric — restoring anything else (a fresh
// factory, CONFIG's level) silently changes the level for every later test.
const withLogger = (level: 'error' | 'warn' | 'debug', impl: any) => {
  const previous = logger;

  setLogger(loggerFactory({ level, logger: impl }));

  return () => setLogger(previous);
};

// Waits for an observable condition instead of a fixed delay: a load settling
// is not a wall-clock event, and a budget generous enough for a loaded CI
// runner would make the fixed-delay form pointlessly slow everywhere else. The
// deadline stays under jest's own test timeout so a genuine failure reports
// this message rather than jest's.
const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

const until = async (condition: () => boolean, timeout = 2000) => {
  const deadline = Date.now() + timeout;

  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected state.');

    // eslint-disable-next-line no-await-in-loop -- polling is the point
    await delay(1);
  }
};

const captureLogs = (level: 'error' | 'warn' | 'debug') => {
  const captured = { error: [] as string[], warn: [] as string[], debug: [] as string[] };

  const restore = withLogger(level, {
    error: (value: any) => captured.error.push(`${value}`),
    warn: (value: any) => captured.warn.push(`${value}`),
    debug: (value: any) => captured.debug.push(`${value}`),
  });

  return { captured, restore };
};

describe('i18n instance', () => {
  it('exports all properties and methods', () => {
    const instance = new i18n();

    const { toHaveProperty } = expect(instance);

    toHaveProperty('loading');
    toHaveProperty('initialized');
    toHaveProperty('locale');
    toHaveProperty('locales');
    toHaveProperty('translations');
    toHaveProperty('rawTranslations');
    toHaveProperty('t');
    toHaveProperty('l');
    toHaveProperty('loadConfig');
    toHaveProperty('loadTranslations');
    toHaveProperty('addTranslations');
    toHaveProperty('setLocale');
    toHaveProperty('setRoute');
  });
  it('`setRoute` method does not trigger loading if locale is not set', async () => {
    const { initialized, setRoute, loading, locale } = new i18n({ loaders, parser, log });

    setRoute('/');
    const $initialized = get(initialized);
    const $loading = loading.get();
    const $locale = locale.get();

    expect($locale).toBe(undefined);
    expect($initialized).toBe(false);
    expect($loading).toBe(false);
  });
  it('`setRoute` method does trigger loading if locale is set', async () => {
    const { initialized, setRoute, setLocale, loading } = new i18n({ loaders, parser, log });

    await setLocale(initLocale);
    setRoute('/');
    const $loading = loading.get();
    expect($loading).toBe(true);

    let $initialized = get(initialized);
    expect($initialized).toBe(false);

    await loading.toPromise();

    $initialized = get(initialized);
    expect($initialized).toBe(true);
  });
  it('`setLocale` method does not trigger loading when route is not set', async () => {
    const { setLocale, loading, translations } = new i18n({ loaders, parser, log });

    setLocale(initLocale);

    const $loading = loading.get();
    expect($loading).toBe(false);

    await loading.toPromise();

    const $translations = translations.get();
    expect(Object.keys($translations).length).toBe(0);
  });
  it('`setLocale` method triggers loading when route is set', async () => {
    const { setLocale, setRoute, loading, translations } = new i18n({ loaders, parser, log });

    await setRoute('');
    setLocale(initLocale);

    const $loading = loading.get();
    expect($loading).toBe(true);

    await loading.toPromise();

    const $translations = translations.get();
    expect(Object.keys($translations).length).toBeGreaterThan(0);
  });
  it('`setLocale` does not set `unknown` locale', async () => {
    const { setLocale, loading, locale } = new i18n({ loaders, parser, log });

    setLocale('unknown');

    const $loading = loading.get();
    const $locale = locale.get();

    expect($loading).toBe(false);
    expect($locale).toBe(undefined);
  });
  it('setting `locale` does not initialize `translations` if route is not set', async () => {
    const { loading, locale, initialized } = new i18n({ loaders, parser, log });

    locale.set(initLocale);

    const $loading = loading.get();
    expect($loading).toBe(false);

    await loading.toPromise();

    const $initialized = get(initialized);
    expect($initialized).toBe(false);

  });
  it('setting `locale` initializes `translations` if route is set', async () => {
    const { loading, locale, setRoute, initialized } = new i18n({ loaders, parser, log });
    await setRoute('');
    locale.set(initLocale);

    const $loading = loading.get();
    expect($loading).toBe(true);

    await loading.toPromise();

    const $initialized = get(initialized);
    expect($initialized).toBe(true);

  });
  it('`locale` can be set case-insensitive', async () => {
    const { loading, locale, setRoute, initialized } = new i18n({ loaders, parser, log });
    await setRoute('');
    locale.set(initLocale.toUpperCase());

    const $loading = loading.get();
    expect($loading).toBe(true);

    await loading.toPromise();

    const $initialized = get(initialized);
    expect($initialized).toBe(true);

    const $locale = locale.get();
    expect($locale).toBe(initLocale.toLocaleLowerCase());
  });
  it('`locale` can be non-standard', async () => {
    const nonStandardLocale = 'ku';
    const { loading, locale, locales, setRoute, initialized, translations } = new i18n({ loaders: [{ key: 'common', locale: `${nonStandardLocale}`.toUpperCase(), loader: async () => (await import(`../data/translations/${nonStandardLocale}/common.json`)).default }], parser, log });
    await setRoute('');
    locale.set(nonStandardLocale);

    const $loading = loading.get();
    expect($loading).toBe(true);

    await loading.toPromise();

    const $initialized = get(initialized);
    expect($initialized).toBe(true);

    const $locale = locale.get();
    expect($locale).toBe(nonStandardLocale);

    const $locales = locales.get();
    expect($locales).toContainEqual(nonStandardLocale);

    const $translations = translations.get();
    expect($translations[nonStandardLocale]).toEqual(
      expect.objectContaining(filterTranslationKeys(TRANSLATIONS[nonStandardLocale], ['common'])),
    );
  });
  it('`getTranslationProps` method works', async () => {
    const { initialized, getTranslationProps } = new i18n({ loaders, parser, log });

    const [translations = {}] = await getTranslationProps(initLocale);
    const $initialized = get(initialized);

    const keys = loaders.filter(({ routes }) => !routes).map(({ key }) => key);

    expect(translations[initLocale]).toEqual(
      expect.objectContaining(filterTranslationKeys(getTranslations('none')[initLocale], keys)),
    );

    expect($initialized).toBe(false);
  });
  it('`addTranslations` method adds raw translations', async () => {
    const { addTranslations, rawTranslations } = new i18n();

    const translations = getTranslations('none');

    addTranslations(translations);

    const $rawTranslations = rawTranslations.get();

    expect($rawTranslations).toStrictEqual(translations);
  });
  it('`addTranslations` method adds preprocessed translations', async () => {
    const { addTranslations, translations } = new i18n();

    addTranslations(getTranslations('none'));

    const $translations = translations.get();

    expect($translations).toStrictEqual(TRANSLATIONS);
  });
  it('`addTranslations` prevents duplicit load', async () => {
    const { addTranslations, loadTranslations, loading } = new i18n({ loaders, parser, log });

    addTranslations(TRANSLATIONS);
    loadTranslations(initLocale);

    expect(loading.get()).toBe(false);
  });
  it('`preprocess` works when set to `full`', async () => {
    const { loadTranslations, translations } = new i18n({ loaders, parser, log, preprocess: 'full' });

    await loadTranslations(initLocale);

    const $translations = translations.get();

    expect($translations[initLocale]['common.preprocess.0.test.array']).toBe('passed');
  });
  it('`preprocess` works when set to `preserveArrays`', async () => {
    const { loadTranslations, translations } = new i18n({ loaders, parser, log, preprocess: 'preserveArrays' });

    await loadTranslations(initLocale);

    const $translations = translations.get();

    expect($translations[initLocale]['common.preprocess']).toStrictEqual([
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
    const { loadTranslations, translations, rawTranslations } = new i18n({ loaders, parser, log, preprocess: 'none' });

    await loadTranslations(initLocale);

    const $translations = translations.get();
    const $rawTranslations = rawTranslations.get();

    expect($translations).toStrictEqual($rawTranslations);
    expect($translations[initLocale].common.preprocess[0].test.array).toBe('passed');
  });
  it('initializes properly with `initLocale`', async () => {
    const { initialized, loadConfig } = new i18n();

    await loadConfig(CONFIG);
    const $initialized = get(initialized);

    expect($initialized).toBe(true);
  });
  it('does not initialize without `initLocale`', async () => {
    const { initialized, loadConfig } = new i18n();

    await loadConfig({ loaders, parser, log });
    const $initialized = get(initialized);

    expect($initialized).toBe(false);
  });
  it('`loading` works correctly', async () => {
    const { loading, loadConfig } = new i18n();

    const testArray = [false, true, false];
    const outputArray: boolean[] = [];

    loading.subscribe(($loading) => {
      outputArray.push($loading);
    });

    await loadConfig(CONFIG).then(() => expect(loading.get()).toBe(false));

    testArray.forEach((value, index) => {
      expect(value).toBe(testArray[index]);
    });
  });
  it('includes `locales` after config load', async () => {
    const { locales, loadConfig } = new i18n();

    await loadConfig(CONFIG);
    const $locales = locales.get();

    expect($locales).toContain(initLocale);
  });
  it('includes current `locale` value', async () => {
    const { locale, loadConfig } = new i18n();

    await loadConfig(CONFIG);
    const $locale = locale.get();

    expect($locale).toBe(initLocale);
  });
  it('includes `translations` for `initLocale` only after config load', async () => {
    const { translations, locales, loadConfig } = new i18n();

    await loadConfig(CONFIG);
    const $translations = translations.get();
    const $locales = locales.get();

    const keys = (loaders || []).filter(({ routes }) => !routes).map(({ key }) => key);

    $locales.forEach((locale) => {
      expect($translations[locale]).toEqual(
        (locale === initLocale) ? expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys)) : expect.not.objectContaining(TRANSLATIONS[locale]),
      );
    });
  });
  it('includes both `translations` when using `fallbackLocale`', async () => {
    const { translations, locales, loadConfig } = new i18n();
    const fallbackLocale = loaders.find(({ locale }) => locale.toLowerCase() !== initLocale?.toLowerCase())?.locale;

    await loadConfig({ ...CONFIG, fallbackLocale });
    const $translations = translations.get();
    const $locales = locales.get();

    const keys = (loaders || []).filter(({ routes }) => !routes).map(({ key }) => key);

    $locales.forEach((locale) => {
      expect($translations[locale]).toEqual(
        expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys)),
      );
    });
  });
  it('`fallbackLocale` is used instead of unknown locale.', async () => {
    const fallbackLocale = loaders.find(({ locale }) => locale.toLowerCase() !== initLocale?.toLowerCase())?.locale;

    const { locale, loadTranslations } = new i18n({ loaders, parser, fallbackLocale });

    await loadTranslations('de', '');

    const $locale = locale.get();

    expect($locale).toBe(fallbackLocale);
  });
  it('includes `translations` only for loaders without routes', async () => {
    const { translations, loadConfig } = new i18n();

    await loadConfig(CONFIG);
    const $translations = translations.get();

    const keys = (loaders || []).filter(({ routes }) => !!routes).map(({ key }) => key);

    expect($translations[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );
  });
  it('`loadTranslations` method works without route', async () => {
    const { initialized, loadConfig, loadTranslations } = new i18n();

    await loadConfig({ loaders, parser, log });
    expect(get(initialized)).toBe(false);

    await loadTranslations(initLocale);
    expect(get(initialized)).toBe(true);
  });
  it('`loadTranslations` method works for given routes only', async () => {
    const { loadTranslations, translations } = new i18n({ loaders, parser, log });
    const url = '/path#hash?a=b&c=d';
    const keys = (loaders || []).filter(({ routes }) => routes?.includes(url)).map(({ key }) => key);

    await loadTranslations(initLocale, '/');
    expect(translations.get()[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );

    await loadTranslations(initLocale, url);
    expect(translations.get()[initLocale]).toEqual(
      expect.objectContaining(TRANSLATIONS[initLocale]),
    );
  });
  it('`fallbackValue` works with `string` value', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const { loading, t } = new i18n({
      ...CONFIG,
      fallbackValue,
    });

    await loading.toPromise();

    const $t = t.get;

    expect($t('unknown.key')).toBe(fallbackValue);
  });
  it('`fallbackValue` works with `undefined` value', async () => {
    const fallbackValue = undefined;

    const { loading, t } = new i18n({
      ...CONFIG,
      fallbackValue,
    });

    await loading.toPromise();

    const $t = t.get;

    expect($t('unknown.key')).toBe(fallbackValue);
  });
  it('returns translation key when `fallbackValue` is not present', async () => {
    const { loading, t } = new i18n(CONFIG);

    await loading.toPromise();

    const $t = t.get;
    const key = 'unknown.key';

    expect($t(key)).toBe(key);
  });
  it('treats `Object.prototype` keys as missing translations', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const { loading, t } = new i18n({
      ...CONFIG,
      fallbackValue,
    });

    await loading.toPromise();

    const $t = t.get;

    // These keys exist on `Object.prototype`; they must not leak as translations.
    ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'].forEach((key) => {
      expect($t(key)).toBe(fallbackValue);
    });
  });
  it('handles a locale named like an `Object.prototype` member', async () => {
    // A loader locale colliding with a prototype member must not throw when the
    // `loadedKeys` cache is indexed by it, must keep its data, and must still
    // be deduped by that cache.
    let calls = 0;
    const instance = new i18n({
      ...CONFIG,
      loaders: [
        {
          key: 'common',
          locale: '__proto__',
          loader: async () => { calls += 1; return { greeting: 'Hi' }; },
        },
      ],
    });

    await expect(instance.loadTranslations('__proto__')).resolves.not.toThrow();

    expect(read(instance.translations.get(), '__proto__')).toEqual(
      expect.objectContaining({ 'common.greeting': 'Hi' }),
    );

    // The dedupe cache must hold an OWN entry for the locale — on a plain
    // object the write would go through the `__proto__` setter instead, and
    // the loader would refire on every route change.
    await instance.loadTranslations('__proto__', '/second');
    expect(calls).toBe(1);
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
    // implementation that writes it — directly or through `String.search` —
    // throws, and the surrounding catch turns that into a silent permanent
    // non-match.
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
    const { captured, restore } = captureLogs('error');

    let matched: boolean | undefined;
    try {
      // Coercing this to a regex yields /[object Object]/, which matches any
      // route containing one of those characters.
      matched = testRoute('/contact')({} as any);
    } finally {
      restore();
    }

    expect(matched).toBe(false);
    expect(captured.error.some((message) => message.includes('Invalid route config!'))).toBe(true);
  });
  it('does not report a config error when no route is set yet', async () => {
    // `getTranslationProps` runs with `$route === undefined` before the first
    // navigation; that is not a broken config.
    const { captured, restore } = captureLogs('error');

    try {
      const instance = new i18n({ parser, loaders });

      await instance.getTranslationProps(initLocale);
    } finally {
      restore();
    }

    expect(captured.error.filter((message) => message.includes('Invalid route config!'))).toEqual([]);
  });
  it('`addTranslations` fails soft on a `null` payload', () => {
    const instance = new i18n({ parser, log });

    // A module that resolved to `null` is consumer input, not a bug in the
    // instance: every other step tolerates it, so the whole call must too.
    expect(() => instance.addTranslations({ en: null as any, de: { greeting: 'Hallo' } })).not.toThrow();

    expect(read(instance.translations.get(), 'de')).toEqual(
      expect.objectContaining({ greeting: 'Hallo' }),
    );
  });
  it('reports a failed load to the caller instead of crashing the process', async () => {
    // Errors raised after the fetch (a throwing `preprocess` here) must reach
    // whoever awaits the load, rather than being swallowed or surfacing as an
    // unhandled rejection from a promise nobody can reach.
    const instance = new i18n({
      ...CONFIG,
      preprocess: () => { throw new Error('preprocess boom'); },
      loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await expect(instance.loadTranslations('en', '/')).rejects.toThrow('preprocess boom');
  });
  it('reports a discarded failing load instead of crashing the process', async () => {
    // A rejection that escapes fails this test through jest's own handler, so
    // the run itself pins the contract; these assertions pin that the failure
    // is still reported rather than silently swallowed.
    const { captured, restore } = captureLogs('error');

    try {
      const instance = new i18n({
        parser,
        preprocess: () => { throw new Error('preprocess boom'); },
        loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
      });

      instance.setRoute('/');
      instance.setLocale('en');
      instance.loadTranslations('en', '/second');

      await until(() => captured.error.some((message) => message.includes('preprocess boom')));
    } finally {
      restore();
    }

    expect(captured.error.some((message) => message.includes('preprocess boom'))).toBe(true);
  });
  it('reports a failure raised before the load starts', async () => {
    // The loader runs as a store subscriber, whose returned promise svelte
    // discards. A throw in its synchronous prologue has to reach the caller
    // through the same path as a failed fetch, filed under the requested
    // locale so `toPromise` does not filter the rejection out.
    const brokenLoader: any = { key: 'common', loader: async () => ({ greeting: 'Hi' }) };
    Object.defineProperty(brokenLoader, 'locale', {
      enumerable: true,
      get: () => { throw new Error('locale getter boom'); },
    });

    const { captured, restore } = captureLogs('error');

    try {
      const instance = new i18n({ parser, loaders: [brokenLoader] });

      instance.setRoute('/');

      await expect(instance.setLocale('en')).rejects.toThrow('locale getter boom');
    } finally {
      restore();
    }

    expect(captured.error.some((message) => message.includes('locale getter boom'))).toBe(true);
  });
  it('delivers a finished load while another one is still in flight', async () => {
    // Characterizes delivery across overlapping loads: the fast route's data
    // reaches `t` subscribers while the slow one is still fetching.
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => { release = resolve; });

    const instance = new i18n({
      // Returns the text, unlike the suite's key-returning test parser, so the
      // assertion below distinguishes "delivered" from "still missing".
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log,
      loaders: [
        { key: 'slow', locale: 'en', routes: [/^\/y/], loader: async () => { await gate; return { b: '2' }; } },
        { key: 'fast', locale: 'en', routes: [/^\/x/], loader: async () => ({ a: '1' }) },
      ],
    });

    const seen: string[] = [];
    instance.t.subscribe(($t) => seen.push($t('fast.a')));

    instance.setLocale('en');
    instance.setRoute('/y');
    await instance.setRoute('/x');

    expect(seen[seen.length - 1]).toBe('1');

    release({});
    await instance.loading.toPromise();
  });
  it('reports a failing locale lookup from `loadTranslations` as a rejection', async () => {
    // The primary public entry point resolves the locale before any promise
    // exists, so a throw there would reach the caller synchronously — before
    // they could attach the `.catch` the docs tell them to use.
    const brokenLoader: any = { key: 'common', loader: async () => ({ greeting: 'Hi' }) };
    Object.defineProperty(brokenLoader, 'locale', {
      enumerable: true,
      get: () => { throw new Error('locale getter boom'); },
    });

    const { captured, restore } = captureLogs('error');

    try {
      const instance = new i18n({ parser, loaders: [brokenLoader] });

      await expect(instance.loadTranslations('en', '/')).rejects.toThrow('locale getter boom');
    } finally {
      restore();
    }

    expect(captured.error.some((message) => message.includes('locale getter boom'))).toBe(true);
  });
  it('survives a logger it cannot even call', async () => {
    // `log.logger` is consumer input: reading the level off it can throw just
    // as calling it can.
    const restore = withLogger('debug', null);

    try {
      const instance = new i18n({
        parser,
        loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
      });

      instance.setRoute('/');

      await expect(instance.setLocale('en')).resolves.not.toThrow();
    } finally {
      restore();
    }
  });
  it('reports a prologue failure under a non-canonical locale', async () => {
    // `toPromise` matches on the sanitized locale, so an entry filed under the
    // raw input would be filtered out and the caller would see a success.
    const brokenLoader: any = { key: 'common', loader: async () => ({ greeting: 'Hi' }) };
    Object.defineProperty(brokenLoader, 'locale', {
      enumerable: true,
      get: () => { throw new Error('locale getter boom'); },
    });

    const instance = new i18n({ parser, loaders: [brokenLoader] });

    instance.setRoute('/');

    await expect(instance.setLocale('EN')).rejects.toThrow('locale getter boom');
  });
  it('reports a config load that fails before any loader runs', async () => {
    // `loadConfig` from the constructor has no caller to reject to. A failure
    // in its synchronous section never reaches the loader's handler, so the
    // instance would otherwise end up silently half-initialized.
    const { captured, restore } = captureLogs('error');

    try {
      // eslint-disable-next-line no-new -- constructing is what is under test
      new i18n({
        parser,
        preprocess: () => { throw new Error('config boom'); },
        translations: { en: { greeting: 'Hi' } },
      });

      await until(() => captured.error.some((message) => message.includes('config boom')));
    } finally {
      restore();
    }

    expect(captured.error.some((message) => message.includes('config boom'))).toBe(true);
  });
  it('survives a logger that throws on every level', async () => {
    // A consumer's logger is arbitrary code called from promise handlers that
    // nothing awaits; a throw there must not escape as an unhandled rejection.
    const throwing = () => { throw new Error('logger boom'); };
    const restore = withLogger('debug', { error: throwing, warn: throwing, debug: throwing });

    try {
      const instance = new i18n({
        parser,
        preprocess: () => { throw new Error('preprocess boom'); },
        loaders: [{ key: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
      });

      instance.setRoute('/');

      // The caller still receives the load's own failure — a throwing logger
      // must not replace it, nor escape as an unhandled rejection.
      await expect(instance.setLocale('en')).rejects.toThrow('preprocess boom');
    } finally {
      restore();
    }
  });
  it('does not throw when a route is set before a config is loaded', () => {
    const instance = new i18n();

    // A route can be set while an async `loadConfig` is still pending.
    expect(() => instance.setRoute('/')).not.toThrow();
    expect(() => instance.loading.toPromise()).not.toThrow();
  });
  it('purges settled loads without dropping one that started later', async () => {
    let releaseB: (value: unknown) => void = () => {};
    let releaseC: (value: unknown) => void = () => {};
    const gateB = new Promise((resolve) => { releaseB = resolve; });
    const gateC = new Promise((resolve) => { releaseC = resolve; });

    const instance = new i18n({
      parser,
      log,
      loaders: [
        { key: 'a', locale: 'en', routes: [/^\/a/], loader: async () => ({ a: '1' }) },
        { key: 'b', locale: 'en', routes: [/^\/b/], loader: async () => { await gateB; return { b: '2' }; } },
        { key: 'c', locale: 'en', routes: [/^\/c/], loader: async () => { await gateC; return { c: '3' }; } },
      ],
    });

    instance.setLocale('en');

    // Settles, so the loading flag drops — the next load's rising edge is what
    // runs the purge.
    await instance.setRoute('/a');
    expect(instance.loading.get()).toBe(false);

    instance.setRoute('/b');

    // The purge snapshots the tracked promises when the flag rises, and the
    // flag rises a microtask after the route is set.
    await until(() => instance.loading.get() === true);

    // `loader` records its entry synchronously, so this one is added after the
    // snapshot the purge is waiting on.
    instance.setRoute('/c');

    let resolvedEarly = false;
    instance.loading.toPromise().then(() => { resolvedEarly = true; }, () => {});

    releaseB({});

    // B's data landing means B settled, so the purge's own wait is over and it
    // has deleted everything it snapshotted.
    await until(() => !!read<any>(instance.translations.get(), 'en')?.['b.b']);

    // Purging must remove only what it waited for. Clearing the whole set would
    // drop the still-running load, and `toPromise()` would report success while
    // its data is missing.
    expect(resolvedEarly).toBe(false);

    releaseC({});
    await instance.loading.toPromise();

    expect(read(instance.translations.get(), 'en')).toEqual(
      expect.objectContaining({ 'c.c': '3' }),
    );
  });
  it('`serialize` keeps a loader locale named like a prototype member', async () => {
    // Characterizes the merge: two loaders sharing a prototype-named locale end
    // up in one table. Spreading `Object.prototype` yields `{}` either way, so
    // this pins the behavior rather than guarding a defect.
    const instance = new i18n({
      ...CONFIG,
      loaders: [
        { key: 'a', locale: '__proto__', loader: async () => ({ one: '1' }) },
        { key: 'b', locale: '__proto__', loader: async () => ({ two: '2' }) },
      ],
    });

    await instance.loadTranslations('__proto__');

    expect(read(instance.translations.get(), '__proto__')).toEqual(
      expect.objectContaining({ 'a.one': '1', 'b.two': '2' }),
    );
  });
  it('logger works as expected', async () => {
    const debug = import.meta.jest.spyOn(console, 'debug');
    const warn = import.meta.jest.spyOn(console, 'warn');

    const { loading } = new i18n({
      ...CONFIG,
      initLocale: 'unknown',
      log: {
        level: 'debug',
        logger: console,
        prefix: '[PREFIX] ',
      },
    });

    await loading.toPromise();

    expect(debug).toHaveBeenCalledWith('[PREFIX] Setting config.');
    expect(warn).toHaveBeenCalledWith("[PREFIX] 'unknown' locale is non-standard.");
  });
  it('keeps successful translations when one loader throws', async () => {
    const { loading, t } = new i18n({
      ...CONFIG,
      loaders: [
        {
          key: 'common',
          locale: 'en',
          loader: async () => ({ greeting: 'Hello' }),
        },
        {
          key: 'broken',
          locale: 'en',
          loader: async () => { throw new Error('loader boom'); },
        },
      ],
    });

    await loading.toPromise();

    // The failing loader must not wipe the whole batch.
    expect(t.get('common.greeting')).toBe('common.greeting');
  });
  it('does not throw when `t`/`l` are used before a config is loaded', () => {
    const { t, l } = new i18n();

    expect(() => t.get('any.key')).not.toThrow();
    expect(() => l.get('en', 'any.key')).not.toThrow();
  });
  it('skips silently when a custom logger omits a level', () => {
    // Custom logger implementing only `warn` – an unimplemented level must be
    // skipped silently rather than throwing a TypeError.
    const warn = import.meta.jest.fn();
    const partialLogger = { warn } as any;

    const log = loggerFactory({ level: 'debug', logger: partialLogger });

    expect(() => log.debug('nope')).not.toThrow();
    expect(() => log.error('nope')).not.toThrow();
    log.warn('yep');
    expect(warn).toHaveBeenCalledWith('[i18n]: yep'); // implemented levels still work
  });
  it('returns the key when no parser is configured and the translation is missing', () => {
    const base = { params: [] as any[], locale: 'en', translations: { en: { hi: 'Hello' } } };

    // No parser: a missing key must still fall back to the key, not undefined.
    expect(translate({ ...base, parser: undefined as any, key: 'missing' })).toBe('missing');
    // Existing translations are returned verbatim (no parser to interpolate).
    expect(translate({ ...base, parser: undefined as any, key: 'hi' })).toBe('Hello');
    // A configured fallbackValue still wins over the key.
    expect(translate({ ...base, parser: undefined as any, key: 'missing', fallbackValue: 'FB' })).toBe('FB');
  });
  it('falls back to `warn` level for an unknown configured level', () => {
    const logger = { error: import.meta.jest.fn(), warn: import.meta.jest.fn(), debug: import.meta.jest.fn() } as any;

    // An invalid level must not silence everything; it behaves as the default 'warn'.
    const log = loggerFactory({ level: 'info' as any, logger });

    log.error('e');
    log.warn('w');
    log.debug('d');

    expect(logger.error).toHaveBeenCalledWith('[i18n]: e');
    expect(logger.warn).toHaveBeenCalledWith('[i18n]: w');
    expect(logger.debug).not.toHaveBeenCalled(); // debug is below 'warn'
  });
});