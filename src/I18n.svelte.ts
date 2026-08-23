import { fetchTranslations, hasOwn, mergeTranslations, read, resolveLoaders, sanitizerFactory, sanitizeTranslationLocales, testRoute, toDotNotation, translate } from './utils.js';
import { logError, logger, loggerFactory, setLogger } from './logger.js';

import type { Config, Extension, Loader, Parser, Schema, Translations } from './types.js';

const defaultCache = Number.POSITIVE_INFINITY;

type LoadedKeys = Translations.LocaleIndexed<Loader.Key[]>;

class I18nCore<ParserParams extends Parser.Params = any, ParserOutput = string, TranslationSchema = never, LocaleUnion extends string = string> {
  // -- reactive state ---------------------------------------------------------

  #config = $state<Config.T<ParserParams, ParserOutput> | undefined>(undefined);

  /** The ACTIVE locale — advances only after its translations resolved. */
  #locale = $state<Config.Locale | undefined>(undefined);

  /** The locale most recently asked for; loads fire once a route exists too. */
  #requestedLocale = $state<Config.Locale | undefined>(undefined);

  #route = $state<string | undefined>(undefined);

  #rawTranslations = $state<Translations.SerializedTranslations>({});

  #translations = $state<Translations.SerializedTranslations>({});

  /** Replaced immutably on every change so `loading` recomputes. */
  #pending = $state<ReadonlySet<Promise<void>>>(new Set());

  /** Locale normalization, as `config.sanitizeLocales` asks for it. */
  #sanitize = $derived(sanitizerFactory(this.#config?.sanitizeLocales));

  // -- plain internal state ---------------------------------------------------

  // Null prototype: these tables are indexed by user-supplied locales, and a
  // plain object would resolve a '__proto__' assignment via the setter.
  #loadedKeys: LoadedKeys = Object.create(null);

  /** When each locale first received data — drives the `cache` expiry. */
  #loadedAt: Translations.LocaleIndexed<number> = Object.create(null);

  /** In-flight loads keyed by locale and route; duplicate triggers share the promise. */
  #inflight = new Map<string, Promise<void>>();

  #destroyed = false;

  constructor(config?: Config.T<ParserParams, ParserOutput>) {
    if (config) void this.loadConfig(config);

    // A constructor may return a substitute object: the instance is folded
    // through `config.extensions` left to right, so `new I18n(config)`
    // evaluates to the last extension's output. The extensions run after the
    // synchronous part of `configLoader` — they receive a configured instance.
    return (config?.extensions ?? []).reduce<any>((acc, extension) => extension(acc), this);
  }

  // -- reactive reads ---------------------------------------------------------

  /**
   * The active locale. Reading it is reactive; assigning it is a shorthand for
   * a fire-and-forget `setLocale()` — the value therefore updates once the
   * locale's translations resolved, not synchronously on assignment.
   */
  get locale(): Config.LocaleInput<LocaleUnion> | undefined {
    return this.#locale;
  }

  set locale(value: Config.LocaleInput<LocaleUnion> | undefined) {
    if (value) void this.setLocale(value);
  }

  get translations(): Translations.SerializedTranslations {
    return this.#translations;
  }

  get rawTranslations(): Translations.SerializedTranslations {
    return this.#rawTranslations;
  }

