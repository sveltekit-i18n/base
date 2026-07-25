import { derived, get, writable } from 'svelte/store';
import { checkProps, fetchTranslations, hasOwn, read, sanitizeLocales, testRoute, toDotNotation, translate } from './utils';
import { logError, logger, loggerFactory, setLogger } from './logger';

import type { Config, Loader, Parser, Translations, LoadingStore, ExtendedStore, Logger } from './types';
import type { Readable, Writable } from 'svelte/store';

export type { Config, Loader, Parser, Translations, Logger };

const defaultCache = 1000 * 60 * 60 * 24;

export default class I18n<ParserParams extends Parser.Params = any> {
  constructor(config?: Config.T<ParserParams>) {
    this.loaderTrigger.subscribe(this.loader);

    // purge resolved promises
    this.isLoading.subscribe(($loading) => {
      if (!$loading || !this.promises.size) return;

      const tracked = Array.from(this.promises);

      // Every promise has to SETTLE before the set is cleared — `Promise.all`
      // rejects on the first failure, which would drop loads still in flight
      // and make a later `toPromise()` resolve before their data arrived.
      // A plain `.then` chain keeps this out of a discarded async subscriber.
      Promise.all(tracked.map(({ promise }) => promise.catch(() => {}))).then(() => {
        tracked.forEach((entry) => this.promises.delete(entry));

        logger.debug('Loader promises have been purged.');
      });
    });

    // `loadConfig` reports and marks its own failure, so a config load started
    // here — with no caller to reject to — is covered by the same path as a
    // consumer's fire-and-forget call.
    if (config) this.loadConfig(config);
  }

  private cachedAt = 0;

  // Null prototype: this cache is indexed by user-supplied locales, and a
  // plain object would resolve a '__proto__' assignment via the setter.
  private loadedKeys: Loader.IndexedKeys = Object.create(null);

  private currentRoute: Writable<string> = writable();

  private config: Writable<Config.T<ParserParams>> = writable();

  private isLoading: Writable<boolean> = writable(false);

  private promises: Set<{ locale?: Config.Locale; route?: Loader.Route; promise: Promise<void>; }> = new Set();

  loading: LoadingStore = {
    subscribe: this.isLoading.subscribe,
    toPromise: (locale, route) => {
      // A route or locale can be set before the config resolves, so this must
      // not assume one exists.
      const { fallbackLocale } = get(this.config) || {};

      const promises = Array.from(this.promises).filter(
        (promise) => {
          let output = checkProps({ locale: sanitizeLocales(locale)[0], route }, promise);
          if (fallbackLocale) output = output || checkProps({ locale: sanitizeLocales(fallbackLocale)[0], route }, promise);

          return output;
        },
      ).map(({ promise }) => promise);

      const output = Promise.all(promises);

      // `setLocale`/`setRoute`/`loadTranslations` return this and are routinely
      // called fire-and-forget. The underlying failure is already reported by
      // `loader`, so mark the aggregate handled; anyone awaiting it still gets
      // the rejection.
      output.catch(() => {});

      return output;
    },
    get: () => get(this.isLoading),
  };

  private privateRawTranslations: Writable<Translations.SerializedTranslations> = writable({});

  rawTranslations: ExtendedStore<Translations.SerializedTranslations> = { subscribe: this.privateRawTranslations.subscribe, get: () => get(this.rawTranslations) };

  private privateTranslations: Writable<Translations.SerializedTranslations> = writable({});

  translations: ExtendedStore<Translations.SerializedTranslations> = { subscribe: this.privateTranslations.subscribe, get: () => get(this.translations) };

  locales: ExtendedStore<Config.Locale[]> = {
    ...derived([this.config, this.privateTranslations], ([$config, $translations]) => {
      if (!$config) return [];

      const { loaders = [] } = $config;

      const loaderLocales = loaders.map(({ locale }) => locale);
      const translationLocales = Object.keys($translations).map((locale) => locale);

      return Array.from(new Set([
        ...sanitizeLocales(...loaderLocales),
        ...sanitizeLocales(...translationLocales),
      ]));
    }, []),
    get: () => get(this.locales),
  };

