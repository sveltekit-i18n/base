export namespace DotNotation {
  export type Input = any;

  export type Output<V = any, K extends keyof V = keyof V> = { [P in K]?: V[K] } | null | V;

  export type T = <I = Input>(input: I, preserveArrays?: boolean, parentKey?: string) => Output<I>;
}

export namespace Logger {
  export type Level = 'error' | 'warn' | 'debug';

  export type Prefix = string;

  export type T = {
    /**
     * `message` arrives prefixed (see `FactoryProps.prefix`); `error` — when
     * present — is the raw thrown value, passed through unformatted so the
     * logger can render its stack or serialize it as it sees fit.
     */
    [key in Logger.Level]: (message: string, error?: unknown) => void;
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

export namespace Config {
  export type Locale = Translations.Locales[number];

  /**
   * A locale as the public surface takes and reports it: the locales the config
   * spells, plus any other string. The set is a completion hint, never a
   * constraint — a locale can arrive from a URL, a cookie or an
   * `Accept-Language` header, and a custom `sanitizeLocales` may map an
   * arbitrary input onto a known one.
   */
  export type LocaleInput<L extends string = string> = L | (string & {});

  /** A locale-valued config property; `never` unless it carries a literal. */
  type LocaleProp<C, K extends string> = C extends { [P in K]: infer L extends string } ? L : never;

  type LocaleSources<C> =
    | (C extends { loaders: readonly { locale: infer L extends string }[] } ? L : never)
    | (C extends { translations: infer T } ? keyof T & string : never)
    | LocaleProp<C, 'initLocale'>
    | LocaleProp<C, 'fallbackLocale'>;

  type ResolveLocales<L> = L extends string ? L : never;

  /**
   * The locales a config type spells – loader locales, `initLocale`,
   * `fallbackLocale` and the keys of `translations`. Plain `Locale` when it
   * spells none, and plain `Locale` as soon as ONE source is dynamic: a
   * half-known set would complete some locales while silently hiding the rest.
   */
  export type LocalesFromConfig<C> = [LocaleSources<C>] extends [never]
    ? Locale
    : ResolveLocales<LocaleSources<C>>;

  export type InitLocale = Locale | undefined;

  export type FallbackLocale = Locale | undefined;

  export type FallbackValue = any;

  export type SanitizeLocales = boolean | ((locale: Locale) => Locale);

  export type T<P extends Parser.Params = Parser.Params, O = Parser.Output, S = any> = {
    /**
     * You can use loaders to define your asyncronous translation load. All loaded data are stored so loader is triggered only once – in case there is no previous version of the translation. It can get triggered again once the `config.cache` window elapses, or after `invalidate()` is called.
     */
    loaders?: readonly Loader.LoaderModule[];
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
     * If you set this property, translations are automatically loaded not for current `locale` only, but for this locale as well. In case there is no translation for current `locale`, fallback locale translation is used instead of translation key placeholder. This is also used as a fallback when unknown locale is set.
     */
    fallbackLocale?: FallbackLocale;
    /**
     * By default, translation key is returned in case no translation is found for given translation key. For example, `t('unknown.key')` will result in `'unknown.key'` output. You can set this output value using this config prop.
     */
    fallbackValue?: FallbackValue;
    /**
     * Defines how locale identifiers are normalized before they key anything – `config.translations`, loaders, the translation tables, `locale`, `fallbackLocale` and every locale you pass in. `true` normalizes to the ISO form, `false` keeps each locale exactly as it was authored, and a function normalizes it your way.
     *
     * @default true
     *
     * @example true
     * 'en-us' => 'en-US'
     *
     * @example false
     * 'en-us' => 'en-us'
     *
     * @example (locale) => locale.toLowerCase()
     * 'en-US' => 'en-us'
     */
    sanitizeLocales?: SanitizeLocales;
    /**
     * Preprocessor strategy or a custom function. Defines, how to transform the translation data immediately after the load. Note that a custom function (like `'none'`) bypasses the dot-notation flattening entirely – its return value is stored as-is, so keys are then looked up exactly as the function produced them.
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
    preprocess?: 'full' | 'preserveArrays' | 'none' | ((input: Translations.Input) => Translations.Input);
    /**
     * This property defines translation syntax you want to use.
     */
    parser: Parser.T<P, O>;
    /**
     * A key schema — a map of translation key to the payload its message
     * expects (`never` for a message without parameters). Supplying it types
     * `t`/`l`: keys autocomplete and a wrong payload is a type error. Only its
     * TYPE is read, so a generated artifact may export a value that is empty
     * at runtime — as long as that value is TYPED, e.g.
     * `export const schema = {} as TranslationSchema`. A schema whose keys are not a
     * closed set (an open index signature, or no keys at all) is ignored and
     * keys stay plain strings. Read at construction time only: a later
     * `loadConfig()` cannot retype the instance, and `config.extensions`
     * erases the instance's type parameters entirely.
     *
     * @example
     * import { schema } from './generated/i18n-schema.js';
     *
     * const i18n = new I18n({ ...config, schema });
     */
    schema?: S;
    /**
     * Time in milliseconds the loaded translations stay fresh for. Once a locale's translations are older, the next load trigger runs its loaders again. By default, loaded translations never expire – call `invalidate()` (or set a finite `cache`) when your translation source can change at runtime, e.g. a CMS.
     *
     * @default Number.POSITIVE_INFINITY
     *
     * @tip Set to `0` to treat translations as always stale (refetch on every load trigger).
     */
    cache?: number;
    /**
     * Extensions the constructed instance is piped through, left to right.
     * Each extension receives the surface produced so far — the raw `I18n`
     * instance for the first one, the previous extension's output for the
     * next — and returns the surface handed on, so `new I18n(config)`
     * evaluates to the LAST extension's output. Applied by the constructor
     * only; a later `loadConfig()` ignores this property.
     *
     * @example
     * import stores from '@sveltekit-i18n/extension-stores';
     *
     * const { t, locale, loading } = new I18n({ ...config, extensions: [stores] });
     */
    extensions?: readonly Extension.T[];
    /**
     * Custom logger configuration.
     */
    log?: Logger.FactoryProps;
  };
}

export namespace Extension {
  export type Input = any;

  export type Output = any;

  /**
   * An extension is a plain function over the constructed surface. It may
   * augment its input in place and return it, or return a brand-new surface —
   * the constructor just folds the instance through the configured extensions.
   */
  export type T<I = Input, O = Output> = (input: I) => O;

  /** The `extensions` tuple carried by a config; `[]` when absent. */
  export type FromConfig<C> = C extends { extensions: infer E extends readonly T[] } ? E : [];

  /**
   * Folds a surface type through an extension tuple, left to right — the
   * construction-time type of `new I18n(config)`. A non-tuple `extensions`
   * array (or none at all) degrades to the plain instance type.
   */
  export type Piped<Instance, Extensions> = Extensions extends readonly [T<any, infer O>, ...infer Rest]
    ? Piped<O, Rest>
    : Instance;
}

export namespace Loader {
  export type Key = string;

  export type Locale = Config.Locale;

  /**
   * Anything with a `test` method can act as a route matcher. It receives the
   * bare route path (e.g. `/products/123`), so a matcher built around a full
   * URL has to be wrapped in a predicate that supplies the origin itself.
   */
  export type RouteMatcher = {
    test: (route: string) => boolean;
  };

  export type Route = string | RegExp | RouteMatcher;

  export type IndexedKeys = Translations.LocaleIndexed<Key[]>;

  /** The load context every loader is called with. */
  export type Props = {
    /**
     * Sanitized locale this loader run fetches translations for.
     */
    locale: Locale;
    /**
     * Route the load was triggered for.
     */
    route: string;
  };

  export type LoaderModule = {
    /**
     * Represents the translation namespace. This key is used as a translation prefix so it should be module-unique. You can access your translation later using `t('key.yourTranslation')`. It shouldn't include `.` (dot) character.
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
    * Define routes this loader should be triggered for. You can use Regular expressions or any object with a `test` method too. For example `[/\/.ome/]` will be triggered for `/home` and `/rome` route as well (but still only once). Leave this `undefined` in case you want to load this module with any route (useful for common translations).
    *
    * Named capture groups in a route `RegExp` are reserved: today they match exactly as any other group does, but a future minor may read their matches as load parameters and re-run the loader when those change. Use a non-capturing group (`(?:...)`) where you only need grouping.
    */
    routes?: readonly Route[];
  };

  /**
   * Loads translation data. Receives the load context (`locale`, `route`) –
   * loaders that don't need it can simply take no parameters.
   */
  export type T = (props: Props) => Promise<Translations.Input>;
}

export namespace Parser {
  export type Value = any;

  export type Params = Array<unknown>;

  export type Locale = Config.Locale;

  export type Key = Loader.Key;

  export type Output = any;

  export type Parse<P extends Parser.Params = Parser.Params, O = Output> = (
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
  ) => O;

  export type T<P extends Parser.Params = Parser.Params, O = Output> = {
    /**
     * Parse function deals with interpolation of user payload and returns interpolated message.
    */
    parse: Parse<P, O>;
  };

  /** The parser params carried by a config's `parser`; `any` when unknown. */
  export type FromConfig<C> = C extends { parser: T<infer P> } ? P : any;

  /**
   * The parser output carried by a config's `parser`; `string` when unknown.
   * `[unknown] extends [O]` catches both `any` and `unknown` – the former from
   * a parser without a declared output (the `Output` default), the latter from
   * an untyped `parser` value, where inference has no return type to read. A
   * parser producing anything richer must declare its output explicitly (e.g.
   * `Parser.T<Params, HtmlOutput>`).
   */
  export type OutputFromConfig<C> = C extends { parser: T<any, infer O> }
    ? ([unknown] extends [O] ? string : O)
    : string;

  /**
   * What a message parameter accepts, as far as a message can say.
   *
   * `'unknown'` is the top of this lattice, not a conflict marker: merging it
   * with anything yields the other kind. `'date'` covers both date and time
   * formatting and means `Date | number`. `'function'` is a rich-text callback,
   * the shape ICU tags require. `'boolean'` is here for parsers that can prove
   * it – neither official parser can, since both compare stringified values.
   */
  export type ParamKind = 'unknown' | 'string' | 'number' | 'boolean' | 'date' | 'function';

  /**
   * One parameter a message expects. Produced by a parser's build-time
   * extractor and consumed by a schema generator, never by the core.
   */
  export type ParamSpec = {
    /**
     * Name the payload is keyed by, already unescaped. It is not necessarily a
     * valid identifier, so a generator has to quote it.
     */
    name: string;
    /**
     * What the parameter accepts; defaults to `'unknown'`. Several kinds mean
     * the message uses the parameter in several ways and any of them is valid.
     */
    kind?: ParamKind | readonly ParamKind[];
    /**
     * Values the message names explicitly – a hint for authoring tools, never
     * an exhaustive set. Both official parsers fall back to a default branch
     * for anything unlisted, so this must not be used to close a union. Omit it
     * where the listed values are not values at all (numeric thresholds, plural
     * categories) or mean the opposite (an inequality's operands).
     */
    values?: readonly string[];
    /**
     * Whether the message renders without it; defaults to `false`. A parameter
     * that only some selector branches use is optional – over-approximating
     * here trades a missed error for never demanding a parameter the caller's
     * branch has no use for.
     */
    optional?: boolean;
    /**
     * Selector branches this parameter lives under, outermost first. Lets a
     * generator emit a discriminated payload instead of the flat
     * `optional: true` approximation; a generator that doesn't care can ignore it.
     */
    when?: readonly { param: string; branch: string }[];
  };

  /** Diagnostic context for an extractor. Neither official parser needs it to extract. */
  export type ExtractContext = {
    key?: Key;
    locale?: Locale;
  };

  /**
   * Reports the parameters a message expects. This is the BUILD-TIME half of
   * the parser contract and is deliberately not a member of `T`: a message
   * scanner attached to the runtime parser object could never be shaken out of
   * a browser bundle. A parser ships it from its own subpath instead, and the
   * core never calls it.
   *
   * Values that are not messages the parser recognizes yield no parameters
   * rather than throwing – translation leaves are arbitrary data.
   */
  export type ExtractParams = (message: Value, context?: ExtractContext) => readonly ParamSpec[];

  /**
   * Builds an `ExtractParams` from the same options the runtime parser takes.
   * Options decide what a message means – a custom modifier or a disabled tag
   * syntax changes which parameters exist – so a generator has to construct the
   * extractor the way the app constructs its parser.
   */
  export type ExtractParamsFactory<O = unknown> = (options?: O) => ExtractParams;
}

export namespace Schema {
  /**
   * A schema types calls only when its keys form a specific, closed set. An
   * untyped value, an empty object or an open index signature would otherwise
   * reject every key or demand a payload for keys it knows nothing about, so
   * they degrade to no schema at all.
   */
  type HasClosedKeys<S> = [keyof S & string] extends [never]
    ? false
    : string extends keyof S ? false : true;

  /** The key schema carried by a config; `never` when there is none to use. */
  export type FromConfig<C> = C extends { schema?: infer S extends object }
    ? (HasClosedKeys<S> extends true ? S : never)
    : never;

  /** The keys a schema allows; any string when there is no schema. */
  export type Key<S> = [S] extends [never] ? string : keyof S & string;

  type IsAny<T> = 0 extends 1 & T ? true : false;

  /**
   * What satisfies every member of a union — see `Params`. An empty union stays
   * `never`: no member means no payload, not an unconstrained one.
   */
  type UnionToIntersection<U> = [U] extends [never] ? never : (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

  /**
   * The parser's own params minus the payload slot the schema takes over. A
   * params tuple that is unknown or open-ended contributes no trailing slots –
   * keeping its rest open would let any number of junk arguments through.
   */
  type Trailing<P extends Parser.Params> = number extends P['length']
    ? []
    : P extends readonly [unknown?, ...infer R] ? R : [];

  /**
   * The payload argument, spliced into slot 0 of the parser's params so the
   * parser's trailing slots (ICU `formats`, for instance) survive. A payload
   * that carries no value marks a message without parameters; one with no
   * REQUIRED property, or one the schema marks `Optional`, may be omitted.
   * A schema value of `any` keeps the slot unchecked rather than forbidding it.
   */
  export type Payload<P extends Parser.Params, V, Optional extends boolean = false> = IsAny<V> extends true
    ? [payload?: any, ...Trailing<P>]
    : [V] extends [void | null]
      ? [payload?: undefined, ...Trailing<P>]
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      : true extends Optional | ({} extends V ? true : never)
        ? [payload?: V, ...Trailing<P>]
        : [payload: V, ...Trailing<P>];

  /**
   * Rest params for `key` — the parser's own params when there is no schema.
   * A union of keys takes the INTERSECTION of their payloads, since one call
   * has to satisfy every key it might be.
   */
  export type Params<S, K extends string, P extends Parser.Params> = [S] extends [never]
    ? P
    : [K] extends [keyof S]
      ? Payload<P, UnionToIntersection<Exclude<S[K & keyof S], undefined>>, undefined extends S[K & keyof S] ? true : false>
      : P;
}

export namespace Translations {
  export type Locales<T = string> = T[];

  export type SerializedTranslations = LocaleIndexed<DotNotation.Input>;

  export type TranslationFunction<P extends Parser.Params = Parser.Params, O = string, S = never> = <K extends Schema.Key<S>>(key: K, ...restParams: Schema.Params<S, K, P>) => O;

  export type LocalTranslationFunction<P extends Parser.Params = Parser.Params, O = string, S = never, L extends string = string> = <K extends Schema.Key<S>>(locale: Config.LocaleInput<L>, key: K, ...restParams: Schema.Params<S, K, P>) => O;

  export type Input<V = any> = { [K in any]: Input<V> | V };

  export type LocaleIndexed<V> = { [locale: string]: V };

  export type T<V = any> = LocaleIndexed<Input<V>>;
}
