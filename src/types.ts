import type { I18n } from './I18n.svelte.js';

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
    | (C extends { loaders: readonly { locale: infer L }[] } ? LoaderLocales<L> : never)
    | (C extends { translations: infer T } ? keyof T & string : never)
    | LocaleProp<C, 'initLocale'>
    | LocaleProp<C, 'fallbackLocale'>;

  /** A loader's `locale`, spelled as one locale or as several. */
  type LoaderLocales<L> = L extends readonly (infer M)[] ? M : L;

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
     * You can use loaders to define your asyncronous translation load. All loaded data are stored so loader is triggered only once – in case there is no previous version of the translation. It can get triggered again when the params its `routes` capture change, once the `config.cache` window elapses, or after `invalidate()` is called. A loader with `cache: false` runs on every load trigger that selects it.
     */
    loaders?: readonly Loader.LoaderModule[];
    /**
     * Locale-indexed translations, in place before any loader runs. They seed the tables: they record nothing, so the loaders of a namespace they name still run and their data merges in. Useful for static pages and synchronous translations – for example locally defined language names which are the same for all of the language mutations. Hand server-rendered data over with `hydrate()` instead.
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
     * The path the app is served under – SvelteKit's `kit.paths.base`, spelled
     * as it appears in `url.pathname`. Every route handed in (`setRoute()`,
     * `loadTranslations()`) loses it on the way in, on a segment boundary only:
     * under `/repo`, `/repo/about` is `/about` and `/repo` is `/`, while
     * `/repository` and a route without it pass through. So loader `routes`,
     * the `route` a loader receives and the snapshot's route never carry it.
     *
     * @example
     * // .env: PUBLIC_BASE_PATH= (defined even when empty; the build's environment sets it)
     * // svelte.config.js: kit: { paths: { base: process.env.PUBLIC_BASE_PATH ?? '' } }
     * import { PUBLIC_BASE_PATH } from '$env/static/public';
     *
     * const config = { basePath: PUBLIC_BASE_PATH, loaders };
     */
    basePath?: string;
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

declare const operator: unique symbol;

export namespace Extension {
  export type Input = any;

  export type Output = any;

  /**
   * An extension is a plain function over the constructed surface. It may
   * augment its input in place and return it, or return a brand-new surface —
   * the constructor just folds the instance through the configured extensions.
   */
  export type T<I = Input, O = Output> = (input: I) => O;

  /**
   * The build-time half of an extension whose output shape depends on the
   * surface it receives. Extend it and express the result through `this`:
   *
   * ```ts
   * interface WithStores extends Extension.Operator {
   *   readonly output: this['input'] & { subscribe(): void };
   * }
   * ```
   *
   * A plain `(input: I) => O` pair cannot carry that dependency. Reading a
   * generic signature instantiates its type parameters at their constraints,
   * so the pipe would fold the constraint rather than the instance and the
   * surface it was handed would be erased.
   */
  export interface Operator {
    readonly input: unknown;
    readonly output: unknown;
  }

  /** Applies an `Operator` to the surface reaching it. */
  export type Apply<O extends Operator, Instance> = (O & { readonly input: Instance })['output'];

  /**
   * An extension typed by an `Operator` instead of by a fixed return type.
   * The brand is type-only and optional, so the function is written as usual:
   *
   * ```ts
   * const withStores: Extension.Generic<WithStores> = (i18n) => ...;
   * ```
   */
  export type Generic<O extends Operator> = T & { readonly [operator]?: O };

  /** The `extensions` tuple carried by a config; `[]` when absent. */
  export type FromConfig<C> = C extends { extensions: infer E extends readonly T[] } ? E : [];

  /**
   * Folds a surface type through an extension tuple, left to right — the
   * construction-time type of `new I18n(config)`. An `Operator`-branded
   * extension is applied to the surface reaching it; a plain one contributes
   * its declared return type, erasing what came before. A non-tuple
   * `extensions` array (or none at all) degrades to the plain instance type.
   */
  export type Piped<Instance, Extensions> = Extensions extends readonly [infer Head, ...infer Rest]
    ? Piped<Head extends { readonly [operator]?: infer O extends Operator }
      ? Apply<O, Instance>
      : Head extends T<any, infer Out> ? Out : Instance, Rest>
    : Instance;
}

