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
    logger?: Logger.T;
    level?: Logger.Level;
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
    loaders?: Loader[];
    translations?: Translations.T;
    initLocale?: InitLocale;
    fallbackLocale?: FallbackLocale;
    fallbackValue?: FallbackValue;
    /**
     * Preprocessor strategy or a custom function.
     * @default 'full'
     *
     * @example 'preserveArrays'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {a.b: [{c.d: 1}, {c.d: 2}]}
     *
     * @example 'full'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {a.b.0.c.d: 1, a.b.1.c.d: 2}
     *
     * @example 'none'
     * {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}} => {a: {b: [{c: {d: 1}}, {c: {d: 2}}]}}
     */
    preprocess?: 'full' | 'preserveArrays' | 'none' | ((input: Translations.Input) => any);
    parser: Parser.T<P>;
    cache?: number;
    log?: {
      level?: Logger.Level;
      logger?: Logger.T;
      prefix?: Logger.Prefix;
    };
  };
}

export module Loader {
  export type Key = string;

  export type Locale = Config.Locale;

  export type Route = string | RegExp;

  export type IndexedKeys = Translations.LocaleIndexed<Key[]>;

  export type LoaderModule = {
    key: Key;
    locale: Locale;
    routes?: Route[];
    loader: T;
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
    value: Value,
    params: P,
    locale: Locale,
    key: Key,
  ) => Output;

  export type T<P extends Parser.Params = Parser.Params> = {
    parse: Parse<P>;
  };
}

export module Translations {
  export type Locales<T = string> = T[];

  export type SerializedTranslations = LocaleIndexed<DotNotation.Output>;

  export type FetchTranslations = (loaders: Loader.LoaderModule[], preprocess?: Config.T['preprocess']) => Promise<SerializedTranslations>;

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