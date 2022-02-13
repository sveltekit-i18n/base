import { derived, get, writable } from 'svelte/store';
import { fetchTranslations, sanitizeLocales, testRoute, toDotNotation } from './utils';

import type { Config, Loader, Parser, Translations, LoadingStore, ExtendedStore } from './types';
import type { Readable, Writable } from 'svelte/store';

export type { Config, Loader, Parser, Translations };

const defaultCache = 1000 * 60 * 60 * 24;

export default class I18n<ParserParams extends Parser.Params = any> {
  constructor(config?: Config.T<ParserParams>) {
    if (config) this.loadConfig(config);

    this.loaderTrigger.subscribe(() => this.translationLoader());
  }

  private cachedAt = 0;

  private loadedKeys: Loader.IndexedKeys = {};

  private currentRoute: Writable<string> = writable();

  private config: Writable<Config.T<ParserParams>> = writable();

  private isLoading: Writable<boolean> = writable(false);

  private promises: Promise<void>[] = [];

  loading: LoadingStore = { subscribe: this.isLoading.subscribe, toPromise: () => Promise.all(this.promises), get: () => get(this.isLoading) };

  private privateTranslations: Writable<Translations.SerializedTranslations> = writable({});

  translations: ExtendedStore<Translations.SerializedTranslations> = { subscribe: this.privateTranslations.subscribe, get: () => get(this.translations) };

  locales: ExtendedStore<Config.Locale[]> = {
    ...derived([this.config, this.privateTranslations], ([$config, $translations]) => {
      if (!$config) return [];

      const { loaders = [] } = $config;

      const loaderLocales = loaders.map(({ locale }) => sanitizeLocales(locale)[0]);
      const translationLocales = Object.keys($translations).map((locale) => sanitizeLocales(locale)[0]);

      return [...new Set([...loaderLocales, ...translationLocales])];
    }, []),
    get: () => get(this.locales),
  };

  private internalLocale: Writable<Config.Locale> = writable();

  locale: ExtendedStore<Config.Locale, () => Config.Locale, Writable<string>> = {
    set: this.internalLocale.set,
    update: this.internalLocale.update,
    ...derived(this.internalLocale, ($locale, set) => {
      const outputLocale = this.getLocale($locale);

      if (outputLocale && outputLocale !== this.locale.get()) set(outputLocale);
    }),
    get: () => get(this.locale),
  };

  private loaderTrigger = derived([this.internalLocale, this.currentRoute], ([$internalLocale, $currentRoute], set) => {
    if ($internalLocale !== undefined && $currentRoute !== undefined) set([$internalLocale, $currentRoute]);
  }, [] as string[]);

  initialized: Readable<boolean> = derived([this.locale, this.currentRoute, this.privateTranslations], ([$locale, $currentRoute, $translations], set) => {
    if (!get(this.initialized)) set($locale !== undefined && $currentRoute !== undefined && !!Object.keys($translations).length);
  });

  private translation: Readable<Record<string, string>> = derived([this.privateTranslations, this.locale, this.isLoading], ([$translations, $locale, $loading], set) => {
    const translation = $translations[$locale];
    if (translation && Object.keys(translation).length && !$loading) set(translation);
  }, {});

  private translate: Translations.Translate<ParserParams> = ({
    parser,
    key,
    params,
    translations,
    locale,
    fallbackLocale,
  }) => {
    if (!(key && locale)) {
      console.warn('No translation key or locale provided. Skipping translation...');
      return '';
    }

    let text = (translations[locale] || {})[key];

    if (fallbackLocale && text === undefined) {
      text = (translations[fallbackLocale] || {})[key];
    }

    return parser.parse(text, params, locale, key);
  };

  t: ExtendedStore<Translations.TranslationFunction<ParserParams>, Translations.TranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translation],
      ([{ parser, fallbackLocale }]): Translations.TranslationFunction<ParserParams> => (key, ...params) => this.translate({
        parser,
        key,
        params,
        translations: this.translations.get(),
        locale: this.locale.get(),
        fallbackLocale,
      }),
    ),
    get: (key, ...params) => get(this.t)(key, ...params),
  };

  l: ExtendedStore<Translations.LocalTranslationFunction<ParserParams>, Translations.LocalTranslationFunction<ParserParams>> = {
    ...derived(
      [this.config, this.translations],
      ([{ parser, fallbackLocale }, translations]): Translations.LocalTranslationFunction<ParserParams> => (locale, key, ...params) => this.translate({
        parser,
        key,
        params,
        translations,
        locale,
        fallbackLocale,
      }),
    ),
    get: (locale, key, ...params) => get(this.l)(locale, key, ...params),
  };

  private getLocale = (inputLocale?: string): string => {
    if (!inputLocale) return '';

    const $locales = this.locales.get();

    const outputLocale = $locales.find(
      (l) => `${sanitizeLocales(l)}` === `${sanitizeLocales(inputLocale)}`,
    ) || '';

    return `${sanitizeLocales(outputLocale)}`;
  };

  setLocale = async (locale?:string) => {
    if (!locale) return;

    this.internalLocale.set(`${sanitizeLocales(locale)}`);

    await this.loading.toPromise();
  };

  setRoute = async (route: string) => {
    if (route !== get(this.currentRoute)) this.currentRoute.set(route);
    await this.loading.toPromise();
  };

  async configLoader(config: Config.T<ParserParams>) {
    if (!config) throw new Error('No config provided!');

    let { initLocale, fallbackLocale, translations, ...rest } = config;
    initLocale = sanitizeLocales(initLocale)[0];
    fallbackLocale = sanitizeLocales(fallbackLocale)[0];

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
      this.cachedAt = Date.now();
    } else if (Date.now() > cacheValue + this.cachedAt) {
      this.privateTranslations.set({});
      this.loadedKeys = {};
      this.cachedAt = 0;
    }

    const [sanitizedLocale, sanitizedFallbackLocale] = sanitizeLocales([$locale, fallbackLocale]);

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

  private translationLoader = async (locale?: Config.Locale) => {
    this.promises.push(new Promise(async (res) => {
      const props = await this.getTranslationProps(locale);
      if (props.length) this.addTranslations(...props);
      res();
    }));

    await this.loading.toPromise();
  };

  loadTranslations = async (locale: Config.Locale, route = get(this.currentRoute) || '') => {
    if (!locale) return;

    this.setRoute(route);
    this.setLocale(locale);

    await this.loading.toPromise();
  };
}