  private internalLocale: Writable<Config.Locale> = writable();

  private loaderTrigger = derived([this.internalLocale, this.currentRoute], ([$internalLocale, $currentRoute], set) => {
    if ($internalLocale !== undefined && $currentRoute !== undefined && !(
      $internalLocale === get(this.loaderTrigger)?.[0] && $currentRoute === get(this.loaderTrigger)?.[1]
    )) {
      logger.debug('Triggering translation load...');

      set([$internalLocale, $currentRoute]);
    }
  }, [] as string[]);

  private localeHelper = writable<Config.Locale>();

  locale: ExtendedStore<Config.Locale, () => Config.Locale, Writable<string>> & { forceSet: any } = {
    subscribe: this.localeHelper.subscribe,
    forceSet: this.localeHelper.set,
    set: this.internalLocale.set,
    update: this.internalLocale.update,
    get: () => get(this.locale),
  };

  initialized: Readable<boolean> = derived([this.locale, this.currentRoute, this.privateTranslations], ([$locale, $currentRoute, $translations], set) => {
    if (!get(this.initialized)) set($locale !== undefined && $currentRoute !== undefined && !!Object.keys($translations).length);
  });

  private translation: Readable<Record<string, string>> = derived([this.privateTranslations, this.locale, this.isLoading], ([$translations, $locale, $loading], set) => {
    const translation = read($translations, $locale);
    if (translation && Object.keys(translation).length && !$loading) set(translation);
  }, {});