export namespace Loader {
  export type Key = string;

  export type Locale = Config.Locale;

  /**
   * Anything with a `test` method can act as a route matcher. It receives the
   * bare route path (e.g. `/products/123`) without `config.basePath`, so a matcher built around a full
   * URL has to be wrapped in a predicate that supplies the origin itself.
   */
  export type RouteMatcher = {
    test: (route: string) => boolean;
  };

  export type Route = string | RegExp | RouteMatcher;

  /** The named capture groups a route pattern matched, by name. */
  export type Params = Record<string, string>;

  /** The load context every loader is called with. */
  export type Props = {
    /**
     * Sanitized locale this loader run fetches translations for.
     */
    locale: Locale;
    /**
     * Namespace this loader run fetches translations for – one call per
     * namespace, even when the loader names several.
     */
    namespace: Key;
    /**
     * Route the load was triggered for, without `config.basePath`.
     */
    route: string;
    /**
     * The named capture groups of the first route pattern in `routes` that
     * matched `route` – `{}` for a loader without `routes`, for a string route
     * and for a `RouteMatcher`. A loader runs again when they change.
     */
    params: Params;
  };

  type LoaderModuleBody = {
    /**
     * Function returning a `Promise` with translation data. You can use it to load files locally, fetch it from your API etc...
     * It must not await a load of the same instance: that load can be the one waiting for it, which then never settles.
     *
     * Whatever it throws is logged and the rest of the load lands without this loader's data – except SvelteKit's `redirect()` and `error()` below 500,
     * told by their shape: an integer `status` from 300 to 308 with a string `location`, or from 400 to 499 with an object `body`, each an own property
     * of a value that is neither an `Error` of this realm nor tagged `'Error'` (a thrown `Response` fails soft).
     *
     * Those are logged too, and reject the load with the thrown value once its other loaders have settled. The locale does not advance, and the
     * rejected call is undone: its requested locale, route and route params go back to what it replaced – as do those of a call whose control flow it
     * replaced – unless a later call that has not failed came in the meantime. A locale or a route nothing was asked for before stands. The request
     * put back activates once a load of it settles: its own, if it is still in flight, or else the next trigger's. What the other loaders delivered is kept without activating anything, unless it was
     * fetched for params the route no longer asks for.
     *
     * An activating load a later call replaced – with another locale, or with other params for this loader – resolves without the control flow.
     * Nothing replaces a warm load's, unless it shares the load of an activating call, whose outcome it then gets. What a loader throws is discarded,
     * like its data, when an invalidation, a reconfiguration or `destroy()` severed it before the load settled.
    */
    loader: T;
    /**
    * Define routes this loader should be triggered for. You can use Regular expressions or any object with a `test` method too. For example `[/\/.ome/]` will be triggered for `/home` and `/rome` route as well (but still only once per set of params, unless the loader sets `cache: false`). The routes are matched without `config.basePath`. Leave this `undefined` in case you want to load this module with any route (useful for common translations).
    *
    * Named capture groups in a route `RegExp` are load parameters: their matches reach the loader as `Props.params`, and the loader runs again when they change, its data replacing what it delivered for the previous ones. Use a non-capturing group (`(?:...)`) where you only need grouping.
    */
    routes?: readonly Route[];
    /**
    * Set to `false` when the loader's source does the caching – a SvelteKit remote `query`, an SWR layer, an HTTP cache. The core then keeps no freshness of its own for it: it runs on every load trigger that selects it, its data is applied each time like any refetch, and `config.cache` does not apply to it – refreshing the source is the app's business. Data hydrated from a snapshot still holds it back for the pass it arrived with, until an activating trigger asks for another locale or route; `invalidate()` ends that hand-off and discards a fetch of it in flight. Only `false` is accepted.
    */
    cache?: false;
  };

