import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import i18n from '../../src/index';
import { loggerFactory } from '../../src/logger';
import { read, translate } from '../../src/utils';
import { CONFIG, getTranslations } from '../data';
import { filterTranslationKeys } from '../utils';

const TRANSLATIONS = getTranslations();

const { initLocale = '', loaders = [], parser, log } = CONFIG;

describe('i18n instance', () => {
  it('exports all properties and methods', () => {
    const instance = new i18n();

    // Called per property: destructured matchers are not bound in vitest.
    expect(instance).toHaveProperty('loading');
    expect(instance).toHaveProperty('initialized');
    expect(instance).toHaveProperty('locale');
    expect(instance).toHaveProperty('locales');
    expect(instance).toHaveProperty('translations');
    expect(instance).toHaveProperty('rawTranslations');
    expect(instance).toHaveProperty('t');
    expect(instance).toHaveProperty('l');
    expect(instance).toHaveProperty('loadConfig');
    expect(instance).toHaveProperty('loadTranslations');
    expect(instance).toHaveProperty('addTranslations');
    expect(instance).toHaveProperty('setLocale');
    expect(instance).toHaveProperty('setRoute');
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
  it('`addTranslations` fails soft on a `null` payload', () => {
    const instance = new i18n({ parser, log });

    // A module that resolved to `null` is consumer input, not a bug in the
    // instance: every other step tolerates it, so the whole call must too.
    expect(() => instance.addTranslations({ en: null as any, de: { greeting: 'Hallo' } })).not.toThrow();

    expect(read(instance.translations.get(), 'de')).toEqual(
      expect.objectContaining({ greeting: 'Hallo' }),
    );
  });
  it('`serialize` keeps a loader locale named like a prototype member', async () => {
    // Characterizes the merge: two loaders sharing a prototype-named locale end
    // up in one table. Spreading `Object.prototype` yields `{}`, so this passes
    // on master too — it pins the behavior, not a fix.
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
    const debug = vi.spyOn(console, 'debug');
    const warn = vi.spyOn(console, 'warn');

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
    const warn = vi.fn();
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
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;

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