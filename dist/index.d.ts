import { Readable, Writable } from 'svelte/store';

type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & {
    get: Get;
};
type LoadingStore = Readable<boolean> & {
    toPromise: (locale?: Config.Locale, route?: string) => Promise<void[] | void>;
    get: () => boolean;
};
declare module DotNotation {
    type Input = Translations.Input;
    type Output<V = any, K extends keyof V = keyof V> = {
        [P in K]?: V[K];
    };
    type T = <I = Input>(input: I, parentKey?: string) => Output<I>;
}
declare module Logger {
    type Level = 'error' | 'warn' | 'debug';
    type Prefix = string;
    type T = {
        [key in Logger.Level]: (value: any) => void;
    };
    type FactoryProps = {
        logger?: Logger.T;
        level?: Logger.Level;
        prefix?: Logger.Prefix;
    };
}
declare module Config {
    type Loader = Loader.LoaderModule;
    type Translations = Translations.T;
    type Locale = Translations.Locales[number];
    type InitLocale = Locale | undefined;
    type FallbackLocale = Locale | undefined;
    type FallbackValue = any;
    type T<P extends Parser.Params = Parser.Params> = {
        loaders?: Loader[];
        translations?: Translations.T;
        initLocale?: InitLocale;
        fallbackLocale?: FallbackLocale;
        fallbackValue?: FallbackValue;
        parser: Parser.T<P>;
        cache?: number;
        log?: {
            level?: Logger.Level;
            logger?: Logger.T;
            prefix?: Logger.Prefix;
        };
    };
}
declare module Loader {
    type Key = string;
    type Locale = Config.Locale;
    type Route = string | RegExp;
    type IndexedKeys = Translations.LocaleIndexed<Key[]>;
    type LoaderModule = {
        key: Key;
        locale: Locale;
        routes?: Route[];
        loader: T;
    };
    type T = () => Promise<Translations.Input>;
}
declare module Parser {
    type Value = any;
    type Params = Array<unknown>;
    type Locale = Config.Locale;
    type Key = Loader.Key;
    type Output = any;
    type Parse<P extends Parser.Params = Parser.Params> = (value: Value, params: P, locale: Locale, key: Key) => Output;
    type T<P extends Parser.Params = Parser.Params> = {
        parse: Parse<P>;
    };
}
declare module Translations {
    type Locales = string[];
    type SerializedTranslations = LocaleIndexed<DotNotation.Output>;
    type FetchTranslations = (loaders: Loader.LoaderModule[]) => Promise<SerializedTranslations>;
    type TranslationFunction<P extends Parser.Params = Parser.Params> = (key: string, ...restParams: P) => any;
    type LocalTranslationFunction<P extends Parser.Params = Parser.Params> = (locale: Config.Locale, key: string, ...restParams: P) => any;
    type Translate = <P extends Parser.Params = Parser.Params>(props: {
        parser: Parser.T<P>;
        key: string;
        params: P;
        translations: SerializedTranslations;
        locale: Locales[number];
        fallbackLocale?: Config.FallbackLocale;
        fallbackValue?: Config.FallbackValue;
    }) => string;
    type Input<V = any> = {
        [K in any]: Input<V> | V;
    };
    type LocaleIndexed<V> = {
        [locale in Locales[number]]: V;
    };
    type T<V = any> = LocaleIndexed<Input<V>>;
}

declare class I18n<ParserParams extends Parser.Params = any> {
    constructor(config?: Config.T<ParserParams>);
    private cachedAt;
    private loadedKeys;
    private currentRoute;
    private config;
    private isLoading;
    private promises;
    loading: LoadingStore;
    private privateTranslations;
    translations: ExtendedStore<Translations.SerializedTranslations>;
    locales: ExtendedStore<Config.Locale[]>;
    private internalLocale;
    private loaderTrigger;
    private localeHelper;
    locale: ExtendedStore<Config.Locale, () => Config.Locale, Writable<string>> & {
        forceSet: any;
    };
    initialized: Readable<boolean>;
    private translation;
    t: ExtendedStore<Translations.TranslationFunction<ParserParams>, Translations.TranslationFunction<ParserParams>>;
    l: ExtendedStore<Translations.LocalTranslationFunction<ParserParams>, Translations.LocalTranslationFunction<ParserParams>>;
    private getLocale;
    setLocale: (locale?: string) => Promise<void | void[]> | undefined;
    setRoute: (route: string) => Promise<void | void[]> | undefined;
    configLoader(config: Config.T<ParserParams>): Promise<void>;
    loadConfig: (config: Config.T<ParserParams>) => Promise<void>;
    getTranslationProps: ($locale?: string, $route?: string) => Promise<[Translations.SerializedTranslations, Loader.IndexedKeys] | [
    ]>;
    addTranslations: (translations?: Translations.SerializedTranslations, keys?: Loader.IndexedKeys) => void;
    private loader;
    loadTranslations: (locale: Config.Locale, route?: string) => Promise<void | void[]> | undefined;
}

export { Config, Loader, Logger, Parser, Translations, I18n as default };
