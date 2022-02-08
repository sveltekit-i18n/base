import { Readable } from 'svelte/store';

export type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & { get: Get };

export type LoadingStore = Readable<boolean> & { toPromise: () => Promise<void[]>, get: () => boolean };

export module DotNotation {
  export type Input = any;

  export type Output<V = any, K extends keyof V = keyof V> = { [P in K]?: V[K] } | null;

  export type T = <I = Input>(input: I, parentKey?: string) => Output<I>;
}

export module Config {
  export type Loaders = Loader.LoaderModule[] | undefined;

  export type Translations = Translations.T | undefined;

  export type Locale = string;

  export type InitLocale = Locale | undefined;

  export type FallbackLocale = Locale | undefined;

  export type T<P extends Parser.Params = any> = {
    loaders?: Loaders;
    translations?: Translations;
    initLocale?: InitLocale;
    fallbackLocale?: FallbackLocale;
    parser: Parser.T<P>;
  };
}

export module Loader {
  export type Key = string;

  export type Locale = Config.Locale;

  export type Route = string | RegExp;

  export type LoaderModule = {
    key: Key;
    locale: Locale;
    routes?: Route[];
    loader: T;
  };

  export type T = () => Promise<Record<any, any>>;
}

export module Parser {
  export type Value = any;

  export type Params = Array<unknown>;

  export type Locale = Config.Locale;

  export type Key = Loader.Key;

  export type Output = any;

  export type Parse<P extends Parser.Params = any> = (
    value: Value,
    params: P,
    locale: Locale,
    key: Key,
  ) => Output;

  export type ParserFactory<Options = any, P extends Parser.Params = any> = (options: Options) => Parser.T<P>;

  export type T<P extends Parser.Params = any> = {
    parse: Parse<P>;
  };
}

export module Translations {
  export type SerializedTranslations = T<DotNotation.Output>;

  export type FetchTranslations = (loaders: Loader.LoaderModule[]) => Promise<SerializedTranslations>;

  export type TranslationFunction<P extends Parser.Params = any> = (key: string, ...restParams: P) => string;

  export type LocalTranslationFunction<P extends Parser.Params = any> = (locale: string, key: string, ...restParams: P) => string;

  export type Translate<P extends Parser.Params = any> = (props: {
    parser: Parser.T<P>;
    key: string;
    params: P;
    translations: SerializedTranslations;
    locale: string;
    fallbackLocale?: string;
  }) => string;

  export type T<T = any> = { [locale: string]: Record<string, T> };
}