  loading: boolean = $derived(this.#pending.size > 0);

  locales: Config.LocaleInput<LocaleUnion>[] = $derived.by(() => {
    if (!this.#config) return [];

    const { loaders = [] } = this.#config;

    const loaderLocales = loaders.map(({ locale }) => locale);
    const translationLocales = Object.keys(this.#translations);

    return Array.from(new Set([
      ...this.#sanitize(...loaderLocales),
      ...this.#sanitize(...translationLocales),
    ]));
  });

  initialized: boolean = $derived(
    this.#locale !== undefined && this.#route !== undefined && Object.keys(this.#translations).length > 0,
  );

  /**
   * Translates `key` for the active locale. Reactive on two levels: the
   * returned function reads the tables at CALL time, so a destructured `t`
   * keeps translating against live state, and its identity is refreshed
   * whenever the config, the tables or the locale change, so merely holding
   * the reference is tracked too.
   */
  t: Translations.TranslationFunction<ParserParams, ParserOutput, TranslationSchema> = $derived.by(() => {
    void this.#config;
    void this.#translations;
    void this.#locale;

    return (key, ...params) => this.#translate(this.#locale, key, params);
  });

  /** Like `t`, for an explicit locale. */
  l: Translations.LocalTranslationFunction<ParserParams, ParserOutput, TranslationSchema, LocaleUnion> = $derived.by(() => {
    void this.#config;
    void this.#translations;

    return (locale, key, ...params) => {
      const [sanitizedLocale = locale] = this.#sanitize(locale);

      return this.#translate(sanitizedLocale, key, params);
    };
  });

  // -- configuration ----------------------------------------------------------

  /**
   * Applies a config. Overridable extension seam — `sveltekit-i18n` wires its
   * default parser by extending this method.
   */
  async configLoader(config: Config.T<ParserParams, ParserOutput>) {
    if (!config) {
      logger.error('No config provided!');
      return;
    }

    // `extensions` is a construction-time directive, not configuration state —
    // it is consumed by the constructor and must not land in `#config`.
    const { initLocale, fallbackLocale, translations, log, extensions, ...rest } = config;

    if (log) setLogger(loggerFactory(log));

    const sanitize = sanitizerFactory(rest.sanitizeLocales);

    const [sanitizedInitLocale] = sanitize(initLocale);
    const [sanitizedFallbackLocale] = sanitize(fallbackLocale);

    const loaders = resolveLoaders(rest.loaders);

    logger.debug('Setting config.');

    this.#config = {
      initLocale: sanitizedInitLocale,
      fallbackLocale: sanitizedFallbackLocale,
      translations,
      ...rest,
      loaders,
    };

    // Report-only: the loader still runs, but `.` is the dot-notation
    // separator, so a dotted key collides with the flattened namespace.
    // `String` rather than a template literal — interpolating a Symbol throws,
    // and a config-time report must not abort the rest of the config load.
    loaders.forEach(({ key }) => {
      const name = key == null ? '' : String(key);

      if (name.includes('.')) {
        logger.error(`Invalid '${name}' loader key. It shouldn't include the '.' character.`);
      }
    });

    // A reconfiguration can swap loaders or cache policy — bookkeeping from
    // the previous config must not suppress the new loaders.
    this.invalidate();

    if (translations) this.addTranslations(translations);
    if (sanitizedInitLocale) await this.loadTranslations(sanitizedInitLocale);
  }

  /**
   * Public entry for (re)configuration. The failure is reported here and the
   * promise marked handled, so a fire-and-forget call cannot become an
   * unhandled rejection; an awaiting caller still receives it.
   */
  loadConfig = (config: Config.T<ParserParams, ParserOutput>) => {
    if (this.#inert('loadConfig')) return Promise.resolve();

    const promise = this.configLoader(config);

    promise.catch((error) => logError('Failed to load the i18n config.', error));

    return promise;
  };

  // -- loading ----------------------------------------------------------------

  setLocale = (locale?: Config.LocaleInput<LocaleUnion>): Promise<void> => {
    if (!locale || this.#inert('setLocale')) return Promise.resolve();

    if (locale !== this.#requestedLocale) {
      logger.debug(`Setting '${locale}' locale.`);

      this.#requestedLocale = locale;
    }

    // Delegated even for a repeated value — the caller awaits "this locale is
    // loaded", which may mean joining a load already in flight.
    if (this.#route !== undefined) return this.#load(locale, this.#route);

    return Promise.resolve();
  };

  setRoute = (route: string): Promise<void> => {
    if (this.#inert('setRoute')) return Promise.resolve();

    if (route !== this.#route) {
      logger.debug(`Setting '${route}' route.`);

      this.#route = route;
    }

    if (this.#requestedLocale !== undefined) return this.#load(this.#requestedLocale, route);

    return Promise.resolve();
  };

  loadTranslations = (locale: Config.LocaleInput<LocaleUnion>, route = this.#route ?? ''): Promise<void> => {
    if (!locale || this.#inert('loadTranslations')) return Promise.resolve();

    this.#requestedLocale = locale;
    this.#route = route;

    return this.#load(locale, route);
  };

  /**
   * Marks loaded translations stale — for one locale, or all of them. Loaders
   * run again on the NEXT load trigger; the call itself starts no load and
   * keeps the currently displayed translations in place. A load still in
   * flight for an invalidated locale is severed: it settles, but its data is
   * discarded — it predates the invalidation.
   */
  invalidate = (locale?: Config.LocaleInput<LocaleUnion>): void => {
    if (this.#inert('invalidate')) return;

    if (locale !== undefined) {
      const [sanitized] = this.#sanitize(locale);

      if (sanitized !== undefined) {
        delete this.#loadedKeys[sanitized];
        delete this.#loadedAt[sanitized];

        // Sever matching in-flight loads — applying their pre-invalidation
        // data would resurrect the bookkeeping dropped above, permanently
        // suppressing the promised refetch.
        this.#inflight.forEach((_, key) => {
          if (key.startsWith(`${sanitized}\u0000`)) this.#inflight.delete(key);
        });
      }

      return;
    }

    this.#loadedKeys = Object.create(null);
    this.#loadedAt = Object.create(null);
    this.#inflight.clear();
  };

  addTranslations = (translations?: Translations.SerializedTranslations): void => {
    if (this.#inert('addTranslations')) return;

    this.#addTranslations(translations);
  };

  /**
   * Serializes what this instance holds for the active locale and the fallback
   * locale, narrowed to the current route: a key owned only by loaders that do
   * not match the route is left out. The result is shaped like
   * `config.translations`, so a client hydrates by handing it back to the
   * constructor — the bookkeeping derived from it then keeps the matching
   * loaders from fetching the same data again.
   */
  snapshot = (): Translations.SerializedTranslations => {
    const { fallbackLocale } = this.#config ?? {};

    const route = this.#route ?? '';

    // `#locale` is already sanitized; the fallback is normalized the same way
    // the loaders key their data.
    const locales = [this.#locale, ...this.#sanitize(fallbackLocale)].filter((locale): locale is Config.Locale => !!locale);

    return locales.reduce<Translations.SerializedTranslations>((acc, locale) => {
      if (hasOwn(acc, locale)) return acc;

      const data = read(this.#rawTranslations, locale);

      if (!data) return acc;

      const offRoute = this.#offRouteKeys(locale, route);

      const relevant = Object.keys(data)
        .filter((key) => !offRoute.has(key))
        .reduce((keep, key) => ({ ...keep, [key]: read(data, key) }), {});

      // An empty entry would still stamp the locale's freshness on the client,
      // starting its `cache` window on data it never received.
      if (!Object.keys(relevant).length) return acc;

      return { ...acc, [locale]: relevant };
    }, {});
  };

  /**
   * Detaches the instance from its loading lifecycle: in-flight loads settle
   * with their data discarded, `loading` drops to `false`, and every further
   * load or mutation call is ignored with a warning. Reads (`t`, `l`, `locale`,
   * `translations`, `snapshot`) keep working, so a component still tearing down
   * renders its last state instead of breaking. Idempotent.
   */
  destroy = (): void => {
    if (this.#destroyed) return;

    logger.debug('Destroying the i18n instance.');

    this.#destroyed = true;

    // Severed rather than awaited — the identity guard in `#load` makes a
    // settled load apply nothing once its entry is gone.
    this.#inflight.clear();
    this.#pending = new Set();
  };

  // -- internals --------------------------------------------------------------

  #translate(locale: Config.Locale | undefined, key: string, params: Parser.Params): ParserOutput {
    const { parser, fallbackLocale, ...rest } = this.#config ?? {} as Config.T<ParserParams, ParserOutput>;

    return translate<ParserParams, ParserOutput>({
      parser,
      key,
      params,
      translations: this.#translations,
      locale,
      fallbackLocale,
      ...(hasOwn(rest, 'fallbackValue') ? { fallbackValue: rest.fallbackValue } : {}),
    });
  }

  /**
   * Resolves loader data for a locale and route WITHOUT applying it. Returns
   * `[]` when there is nothing to load. The `cache` expiry is evaluated by
   * load triggers, not here.
   */
  async #getTranslationProps(
    locale: Config.Locale,
    route: string,
  ): Promise<[Translations.SerializedTranslations, LoadedKeys] | []> {
    if (!this.#config || !locale) return [];

    const [sanitizedLocale] = this.#sanitize(locale);
    const filteredLoaders = this.#filterLoaders(sanitizedLocale, route);

    if (!filteredLoaders.length) return [];

    logger.debug('Fetching translations...');

    const rawTranslations = await fetchTranslations(filteredLoaders, route);

    const loadedKeys = Object.entries(rawTranslations).reduce(
      (acc, [translationLocale, data]) => ({ ...acc, [translationLocale]: Object.keys(data ?? {}) }),
      {} as LoadedKeys,
    );

    const keys = filteredLoaders
      .filter(({ key, locale: loaderLocale }) => (read<Loader.Key[]>(loadedKeys, loaderLocale) || []).some(
        // Exact or namespaced match only — `navbar` data must not mark a
        // sibling `nav` loader as loaded.
        (loadedKey) => `${loadedKey}` === key || `${loadedKey}`.startsWith(`${key}.`),
      ))
      .reduce<LoadedKeys>((acc, { key, locale: loaderLocale }) => ({
        ...acc,
        [loaderLocale]: [...(read<Loader.Key[]>(acc, loaderLocale) || []), key],
      }), {});

    return [rawTranslations, keys];
  }

  /**
   * Merges translations into the tables and registers their bookkeeping.
   * `keys` carries the exact loader keys of a load; without it (the public
   * `addTranslations` path) loaded keys derive from the data's top-level keys.
   */
  #addTranslations(translations?: Translations.SerializedTranslations, keys?: LoadedKeys): void {
    if (!translations) return;

    const { preprocess } = this.#config ?? {};

    logger.debug('Adding translations...');

    const sanitized = sanitizeTranslationLocales(translations, this.#sanitize);

    const translationLocales = Object.keys(sanitized);

    this.#rawTranslations = translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: mergeTranslations(read(acc, locale) || {}, read(sanitized, locale) ?? {}, locale),
      }),
      this.#rawTranslations,
    );

    this.#translations = translationLocales.reduce(
      (acc, locale) => {
        let dotnotate = true;
        let input = read(sanitized, locale);

        if (typeof preprocess === 'function') {
          input = preprocess(input);
        }

        if (typeof preprocess === 'function' || preprocess === 'none') {
          dotnotate = false;
        }

        return ({
          ...acc,
          [locale]: mergeTranslations(
            read(acc, locale) || {},
            (dotnotate ? toDotNotation(input, preprocess === 'preserveArrays') : input) ?? {},
            locale,
          ),
        });
      },
      this.#translations,
    );

    translationLocales.forEach((locale) => {
      // A `null` payload for a locale must not take the whole call down —
      // every step above tolerates it, so this bookkeeping does too.
      let localeKeys: Loader.Key[] | undefined = Object.keys(read(sanitized, locale) ?? {}).map((key) => `${key}`.split('.')[0]);
      if (keys) localeKeys = read(keys, locale);

      this.#loadedKeys[locale] = Array.from(new Set([
        ...(read(this.#loadedKeys, locale) || []),
        ...(localeKeys || []),
      ]));

      // Freshness is measured from the locale's FIRST data — later partial
      // loads (other routes) must not extend the window.
      if (read(this.#loadedAt, locale) === undefined) this.#loadedAt[locale] = Date.now();
    });
  }

  /** Reports a call on a destroyed instance; `true` means "ignore the call". */
  #inert(action: string): boolean {
    if (!this.#destroyed) return false;

    logger.warn(`Ignoring '${action}' — this i18n instance was destroyed.`);

    return true;
  }

  #resolveLocale(inputLocale?: Config.Locale): Config.Locale | undefined {
    const { fallbackLocale } = this.#config ?? {};

    const locale = inputLocale || fallbackLocale;

    if (!locale) return undefined;

    const all = this.locales;

    // Nothing to match against yet; sanitizing here would only emit a
    // non-standard warning for a lookup that cannot succeed anyway.
    if (!all.length) return undefined;

    // Sanitized once per lookup rather than once per candidate locale.
    const sanitized = this.#sanitize(locale);

    const match = all.find((known) => sanitized.includes(known));

    if (match || !fallbackLocale || fallbackLocale === locale) return match;

    // Evaluated lazily: the fallback (and any non-standard warning it emits)
    // must not run when the requested locale resolves directly.
    const sanitizedFallback = this.#sanitize(fallbackLocale);

    return all.find((known) => sanitizedFallback.includes(known));
  }

  #cacheValue(): number {
    const { cache = defaultCache } = this.#config ?? {};

    return Number.isNaN(+cache) ? defaultCache : +cache;
  }

  /** Drops the bookkeeping of every given locale whose `cache` window elapsed. */
  #invalidateExpired(...locales: Array<Config.Locale | undefined>): void {
    const cacheValue = this.#cacheValue();

    locales.forEach((locale) => {
      if (!locale) return;

      const loadedAt = read<number>(this.#loadedAt, locale);

      if (loadedAt !== undefined && Date.now() >= loadedAt + cacheValue) {
        logger.debug(`'${locale}' translations expired. Loaders will run again.`);
        this.invalidate(locale);
      }
    });
  }

  /** Activates `locale` unless another request superseded its load meanwhile. */
  #activate(locale: Config.Locale): void {
    const requested = this.#resolveLocale(this.#requestedLocale);

    // An unresolvable most-recent request supersedes nothing — it must not
    // block a completed load from activating.
    if (requested !== undefined && requested !== locale) return;

    if (this.#locale !== locale) this.#locale = locale;
  }

  /**
   * Loader keys of `sanitizedLocale` that only ever load on OTHER routes. A key
   * claimed by a route-matching loader — or by no loader at all — is not
   * attributable to another route and is therefore absent here.
   */
  #offRouteKeys(sanitizedLocale: Config.Locale, route: string): Set<Loader.Key> {
    const { loaders = [] } = this.#config ?? {};

    const offRoute = new Set<Loader.Key>();
    const onRoute = new Set<Loader.Key>();

    loaders.forEach(({ key, locale, routes }) => {
      if (this.#sanitize(locale)[0] !== sanitizedLocale) return;

      (routes && !routes.some(testRoute(route)) ? offRoute : onRoute).add(key);
    });

    onRoute.forEach((key) => offRoute.delete(key));

    return offRoute;
  }

  #filterLoaders(sanitizedLocale: Config.Locale, route: string): Loader.LoaderModule[] {
    const { loaders, fallbackLocale = '' } = this.#config ?? {};

    const [sanitizedFallbackLocale] = this.#sanitize(fallbackLocale);

    const translationForLocale = read(this.#translations, sanitizedLocale);
    const translationForFallbackLocale = read(this.#translations, sanitizedFallbackLocale);

    return (loaders || [])
      .map(({ locale, ...rest }) => ({ ...rest, locale: this.#sanitize(locale)[0] }))
      .filter(({ routes }) => !routes || (routes || []).some(testRoute(route)))
      .filter(({ key, locale }) => (locale === sanitizedLocale && (
        !translationForLocale || !(read<Loader.Key[]>(this.#loadedKeys, sanitizedLocale) || []).includes(key)
      )) || (
        fallbackLocale && locale === sanitizedFallbackLocale && (
          !translationForFallbackLocale
            || !(read<Loader.Key[]>(this.#loadedKeys, sanitizedFallbackLocale) || []).includes(key)
        )
      ));
  }

  /**
   * Starts (or joins) a load. A load already in flight for the same locale
   * and route is returned as-is, so concurrent duplicate triggers share one
   * fetch. The pending entry is registered synchronously, so `loading` is
   * observable right after the triggering call; a load with nothing to fetch
   * never registers at all, so cache-served navigations do not flicker the flag.
   */
  #load(requestedLocale: Config.Locale, route: string): Promise<void> {
    const locale = this.#resolveLocale(requestedLocale);

    if (!locale) return Promise.resolve();

    // Expiry is evaluated per load trigger, BEFORE the in-flight check. That
    // order is safe: a locale is stamped only once its data arrived, so a
    // shared in-flight load cannot be invalidated by its own duplicates.
    this.#invalidateExpired(locale, this.#sanitize(this.#config?.fallbackLocale)[0]);

    // NUL never appears in a sanitized locale, so the key is unambiguous.
    const inflightKey = `${locale}\u0000${route}`;
    const inflight = this.#inflight.get(inflightKey);

    if (inflight) return inflight;

    if (!this.#filterLoaders(locale, route).length) {
      // Nothing to fetch — the locale still becomes active (its data is
      // already present or it has no loaders).
      this.#activate(locale);

      return Promise.resolve();
    }

    const promise: Promise<void> = this.#getTranslationProps(locale, route).then((props) => {
      // An `invalidate()` — explicit, via expiry, or via reconfiguration —
      // that raced this load severed it from `#inflight`. Its data predates
      // the invalidation: applying it would resurrect the dropped bookkeeping
      // and permanently suppress the promised refetch.
      if (this.#inflight.get(inflightKey) !== promise) return;

      if (props.length) this.#addTranslations(...props);

      this.#activate(locale);
    });

    this.#inflight.set(inflightKey, promise);
    this.#pending = new Set(this.#pending).add(promise);

    const settle = () => {
      // Guarded by identity — a later load under the same key must not be
      // evicted by this one settling.
      if (this.#inflight.get(inflightKey) === promise) this.#inflight.delete(inflightKey);

      const next = new Set(this.#pending);
      next.delete(promise);
      this.#pending = next;
    };
    promise.then(settle, settle);

    // Reported here so a discarded load is still visible, and marked handled so
    // it cannot terminate the process; an awaiting caller still receives the
    // rejection from the same promise.
    promise.catch((error) => logError(`Failed to load translations for '${locale}' locale and '${route}' route.`, error));

    return promise;
  }
}

/**
 * A class declaration cannot annotate its constructor's return type, so the
 * extension pipe's construction-time type lives on this construct signature
 * instead: parser params and output are inferred from `config.parser`, locales
 * are narrowed to the ones the config names, and the returned surface is the
 * instance type folded through the `config.extensions` tuple
 * (`const` keeps it a tuple without `as const` at the call site).
 */
interface I18nConstructor {
  new <const C extends Config.T<any, any> = Config.T<any, any>>(
    config?: C
  ): Extension.Piped<
    I18nCore<Parser.FromConfig<C>, Parser.OutputFromConfig<C>, Schema.FromConfig<C>, Config.LocalesFromConfig<C>>,
    Extension.FromConfig<C>
  >;
}

// The raw class is deliberately not exported — every consumer constructs
// through the extension-aware signature. The exported name carries both
// meanings: the value is the facade, the type is the un-piped instance.
const I18n = I18nCore as unknown as I18nConstructor;

type I18n<ParserParams extends Parser.Params = any, ParserOutput = string, TranslationSchema = never, LocaleUnion extends string = string> = I18nCore<ParserParams, ParserOutput, TranslationSchema, LocaleUnion>;

export { I18n };
export default I18n;
