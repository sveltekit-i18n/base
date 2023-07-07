import { derived, get, writable } from 'svelte/store';
import { checkProps, fetchTranslations, sanitizeLocales, testRoute, toDotNotation, translate } from './utils';
import { logger, loggerFactory, setLogger } from './logger';

import type { Config, Loader, Parser, Translations, LoadingStore, ExtendedStore, Logger } from './types';
import type { Readable, Writable } from 'svelte/store';

export type { Config, Loader, Parser, Translations, Logger };

const defaultCache = 1000 * 60 * 60 * 24;

export default class I18n<ParserParams extends Parser.Params = any> {
  constructor(config?: Config.T<ParserParams>) {
    this.loaderTrigger.subscribe(this.loader);

    // purge resolved promises
    this.isLoading.subscribe(async ($loading) => {
      if ($loading && this.promises.size) {
        await this.loading.toPromise();
        this.promises.clear();

        logger.debug('Loader promises have been purged.');
      }
    });

    if (config) this.loadConfig(config);
  }

  private cachedAt = 0;

  private loadedKeys: Loader.IndexedKeys = {};

  private currentRoute: Writable<string> = writable();

  private config: Writable<Config.T<ParserParams>> = writable();

  private isLoading: Writable<boolean> = writable(false);

  private promises: Set<{ locale?: Config.Locale; route?: Loader.Route; promise: Promise<void>; }> = new Set();

  loading: LoadingStore = {
    subscribe: this.isLoading.subscribe,
    toPromise: (locale, route) => {
      const promises = Array.from(this.promises).filter(
        (promise) => checkProps({ locale: sanitizeLocales(locale)[0], route }, promise),
      ).map(({ promise }) => promise);

      return Promise.all(promises);
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
    const translation = $translations[$locale];
    if (translation && Object.keys(translation).length && !$loading) set(translation);
  }, {});

  t: ExtendedStore<Translations.TranslationFunction<ParserParams>, Translations.TranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translation],
      ([{ parser, fallbackLocale, ...rest }]): Translations.TranslationFunction<ParserParams> => (key, ...params) => translate<ParserParams>({
        parser,
        key,
        params,
        translations: this.translations.get(),
        locale: this.locale.get(),
        fallbackLocale,
        ...(rest.hasOwnProperty('fallbackValue') ? { fallbackValue: rest.fallbackValue } : {}),
      }),
    ),
    get: (key, ...params) => get(this.t)(key, ...params),
  };

  l: ExtendedStore<Translations.LocalTranslationFunction<ParserParams>, Translations.LocalTranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translations],
      ([{ parser, fallbackLocale, ...rest }, translations]): Translations.LocalTranslationFunction<ParserParams> => (locale, key, ...params) => translate<ParserParams>({
        parser,
        key,
        params,
        translations,
        locale,
        fallbackLocale,
        ...(rest.hasOwnProperty('fallbackValue') ? { fallbackValue: rest.fallbackValue } : {}),
      }),
    ),
    get: (locale, key, ...params) => get(this.l)(locale, key, ...params),
  };

  private getLocale = (inputLocale?: string): string => {
    const { fallbackLocale = '' } = get(this.config) || {};

    let locale = inputLocale || fallbackLocale;

    if (!locale) return '';

    const $locales = this.locales.get();

    const outputLocale = $locales.find((l) => sanitizeLocales(locale).includes(l)) || $locales.find((l) => sanitizeLocales(fallbackLocale).includes(l));

    return outputLocale || '';
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
    await this.loadTranslations(initLocale);
  }

  loadConfig = async (config: Config.T<ParserParams>) => {
    await this.configLoader(config);
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
      this.loadedKeys = {};
      this.cachedAt = 0;
    }

    const [sanitizedLocale, sanitizedFallbackLocale] = sanitizeLocales($locale, fallbackLocale);

    const translationForLocale = $translations[sanitizedLocale];
    const translationForFallbackLocale = $translations[sanitizedFallbackLocale];

    const filteredLoaders = (loaders || [])
      .map(({ locale, ...rest }) => ({ ...rest, locale: sanitizeLocales(locale)[0] }))
      .filter(({ routes }) => !routes || (routes || []).some(testRoute($route)))
      .filter(({ key, locale }) => locale === sanitizedLocale && (
        !translationForLocale || !(this.loadedKeys[sanitizedLocale] || []).includes(key)
      ) || (
        fallbackLocale && locale === sanitizedFallbackLocale && (
          !translationForFallbackLocale ||
          !(this.loadedKeys[sanitizedFallbackLocale] || []).includes(key)
        )),
      );

    if (filteredLoaders.length) {
      this.isLoading.set(true);

      logger.debug('Fetching translations...');

      const rawTranslations = await fetchTranslations(filteredLoaders);

      this.isLoading.set(false);

      const loadedKeys = Object.keys(rawTranslations).reduce(
        (acc, locale) => ({ ...acc, [locale]: Object.keys(rawTranslations[locale]) }), {} as Loader.IndexedKeys,
      );

      const keys = filteredLoaders
        .filter(({ key, locale }) => (loadedKeys[locale] || []).some(
          (loadedKey) => `${loadedKey}`.startsWith(key),
        ))
        .reduce<Record<string, any>>((acc, { key, locale }) => ({
        ...acc,
        [locale]: [...(acc[locale] || []), key],
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
          ...(acc[locale] || {}),
          ...translations[locale],
        },
      }),
      $rawTranslations,
    ));

    this.privateTranslations.update(($translations) => translationLocales.reduce(
      (acc, locale) => {
        let dotnotate = true;
        let input = translations[locale];

        if (typeof preprocess === 'function') {
          input = preprocess(input);
        }

        if (typeof preprocess === 'function' || preprocess === 'none') {
          dotnotate = false;
        }

        return ({
          ...acc,
          [locale]: {
            ...(acc[locale] || {}),
            ...dotnotate ? toDotNotation(input, preprocess === 'preserveArrays') : input,
          },
        });
      },
      $translations,
    ));

    translationLocales.forEach(($locale) => {
      let localeKeys = Object.keys(translations[$locale]).map((k) => `${k}`.split('.')[0]);
      if (keys) localeKeys = keys[$locale];

      this.loadedKeys[$locale] = Array.from(new Set([
        ...(this.loadedKeys[$locale] || []),
        ...(localeKeys || []),
      ]));
    });
  };

  private loader = async ([inputLocale, route]: string[]) => {
    const locale = this.getLocale(inputLocale) || undefined;

    logger.debug(`Adding loader promise for '${locale}' locale and '${route}' route.`);

    const promise = (async () => {
      const props = await this.getTranslationProps(locale, route);
      if (props.length) this.addTranslations(...props);
    })();

    this.promises.add({
      locale,
      route,
      promise,
    });

    promise.then(() => {
      if (locale && this.locale.get() !== locale) this.locale.forceSet(locale);
    });
  };

  loadTranslations = (locale: Config.Locale, route = get(this.currentRoute) || '') => {
    const normalizedLocale = this.getLocale(locale);

    if (!normalizedLocale) return;

    this.setRoute(route);
    this.setLocale(normalizedLocale);

    return this.loading.toPromise(normalizedLocale, route);
  };
}