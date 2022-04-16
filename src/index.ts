import { derived, get, writable } from 'svelte/store';
import { checkProps, fetchTranslations, sanitizeLocales, testRoute, toDotNotation, translate } from './utils';
import { logger, loggerFactory, setLogger } from './logger';

import type { Config, Loader, Parser, Translations, LoadingStore, ExtendedStore, Logger } from './types';
import type { Readable, Writable } from 'svelte/store';

export type { Config, Loader, Parser, Translations, Logger };

const defaultCache = 1000 * 60 * 60 * 24;

export default class I18n<ParserParams extends Parser.Params = any> {
  constructor(config?: Config.T<ParserParams>) {
    if (config) this.loadConfig(config);

    this.loaderTrigger.subscribe(this.loader);

    // purge resolved promises
    this.isLoading.subscribe(async ($loading) => {
      if ($loading && this.promises.size) {
        await this.loading.toPromise();
        this.promises.clear();

        logger.debug('Loader promises have been purged.');
      }
    });
  }

  private cachedAt = 0;

  private loadedKeys: Loader.IndexedKeys = {};

  private currentRoute: Writable<string> = writable();

  private config: Writable<Config.T<ParserParams>> = writable();

  private isLoading: Writable<boolean> = writable(false);

  private promises: Set<{ locale: Config.Locale; route: string; promise: Promise<void>; }> = new Set();

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

  private privateTranslations: Writable<Translations.SerializedTranslations> = writable({});

  translations: ExtendedStore<Translations.SerializedTranslations> = { subscribe: this.privateTranslations.subscribe, get: () => get(this.translations) };

  locales: ExtendedStore<Config.Locale[]> = {
    ...derived([this.config, this.privateTranslations], ([$config, $translations]) => {
      if (!$config) return [];

      const { loaders = [] } = $config;

      const loaderLocales = loaders.map(({ locale }) => sanitizeLocales(locale)[0]);
      const translationLocales = Object.keys($translations).map((locale) => sanitizeLocales(locale)[0]);

      return Array.from(new Set([...loaderLocales, ...translationLocales]));
    }, []),
    get: () => get(this.locales),
  };

  private internalLocale: Writable<Config.Locale> = writable();

  private loaderTrigger = derived([this.internalLocale, this.currentRoute], ([$internalLocale, $currentRoute], set) => {
    if ($internalLocale !== undefined && $currentRoute !== undefined && ($internalLocale !== get(this.loaderTrigger)?.[0] || $currentRoute !== get(this.loaderTrigger)?.[1])) {
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
    if (!inputLocale) return '';

    const $locales = this.locales.get();

    const outputLocale = $locales.find(
      (locale) => locale === sanitizeLocales(inputLocale)[0],
    ) || '';

    return sanitizeLocales(outputLocale)[0] || '';
  };

  setLocale = (locale?:string) => {
    if (!locale) return;
    const [sanitizedLocale] = sanitizeLocales(locale);

    if (sanitizedLocale !== get(this.internalLocale)) {
      logger.debug(`Setting '${sanitizedLocale}' locale.`);

      this.internalLocale.set(sanitizedLocale);

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

      const translations = await fetchTranslations(filteredLoaders);

      this.isLoading.set(false);

      const loadedKeys = Object.keys(translations).reduce(
        (acc, locale) => ({ ...acc, [locale]: Object.keys(translations[locale]) }), {} as Loader.IndexedKeys,
      );

      const keys = filteredLoaders
        .filter(({ key, locale }) => (loadedKeys[locale] || []).some(
          (loadedKey) => `${loadedKey}`.startsWith(key),
        ))
        .reduce<Record<string, any>>((acc, { key, locale }) => ({
        ...acc,
        [locale]: [...(acc[locale] || []), key],
      }), {});

      return [translations, keys];
    }
    return [];
  };

  addTranslations = (translations?: Translations.SerializedTranslations, keys?: Loader.IndexedKeys) => {
    if (!translations) return;

    logger.debug('Adding translations...');

    const translationLocales = Object.keys(translations || {});

    this.privateTranslations.update(($translations) => translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: {
          ...(acc[locale] || {}),
          ...toDotNotation(translations[locale]),
        },
      }),
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

  private loader = async ([locale, route]: string[]) => {
    logger.debug('Adding loader promise.');

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
      const outputLocale = this.getLocale(locale);
      if (outputLocale && this.locale.get() !== outputLocale) this.locale.forceSet(outputLocale);
    });
  };

  loadTranslations = (locale: Config.Locale, route = get(this.currentRoute) || '') => {
    if (!locale) return;

    this.setRoute(route);
    this.setLocale(locale);

    return this.loading.toPromise(locale, route);
  };
}