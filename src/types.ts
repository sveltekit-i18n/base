import { Readable } from 'svelte/store';

export type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & { get: Get };

export type LoadingStore = Readable<boolean> & { toPromise: (locale?: Config.Locale, route?: string) => Promise<void[] | void>, get: () => boolean };

export module DotNotation {
  export type Input = Translations.Input;

  export type Output<V = any, K extends keyof V = keyof V> = { [P in K]?: V[K] };

  export type T = <I = Input>(input: I, preserveArrays?: boolean, parentKey?: string) => Output<I>;
}

export module Logger {
  export type Level = 'error' | 'warn' | 'debug';

  export type Prefix = string;

  export type T = {
    [key in Logger.Level]: (value: any) => void;
  };

  export type FactoryProps = {
    /**
     * You can setup your custom logger using this property.
     *
     * @default console
     */
    logger?: Logger.T;
    /**
     * You can manage log level using this property.
     *
     * @default 'warn'
     */
    level?: Logger.Level;
    /**
     * You can prefix output logs using this property.
     *
     * @default '[i18n]: '
     */
    prefix?: Logger.Prefix;
  };
}

export module Config {
  export type Loader = Loader.LoaderModule;

  export type Translations = Translations.T;

  export type Locale = Translations.Locales[number];

  export type InitLocale = Locale | undefined;

  export type FallbackLocale = Locale | undefined;

  export type FallbackValue = any;

  export type T<P extends Parser.Params = Parser.Params> = {
    /**
     * You can use loaders to define your asyncronous translation load. All loaded data are stored so loader is triggered only once – in case there is no previous version of the translation. It can get refreshed according to `config.cache`.
     */
    loaders?: Loader[];
    /**
     * Locale-indexed translations, which should be in place before loaders will trigger. It's useful for static pages and synchronous translations – for example locally defined language names which are the same for all of the language mutations.
     *
     * @example {
     *  "en": {"lang": {"en": "English", "cs": "Česky"}}
     *  "cs": {"lang": {"en": "English", "cs": "Česky"}}
     * }
     */
    translations?: Translations.T;
    /**
     * If you set this property, translations will be initialized immediately using this locale.
     */
    initLocale?: InitLocale;
    /**
     * If you set this property, translations are automatically loaded not for current `$locale` only, but for this locale as well. In case there is no translation for current `$locale`, fallback locale translation is used instead of translation key placeholder. This is also used as a fallback when unknown locale is set.
     */
    fallbackLocale?: FallbackLocale;
    /**
     * By default, translation key is returned in case no translation is found for given translation key. For example, `$t('unknown.key')` will result in `'unknown.key'` output. You can set this output value using this config prop.
     */
    fallbackValue?: FallbackValue;
    /**
     * Preprocessor strategy or a custom function. Defines, how to transform the translation data immediately after the load.
     * @default 'full'
     *
     * @example 'full'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {"a.b.0.c.d": 1, "a.b.1.c.d": 2}
     *
     * @example 'preserveArrays'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {"a.b": [{"c.d": 1}, {"c.d": 2}]}
     *
     * @example 'none'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}}
     */
    preprocess?: 'full' | 'preserveArrays' | 'none' | ((input: Translations.Input) => any);
    /**
     * This property defines translation syntax you want to use.
     */
    parser: Parser.T<P>;
    /**
     * When you are running your app on Node.js server, translations are loaded only once during the SSR. This property allows you to setup a refresh period in milliseconds when your translations are refetched on the server.
     *
     * @default 86400000 // 24 hours
     *
     * @tip You can set to `Number.POSITIVE_INFINITY` to disable server-side refreshing.
     */
    cache?: number;
    /**
     * Custom logger configuration.
     */
    log?: Logger.FactoryProps;
  };
}

export module Loader {
  export type Key = string;

  export type Locale = Config.Locale;

  export type Route = string | RegExp;

  export type IndexedKeys = Translations.LocaleIndexed<Key[]>;

  export type LoaderModule = {
    /**
     * Represents the translation namespace. This key is used as a translation prefix so it should be module-unique. You can access your translation later using `$t('key.yourTranslation')`. It shouldn't include `.` (dot) character.
     */
    key: Key;
    /**
     * Locale (e.g. `en`, `de`) which is this loader for.
     */
    locale: Locale;
    /**
     * Function returning a `Promise` with translation data. You can use it to load files locally, fetch it from your API etc...
    */
    loader: T;
    /**
    * Define routes this loader should be triggered for. You can use Regular expressions too. For example `[/\/.ome/]` will be triggered for `/home` and `/rome` route as well (but still only once). Leave this `undefined` in case you want to load this module with any route (useful for common translations).
    */
    routes?: Route[];
  };

  export type T = () => Promise<Translations.Input>;
}

export module Parser {
  export type Value = any;

  export type Params = Array<unknown>;

  export type Locale = Config.Locale;

  export type Key = Loader.Key;

  export type Output = any;

  export type Parse<P extends Parser.Params = Parser.Params> = (
    /**
     * Translation value from the definitions.
    */
    value: Value,
    /**
     * Array of rest parameters given by user (e.g. payload variables etc...)
     */
    params: P,
    /**
     * Locale of translated message.
     */
    locale: Locale,
    /**
     * This key is serialized path to translation (e.g., `home.content.title`)
     */
    key: Key,
  ) => Output;

  export type T<P extends Parser.Params = Parser.Params> = {
    /**
     * Parse function deals with interpolation of user payload and returns interpolated message.
    */
    parse: Parse<P>;
  };
}

export module Translations {
  export type Locales<T = string> = T[];

  export type SerializedTranslations = LocaleIndexed<DotNotation.Input>;

  export type TranslationData<T = any> = Loader.LoaderModule & { data: T };

  export type FetchTranslations = (loaders: Loader.LoaderModule[]) => Promise<SerializedTranslations>;

  export type TranslationFunction<P extends Parser.Params = Parser.Params> = (key: string, ...restParams: P) => any;

  export type LocalTranslationFunction<P extends Parser.Params = Parser.Params> = (locale: Config.Locale, key: string, ...restParams: P) => any;

  export type Translate = <P extends Parser.Params = Parser.Params>(props: {
    parser: Parser.T<P>;
    key: string;
    params: P;
    translations: SerializedTranslations;
    locale: Locales[number];
    fallbackLocale?: Config.FallbackLocale;
    fallbackValue?: Config.FallbackValue;
  }) => string;

  export type Input<V = any> = { [K in any]: Input<V> | V };

  export type LocaleIndexed<V, L extends string = string> = { [locale in Locales<L>[number]]: V };

  export type T<V = any, L extends string = string> = LocaleIndexed<Input<V>, L>;
}