  /**
   * The namespace a loader loads into, under either name. A union rather than
   * two optional properties so the compiler keeps what one required property
   * gave: a loader names exactly one, and naming both is rejected instead of
   * resolved by a precedence rule.
   */
  type Named =
    | {
      /**
       * Represents the translation namespace. It is used as a translation prefix so it should be module-unique. You can access your translation later using `t('namespace.yourTranslation')`. It shouldn't include `.` (dot) character.
       *
       * Several namespaces may be listed: the loader is then called once per namespace (and per locale), with the one it is loading in `Props.namespace`.
       */
      namespace: Key | readonly Key[];
      key?: never;
    }
    | {
      /**
       * @deprecated Renamed to `namespace`. Still honored; scheduled for removal in the next major.
       */
      key: Key;
      namespace?: never;
    };

  export type LoaderModule = LoaderModuleBody & Named & {
    /**
     * Locale (e.g. `en`, `de`) which is this loader for. Several locales may be listed: the loader is then called once per locale (and per namespace), with the one it is loading in `Props.locale`.
     */
    locale: Locale | readonly Locale[];
  };

  /**
   * A loader module after `resolveLoaders`: one per locale and namespace pair
   * the module names, with its namespace settled under one name and its locale
   * sanitized.
   */
  export type Resolved = LoaderModuleBody & {
    locale: Locale;
    namespace: Key;
    /**
     * Names this loader outside the process that resolved it, derived by base
     * from the loader's locale, namespace and routes – never declared by a
     * loader. Equal for equal content, across processes. `null` when another
     * loader resolves to the same content (a `RouteMatcher` contributes its
     * form, not its behavior), so the name would not tell the two apart.
     */
    id: string | null;
  };

  /**
   * Loads translation data. Receives the load context (`locale`, `namespace`, `route`, `params`) –
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

  /**
   * Called on the `t`/`l` path and nowhere else – never during loading,
   * preprocessing, serialization or hydration. What it returns reaches the
   * caller of `t`/`l` and nothing else: the core does not inspect, transform
   * or serialize it.
   */
  export type Parse<P extends Parser.Params = Parser.Params, O = Output> = (
    /**
     * Translation value from the definitions, read as an own property and
     * already preprocessed. Arbitrary data – a string in the ordinary case and
     * whatever a loader returned otherwise. Never `undefined`: a key resolving
     * to no translation in the active locale nor in the fallback is answered
     * by `fallbackValue`, and this is not called. Must not throw on whatever
     * does arrive.
     */
    value: Value,
    /**
     * The rest arguments of the `t`/`l` call. An argumentless call passes `[]`,
     * never `undefined`; the core neither validates nor fills it in, and a
     * `schema` narrows it at the type level only.
     */
    params: P,
    /**
     * Locale of translated message, normalized by `sanitizeLocales` where that
     * yields one and as the caller spelled it otherwise. Never `undefined` –
     * with no locale there is nothing to look up and this is not called at
     * all.
     */
    locale: Locale,
    /**
     * This key is serialized path to translation (e.g., `home.content.title`)
     */
    key: Key,
  ) => O;

