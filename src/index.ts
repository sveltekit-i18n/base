import { derived, get, writable } from 'svelte/store';
import { fetchTranslations, testRoute, toDotNotation, useDefault as d } from './utils';

import type { Config, Parser, ConfigTranslations, LoaderModule, LoadingStore, LocalTranslationFunction, Route, TranslationFunction, Translations, ExtendedStore } from './types';
import type { Readable, Writable } from 'svelte/store';

export { Config, Parser };

export default class {
  constructor(config?: Config) {
    if (config) this.loadConfig(config);

    this.loaderTrigger.subscribe(() => this.translationLoader());
  }

  private loadedKeys: Record<string, string[]> = {};

  private currentRoute: Writable<string> = writable();

  private config: Writable<Config> = writable();

  private isLoading: Writable<boolean> = writable(false);

  private promises: Promise<void>[] = [];

  loading: LoadingStore = { subscribe: this.isLoading.subscribe, toPromise: () => Promise.all(this.promises), get: () => get(this.isLoading) };

  private privateTranslations: Writable<Translations> = writable({});

  translations: ExtendedStore<Translations> = { subscribe: this.privateTranslations.subscribe, get: () => get(this.translations) };

  locales: ExtendedStore<string[]> = {
    ...derived([this.config, this.privateTranslations], ([$config, $translations]) => {
      if (!$config) return [];

      const { loaders = [] } = $config;

      const loaderLocales = loaders.map(({ locale }) => `${locale}`.toLowerCase());
      const translationLocales = Object.keys($translations).map((l) => `${l}`.toLowerCase());

      return ([...new Set([...loaderLocales, ...translationLocales])]);
    }, []),
    get: () => get(this.locales),
  };

  private internalLocale: Writable<string> = writable();

  locale: ExtendedStore<string, () => string, Writable<string>> = {
    set: this.internalLocale.set,
    update: this.internalLocale.update,
    ...derived(this.internalLocale, ($locale, set) => {
      const inputLocale = $locale && `${$locale}`.toLowerCase();
      const outputLocale = this.getLocale(inputLocale);

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

  t: ExtendedStore<TranslationFunction, TranslationFunction> = {
    ...derived(
      [this.config, this.translation],
      ([{ parser, fallbackLocale }]): TranslationFunction => (key, payload) => parser?.parse({
        key,
        payload,
        translations: this.translations.get(),
        locale: this.locale.get(),
        fallbackLocale,
      }),
    ),
    get: (...props) => get(this.t)(...props),
  };

  l: ExtendedStore<LocalTranslationFunction, LocalTranslationFunction> = {
    ...derived(
      [this.config, this.translations],
      ([{ parser, fallbackLocale }, translations]): LocalTranslationFunction => (locale, key, payload) => parser.parse({
        key,
        payload,
        translations,
        locale,
        fallbackLocale,
      }),
    ),
    get: (...props) => get(this.l)(...props),
  };

  private getLocale = (inputLocale?: string): string => {
    if (!inputLocale) return '';

    const $locales = this.locales.get();

    const outputLocale = $locales.find(
      (l) => `${l}`.toLowerCase() === `${inputLocale}`.toLowerCase(),
    ) || '';

    return `${outputLocale}`.toLowerCase();
  };

  setLocale = async (locale?:string) => {
    if (!locale) return;

    this.internalLocale.set(locale);

    await this.loading.toPromise();
  };

  setRoute = async (route: string) => {
    if (route !== get(this.currentRoute)) this.currentRoute.set(route);
    await this.loading.toPromise();
  };

  loadConfig = async (config: Config) => {
    if (!config) throw new Error('No config!');

    this.config.set(config);
    const { initLocale = '', translations } = config;
    if (translations) this.addTranslations(translations);
    await this.loadTranslations(initLocale);
  };

  addTranslations = (translations?: ConfigTranslations, keys?: Record<string, string[]>) => {
    if (!translations) return;

    const translationLocales = Object.keys(d(translations));

    this.privateTranslations.update(($translations) => translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: {
          ...d(acc[locale]),
          ...toDotNotation(translations[locale]),
        },
      }),
      $translations,
    ));

    translationLocales.forEach(($locale) => {
      let localeKeys = Object.keys(translations[$locale]).map((k) => `${k}`.split('.')[0]);
      if (keys) localeKeys = keys[$locale];

      this.loadedKeys[$locale] = Array.from(new Set([
        ...d(this.loadedKeys[$locale], []),
        ...d(localeKeys, []),
      ]));
    });
  };

  getTranslationProps = async ($locale = this.locale.get(), $route = get(this.currentRoute)): Promise<[ConfigTranslations, Record<string, string[]>] | []> => {
    const $config = get(this.config);

    if (!$config || !$locale) return [];

    const $translations = this.translations.get();

    const { loaders, fallbackLocale = '' } = d<Config>($config);

    const lowerLocale = `${$locale}`.toLowerCase();
    const lowerFallbackLocale = fallbackLocale && `${fallbackLocale}`.toLowerCase();

    const translationForLocale = $translations[lowerLocale];
    const translationForFallbackLocale = $translations[lowerFallbackLocale];

    const filteredLoaders = d<LoaderModule[]>(loaders, [])
      .map(({ locale, ...rest }) => ({ ...rest, locale: `${locale}`.toLowerCase() }))
      .filter(({ routes }) => !routes || d<Route[]>(routes, []).some(testRoute($route)))
      .filter(({ key, locale }) => locale === lowerLocale && (
        !translationForLocale || !d(this.loadedKeys[lowerLocale], []).includes(key)
      ) || (
        fallbackLocale && locale === lowerFallbackLocale && (
          !translationForFallbackLocale ||
            !d(this.loadedKeys[lowerFallbackLocale], []).includes(key)
        )),
      );

    if (filteredLoaders.length) {
      this.isLoading.set(true);

      const translations = await fetchTranslations(filteredLoaders);

      this.isLoading.set(false);

      const loadedKeys = Object.keys(translations).reduce<Record<string, string[]>>(
        (acc, locale) => ({ ...acc, [locale]: Object.keys(translations[locale]) }), {},
      );

      const keys = filteredLoaders
        .filter(({ key, locale }) => d<string[]>(loadedKeys[locale], []).some(
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

  private translationLoader = async (locale?: string) => {
    this.promises.push(new Promise(async (res) => {
      const props = await this.getTranslationProps(locale);
      if (props.length) this.addTranslations(...props);
      res();
    }));

    await this.loading.toPromise();
  };

  loadTranslations = async (locale: string, route = get(this.currentRoute) || '') => {
    if (!locale) return;

    this.setRoute(route);
    this.setLocale(locale);

    await this.loading.toPromise();
  };
}