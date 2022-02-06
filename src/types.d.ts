import { Readable } from 'svelte/store';

export type LoadingStore = Readable<boolean> & { toPromise: () => Promise<void[]>, get: () => boolean };

export type Loader = () => Promise<Record<any, any>>;

export type Route = string | RegExp;

export type LoaderModule = {
  key: string;
  locale: string;
  routes?: Route[];
  loader: Loader;
};

export type ParserParamsDefault = any[] | [];

export type DotNotationInput = Record<string, any> | null | undefined | any;

export type DotNotationOutput = Record<string, any>;

export type ToDotNotation = (input: DotNotationInput, parentKey?: string) => DotNotationOutput;

export type DotNotatedTranslations = Record<string, DotNotationOutput>;

export type FetchTranslations = (loaders: LoaderModule[]) => Promise<DotNotatedTranslations>;

export type TranslationFunction<ParserParams extends ParserParamsDefault> = (key: string, ...restParams: ParserParams) => string;

export type LocalTranslationFunction<ParserParams extends ParserParamsDefault> = (locale: string, key: string, ...restParams: ParserParams) => string;

export type ExtendedStore<T, Get = () => T, Store = Readable<T>> = Store & { get: Get };

export type ConfigTranslations = { [locale: string]: Record<string, any> };

export type Translations = { [locale: string]: Record<string, string> };

export type Translate<ParserParams = ParserParamsDefault> = (props: {
  parser: Parser<ParserParams>;
  key: string;
  params: ParserParams;
  translations: DotNotatedTranslations;
  locale: string;
  fallbackLocale?: string;
}) => string;

export type Parse<ParserParams = ParserParamsDefault> = (
  text: string | undefined,
  params: ParserParams,
  locale: string,
  key: string,
) => string;

export type Parser<ParserParams = ParserParamsDefault> = {
  parse: Parse<ParserParams>;
};

export type Config<ParserParams = ParserParamsDefault> = {
  loaders?: LoaderModule[];
  translations?: ConfigTranslations;
  initLocale?: string;
  fallbackLocale?: string;
  parser: Parser<ParserParams>;
};