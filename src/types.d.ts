import { Readable } from 'svelte/store';

export type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & { get: Get };

export type LoadingStore = Readable<boolean> & { toPromise: () => Promise<void[]>, get: () => boolean };

export namespace IDotNotation {
  export type Input = Record<string, any> | null | undefined | any;

  export type Output<T = any> = Record<string, T>;

  export type Function<T = any> = (input: Input, parentKey?: string) => Output<T>;
}

export namespace IConfig {
  export type Loaders = ILoader.LoaderModule[] | undefined;

  export type Translations = ITranslations.Translations | undefined;

  export type Locale = string;

  export type InitLocale = Locale | undefined;

  export type FallbackLocale = Locale | undefined;

  export type Parser<T = IParser.Params> = IParser.Parser<T>;

  export type Config<T = IParser.Params> = {
    loaders?: Loaders;
    translations?: Translations;
    initLocale?: InitLocale;
    fallbackLocale?: FallbackLocale;
    parser: Parser<T>;
  };
}

export namespace ITranslations {
  export type Translations<T = any> = { [locale: string]: Record<string, T> };

  export type SerializedTranslations<T = any> = Translations<IDotNotation.Output<T>>;

  export type FetchTranslations<T = any> = (loaders: ILoader.LoaderModule[]) => Promise<SerializedTranslations<T>>;

  export type TranslationFunction<T extends IParser.Params> = (key: string, ...restParams: T) => string;

  export type LocalTranslationFunction<T extends IParser.Params> = (locale: string, key: string, ...restParams: T) => string;

  export type Translate<T = IParser.Params> = (props: {
    parser: IParser.Parser<T>;
    key: string;
    params: T;
    translations: SerializedTranslations;
    locale: string;
    fallbackLocale?: string;
  }) => string;
}

export namespace ILoader {
  export type Key = string;

  export type Locale = IConfig.Locale;

  export type Route = string | RegExp;

  export type Loader = () => Promise<Record<any, any>>;

  export type LoaderModule = {
    key: Key;
    locale: Locale;
    routes?: Route[];
    loader: Loader;
  };
}

export namespace IParser {
  export type Text = any;

  export type Params = any[] | [];

  export type Locale = IConfig.Locale;

  export type Key = ILoader.Key;

  export type Parse<T = Params> = (
    text: Text,
    params: T,
    locale: Locale,
    key: Key,
  ) => string;

  export type Parser<T = Params> = {
    parse: Parse<T>;
  };

  export type ParserFactory<Options = any, T = Params> = (options: Options) => Parser<T>;
}