  export type T<P extends Parser.Params = Parser.Params, O = Output> = {
    /**
     * Parse function deals with interpolation of user payload and returns
     * interpolated message. The message FORMAT is the parser's own – syntax,
     * missing-parameter rendering, pluralization, formatting and escaping are
     * out of the core's contract and differ between parsers. What the contract
     * requires is that none of them throws: a parser is a public edge and this
     * package fails soft at its edges.
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
   * a browser bundle. A parser ships it as a separate export instead – one a
   * bundle that never reaches it drops – and the core never calls it.
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

  /**
   * The key schema an instance was built with; `never` when it carries none.
   * The counterpart of `FromConfig` for code handed a constructed surface
   * rather than a config — an extension typing its own output, for instance.
   *
   * Read off the class type parameter rather than off the shape of `t`: an
   * extension that retypes `t` by intersection leaves a structural read
   * unable to pick the schema out of the intersected signature, while the
   * instance itself stays a member of that intersection.
   */
  export type FromInstance<I> = I extends I18n<any, any, infer S, any> ? S : never;

  /** The keys a schema allows; any string when there is no schema. */
  export type Key<S> = [S] extends [never] ? string : keyof S & string;

  type IsAny<T> = 0 extends 1 & T ? true : false;

  /**
   * What satisfies every key in `K` — see `Params`. The fold runs over the
   * KEYS, so each key's own payload reaches the intersection whole; folding
   * over the payloads instead would collapse a single key's discriminated
   * union to `never` and type the message as parameterless. A key that carries
   * no payload contributes nothing rather than erasing the others, and an
   * empty union stays `never`: no member means no payload, not an
   * unconstrained one.
   */
  type BoxedPayload<S, K extends string> = K extends keyof S
    ? [Exclude<S[K], undefined>] extends [never] ? never : (payload: Exclude<S[K], undefined>) => void
    : never;

  type PayloadOf<S, K extends string> = [BoxedPayload<S, K>] extends [never]
    ? never
    : BoxedPayload<S, K> extends (payload: infer V) => void ? V : never;

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
      ? Payload<P, PayloadOf<S, K>, undefined extends S[K & keyof S] ? true : false>
      : P;
}

export namespace Snapshot {
  /**
   * A loader that delivered on the instance a snapshot was taken of: its
   * `Loader.Resolved.id`, and the signature of the route params it delivered
   * for – left out when its routes captured none.
   */
  export type LoadRecord = { id: string; signature?: string };

  /**
   * What `snapshot({ records: true })` returns and `hydrate()` applies. Plain
   * data throughout – strings, arrays and plain objects – so `devalue`, the
   * serializer SvelteKit hands load data to, accepts it. Its locales are held
   * sanitized and are not sanitized again, and `locale` and `route` are applied
   * as they are, so take it from the server: the whole envelope from
   * `snapshot({ records: true })`, or for a plain hand-off the data of
   * `snapshot()` with the server's `i18n.locale`.
   */
  export type Envelope = {
    /** What the instance held for its active locale and the fallback locale, shaped like `config.translations`. */
    translations: Translations.SerializedTranslations;
    /**
     * The loaders that delivered, which `hydrate()` keeps from running again
     * for the same params – one with `cache: false` only for the pass the
     * envelope arrived with. Without it, the data is handed over as plain data:
     * it keeps every loader without params of every namespace it names from
     * running, and holds one with `cache: false` back for that pass.
     */
    records?: LoadRecord[];
    /** The active locale. */
    locale?: string;
    /** The current route, without `config.basePath`. */
    route?: string;
  };
}

export namespace Translations {
  export type Locales<T = string> = T[];

  export type SerializedTranslations = LocaleIndexed<DotNotation.Input>;

  /**
   * What `t`/`l` yield. The parser's output on the paths that reach the parser,
   * and a plain string on the ones that cannot: an empty key, no locale, or a
   * config carrying no parser. `O` is `string` for every parser that returns
   * one, which collapses the union everywhere it is not needed.
   */
  export type Translated<O> = O | string;

  export type TranslationFunction<P extends Parser.Params = Parser.Params, O = string, S = never> = <K extends Schema.Key<S>>(key: K, ...restParams: Schema.Params<S, K, P>) => Translated<O>;

  export type LocalTranslationFunction<P extends Parser.Params = Parser.Params, O = string, S = never, L extends string = string> = <K extends Schema.Key<S>>(locale: Config.LocaleInput<L>, key: K, ...restParams: Schema.Params<S, K, P>) => Translated<O>;

  export type Input<V = any> = { [K in any]: Input<V> | V };

  export type LocaleIndexed<V> = { [locale: string]: V };

  export type T<V = any> = LocaleIndexed<Input<V>>;
}