  t: ExtendedStore<Translations.TranslationFunction<ParserParams>, Translations.TranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translation],
      ([{ parser, fallbackLocale, ...rest } = {} as Config.T<ParserParams>]): Translations.TranslationFunction<ParserParams> => (key, ...params) => translate<ParserParams>({
        parser,
        key,
        params,
        translations: this.translations.get(),
        locale: this.locale.get(),
        fallbackLocale,
        ...(hasOwn(rest, 'fallbackValue') ? { fallbackValue: rest.fallbackValue } : {}),
      }),
    ),
    get: (key, ...params) => get(this.t)(key, ...params),
  };

  l: ExtendedStore<Translations.LocalTranslationFunction<ParserParams>, Translations.LocalTranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translations],
      ([{ parser, fallbackLocale, ...rest } = {} as Config.T<ParserParams>, translations]): Translations.LocalTranslationFunction<ParserParams> => (locale, key, ...params) => translate<ParserParams>({
        parser,
        key,
        params,
        translations,
        locale,
        fallbackLocale,
        ...(hasOwn(rest, 'fallbackValue') ? { fallbackValue: rest.fallbackValue } : {}),
      }),
    ),
    get: (locale, key, ...params) => get(this.l)(locale, key, ...params),
  };

  private getLocale = (inputLocale?: string) => {
    const { fallbackLocale } = get(this.config) || {};

    let locale = inputLocale || fallbackLocale;

    if (!locale) return;

    const $locales = this.locales.get();

    const outputLocale = $locales.find((l) => sanitizeLocales(locale).includes(l)) || $locales.find((l) => sanitizeLocales(fallbackLocale).includes(l));

    return outputLocale;
  };

  setLocale = (locale?: string) => {
    if (!locale) return;

    if (locale !== get(this.internalLocale)) {
      logger.debug(`Setting '${locale}' locale.`);

      this.internalLocale.set(locale);

      return this.loading.toPromise(locale, get(this.currentRoute));
    }

    return;
  };

  setRoute = (route: string) => {
    if (route !== get(this.currentRoute)) {
      logger.debug(`Setting '${route}' route.`);
      this.currentRoute.set(route);
      const locale = get(this.internalLocale);

      return this.loading.toPromise(locale, route);
    }

    return;
  };

  async configLoader(config: Config.T<ParserParams>) {
    if (!config) return logger.error('No config provided!');

    let { initLocale, fallbackLocale, translations, log, ...rest } = config;

    if (log) setLogger(loggerFactory(log));

    [initLocale] = sanitizeLocales(initLocale);
    [fallbackLocale] = sanitizeLocales(fallbackLocale);

    logger.debug('Setting config.');

    this.config.set({
      initLocale,
      fallbackLocale,
      translations,
      ...rest,
    });

    if (translations) this.addTranslations(translations);
    if (initLocale) await this.loadTranslations(initLocale);
  }

  loadConfig = (config: Config.T<ParserParams>) => {
    const promise = this.configLoader(config);

    // Documented as a public method and routinely called fire-and-forget, so
    // the failure is reported and the promise marked handled here; anyone
    // awaiting it still receives the rejection. A synchronous failure in
    // `configLoader` never reaches the loader's own handler, so without this it
    // would leave a silently half-initialized instance.
    promise.catch((error) => logError('Failed to load the i18n config.', error));

    return promise;
  };

  getTranslationProps = async ($locale = this.locale.get(), $route = get(this.currentRoute)): Promise<[Translations.SerializedTranslations, Loader.IndexedKeys] | []> => {
    const $config = get(this.config);

    if (!$config || !$locale) return [];

    const $translations = this.translations.get();

    const { loaders, fallbackLocale = '', cache = defaultCache } = $config || {};

    const cacheValue = Number.isNaN(+cache) ? defaultCache : +cache;

    if (!this.cachedAt) {
      logger.debug('Setting cache timestamp.');
      this.cachedAt = Date.now();
    } else if (Date.now() > cacheValue + this.cachedAt) {
      logger.debug('Refreshing cache.');
      this.loadedKeys = Object.create(null);
      this.cachedAt = 0;
    }

    const [sanitizedLocale, sanitizedFallbackLocale] = sanitizeLocales($locale, fallbackLocale);

    const translationForLocale = read($translations, sanitizedLocale);
    const translationForFallbackLocale = read($translations, sanitizedFallbackLocale);

    const filteredLoaders = (loaders || [])
      .map(({ locale, ...rest }) => ({ ...rest, locale: sanitizeLocales(locale)[0] }))
      .filter(({ routes }) => !routes || (routes || []).some(testRoute($route)))
      .filter(({ key, locale }) => locale === sanitizedLocale && (
        !translationForLocale || !(read(this.loadedKeys, sanitizedLocale) || []).includes(key)
      ) || (
        fallbackLocale && locale === sanitizedFallbackLocale && (
          !translationForFallbackLocale ||
          !(read(this.loadedKeys, sanitizedFallbackLocale) || []).includes(key)
        )),
      );

    if (filteredLoaders.length) {
      this.isLoading.set(true);

      logger.debug('Fetching translations...');

      let rawTranslations: Translations.SerializedTranslations;
      try {
        rawTranslations = await fetchTranslations(filteredLoaders);
      } finally {
        // Always release the flag, even if fetching throws, so the instance
        // never gets stuck in a permanent loading state.
        this.isLoading.set(false);
      }

      const loadedKeys = Object.entries(rawTranslations).reduce(
        (acc, [locale, data]) => ({ ...acc, [locale]: Object.keys(data) }), {} as Loader.IndexedKeys,
      );

      const keys = filteredLoaders
        .filter(({ key, locale }) => (read<Loader.Key[]>(loadedKeys, locale) || []).some(
          (loadedKey) => `${loadedKey}`.startsWith(key),
        ))
        .reduce<Record<string, any>>((acc, { key, locale }) => ({
        ...acc,
        [locale]: [...(read<Loader.Key[]>(acc, locale) || []), key],
      }), {});

      return [rawTranslations, keys];
    }
    return [];
  };

  addTranslations = (translations?: Translations.SerializedTranslations, keys?: Loader.IndexedKeys) => {
    if (!translations) return;

    const $config = get(this.config);

    const { preprocess } = $config || {};

    logger.debug('Adding translations...');

    const translationLocales = Object.keys(translations || {});

    this.privateRawTranslations.update(($rawTranslations) => translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: {
          ...(read(acc, locale) || {}),
          ...read(translations, locale),
        },
      }),
      $rawTranslations,
    ));

    this.privateTranslations.update(($translations) => translationLocales.reduce(
      (acc, locale) => {
        let dotnotate = true;
        let input = read(translations, locale);

        if (typeof preprocess === 'function') {
          input = preprocess(input);
        }

        if (typeof preprocess === 'function' || preprocess === 'none') {
          dotnotate = false;
        }

        return ({
          ...acc,
          [locale]: {
            ...(read(acc, locale) || {}),
            ...dotnotate ? toDotNotation(input, preprocess === 'preserveArrays') : input,
          },
        });
      },
      $translations,
    ));

    translationLocales.forEach(($locale) => {
      // A `null` payload for a locale must not take the whole call down: every
      // step above tolerates it, so this bookkeeping read does too.
      let localeKeys: Loader.Key[] | undefined = Object.keys(read(translations, $locale) || {}).map((k) => `${k}`.split('.')[0]);
      if (keys) localeKeys = read(keys, $locale);

      this.loadedKeys[$locale] = Array.from(new Set([
        ...(read(this.loadedKeys, $locale) || []),
        ...(localeKeys || []),
      ]));
    });
  };

  // Not `async`: `subscribe` discards whatever the subscriber returns, so
  // anything thrown outside `promise` — `getLocale`, a custom logger — would
  // reject a promise nobody can reach.
  private loader = ([inputLocale, route]: string[]) => {
    let locale: Config.Locale | undefined;

    const promise = (async () => {
      try {
        locale = this.getLocale(inputLocale) || undefined;
      } catch (error) {
        // Runs before the first `await`, so this still lands before the entry
        // is recorded below. `loading.toPromise` matches on the sanitized
        // locale, so filing the failure under the raw input would filter the
        // rejection out and report success to the caller.
        [locale] = sanitizeLocales(inputLocale);

        throw error;
      }

      logger.debug(`Adding loader promise for '${locale}' locale and '${route}' route.`);

      const props = await this.getTranslationProps(locale, route);

      if (props.length) this.addTranslations(...props);

      if (locale && this.locale.get() !== locale) this.locale.forceSet(locale);
    })();

    // Marks the promise handled so a load nobody awaits cannot terminate the
    // process, without swallowing it: callers awaiting `loadTranslations` or
    // `loading.toPromise()` still receive the rejection.
    promise.catch((error) => logError(`Failed to load translations for '${locale}' locale and '${route}' route.`, error));

    // `locale` is assigned before the first `await` above, so it is already
    // resolved here and the entry stays filterable by `loading.toPromise`.
    this.promises.add({
      locale,
      route,
      promise,
    });
  };

  loadTranslations = (locale: Config.Locale, route = get(this.currentRoute) || '') => {
    let normalizedLocale: Config.Locale | undefined;

    try {
      normalizedLocale = this.getLocale(locale);
    } catch (error) {
      // Resolving the locale reads consumer config, so it can throw. This is
      // the primary public entry point: the failure has to arrive the same way
      // a failed load does, as a reported rejection rather than a synchronous
      // throw the caller cannot attach a handler to.
      logError(`Failed to load translations for '${locale}' locale and '${route}' route.`, error);

      const failed = Promise.reject(error);
      failed.catch(() => {});

      return failed;
    }

    if (!normalizedLocale) return;

    this.setRoute(route);
    this.setLocale(normalizedLocale);

    return this.loading.toPromise(normalizedLocale, route);
  };
}