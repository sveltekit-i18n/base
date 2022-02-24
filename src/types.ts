import { Readable } from 'svelte/store';

export type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & { get: Get };

export type LoadingStore = Readable<boolean> & { toPromise: (locale?:Config.Locale, route?: string) => Promise<void[] | void>, get: () => boolean };

export module DotNotation {
  export type Input = Translations.Input;

  export type Output<V = any, K extends keyof V = keyof V> = { [P in K]?: V[K] };

  export type T = <I = Input>(input: I, parentKey?: string) => Output<I>;
}

export module Config {
  export type Loader = Loader.LoaderModule;

  export type Translations = Translations.T;

  export type Locale = Translations.Locales[number];

  export type InitLocale = Locale | undefined;

  export type FallbackLocale = Locale | undefined;

  export type T<P extends Parser.Params = Parser.Params> = {
    loaders?: Loader[];
    translations?: Translations.T;
    initLocale?: InitLocale;
    fallbackLocale?: FallbackLocale;
    parser: Parser.T<P>;
    cache?: number;
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
  export type Locales = string[];

  export type SerializedTranslations = LocaleIndexed<DotNotation.Output>;

  export type FetchTranslations = (loaders: Loader.LoaderModule[]) => Promise<SerializedTranslations>;

  export type TranslationFunction<P extends Parser.Params = Parser.Params> = (key: string, ...restParams: P) => any;

  export type LocalTranslationFunction<P extends Parser.Params = Parser.Params> = (locale: Config.Locale, key: string, ...restParams: P) => any;

  export type Translate = <P extends Parser.Params = Parser.Params>(props: {
    parser: Parser.T<P>;
    key: string;
    params: P;
    translations: SerializedTranslations;
    locale: Locales[number];
    fallbackLocale?: string;
  }) => string;

  export type Input<V = any> ={ [K in any]: Input<V> | V };

  export type LocaleIndexed<V> = { [locale in Locales[number]]: V };

  export type T<V = any> = LocaleIndexed<Input<V>>;
}