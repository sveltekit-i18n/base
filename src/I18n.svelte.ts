import { fetchTranslations, hasOwn, mergeTranslations, omitProtoKeys, paramsSignature, read, resolveLoaders, routeParams, sanitizerFactory, sanitizeTranslationLocales, serialize, testRoute, toDotNotation, translate, unique } from './utils.js';
import type { Delivery, LoadRequest } from './utils.js';
import { logError, logger, loggerFactory, setLogger } from './logger.js';

import type { Config, Extension, Loader, Parser, Schema, Translations } from './types.js';

const defaultCache = Number.POSITIVE_INFINITY;

type NamespaceRecords = Translations.LocaleIndexed<Loader.Key[]>;

/** A top-level key holding part of `namespace` — the namespace itself or a key flattened out of it. */
const isNamespaceKey = (key: string, namespace: Loader.Key) => key === namespace || key.startsWith(`${namespace}.`);

/**
 * The config as it is held, rather than as it arrives: `resolveLoaders` has
 * already settled which name each descriptor spelled its namespace under.
 */
type HeldConfig<P extends Parser.Params, O> = Omit<Config.T<P, O>, 'loaders'> & { loaders?: Loader.Resolved[] };

class I18nCore<ParserParams extends Parser.Params = any, ParserOutput = string, TranslationSchema = never, LocaleUnion extends string = string> {
  // -- reactive state ---------------------------------------------------------

  #config = $state<HeldConfig<ParserParams, ParserOutput> | undefined>(undefined);

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

  // Load records keep a loader from running twice. A loader's own record holds
  // the params signature it last delivered for; a namespace record stands for
  // data that reached the instance without a loader, and keeps the namespace's
  // loaders from fetching it again unless their params ask for other data.
  #loaderRecords = new Map<Loader.Resolved, string>();

  // Null prototype: these tables are indexed by user-supplied locales, and a
  // plain object would resolve a '__proto__' assignment via the setter.
  #namespaceRecords: NamespaceRecords = Object.create(null);

  // What each source last put into a namespace, so a loader whose params
  // changed can replace its own part and leave its siblings' in place. Kept
  // apart from the records: invalidation drops those, not what is displayed,
  // and a reconfiguration hands them on to the loaders with the same id.
  #deliveries = new Map<Loader.Resolved, Delivery>();

  #externalTranslations: Translations.SerializedTranslations = {};

  // The params signature the latest activating trigger asked each loader for.
  // Loads settle out of order, and a delivery for params the route no longer
  // asks for must not replace what it displays; a warm load asks for nothing.
  #wanted = new Map<Loader.Resolved, string>();

  /** When each locale first received data — drives the `cache` expiry. */
  #loadedAt: Translations.LocaleIndexed<number> = Object.create(null);

  /**
   * In-flight loads keyed by locale and route; duplicate triggers share the
   * promise. `activate` is set by the first activating trigger, so a warm load
   * joined by one activates when it settles.
   */
  #inflight = new Map<string, { promise: Promise<void>; activate: boolean }>();

  #destroyed = false;

  constructor(config?: Config.T<ParserParams, ParserOutput>) {
    if (config) void this.loadConfig(config);

    // A constructor may return a substitute object: the instance is folded
    // through `config.extensions` left to right, so `new I18n(config)`
    // evaluates to the last extension's output. The extensions run after the
    // synchronous part of the config load — they receive a configured instance.
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

    // Loader locales are sanitized once, when the config resolves them, and
    // table locales once, when their data arrives; a custom `sanitizeLocales`
    // need not be idempotent.
    return Array.from(new Set([
      ...loaders.map(({ locale }) => locale),
      ...Object.keys(this.#translations),
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

  /** Applies a config. The public entry is `loadConfig`. */
  async #configLoader(config: Config.T<ParserParams, ParserOutput>) {
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

    const loaders = resolveLoaders(rest.loaders, rest.sanitizeLocales);

    logger.debug('Setting config.');

    this.#config = {
      initLocale: sanitizedInitLocale,
      fallbackLocale: sanitizedFallbackLocale,
      translations,
      ...rest,
      loaders,
    };

    // Report-only: the loader still runs, but `.` is the dot-notation
    // separator, so a dotted namespace collides with the flattened one.
    // `String` rather than a template literal — interpolating a Symbol throws,
    // and a config-time report must not abort the rest of the config load.
    loaders.forEach(({ namespace }) => {
      const name = namespace == null ? '' : String(namespace);

      if (name.includes('.')) {
        logger.error(`Invalid '${name}' loader namespace. It shouldn't include the '.' character.`);
      }
    });

    // A reconfiguration can swap loaders or cache policy — bookkeeping from
    // the previous config must not suppress the new loaders.
    this.invalidate();
    this.#wanted.clear();
    this.#handOnDeliveries(loaders);

    if (translations) this.addTranslations(translations);
    if (sanitizedInitLocale) await this.loadTranslations(initLocale!);
  }

  /**
   * Public entry for (re)configuration. The failure is reported here and the
   * promise marked handled, so a fire-and-forget call cannot become an
   * unhandled rejection; an awaiting caller still receives it.
   */
  loadConfig = (config: Config.T<ParserParams, ParserOutput>) => {
    if (this.#inert('loadConfig')) return Promise.resolve();

    const promise = this.#configLoader(config);

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

  /**
   * `{ activate: false }` only fills the tables: it leaves the requested
   * locale, the route and `locale` untouched and does not count towards
   * `loading` — what is rendered does not change: data of a loader whose route
   * params differ from the ones the current route asks for is discarded. It
   * leaves `cache` expiry to the next activating trigger.
   */
  loadTranslations = (
    locale: Config.LocaleInput<LocaleUnion>,
    route = this.#route ?? '',
    { activate = true }: { activate?: boolean } = {},
  ): Promise<void> => {
    if (!locale || this.#inert('loadTranslations')) return Promise.resolve();

    if (activate) {
      this.#requestedLocale = locale;
      this.#route = route;
    }

    return this.#load(locale, route, activate);
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
        delete this.#namespaceRecords[sanitized];
        delete this.#loadedAt[sanitized];

        this.#loaderRecords.forEach((_, loader) => {
          if (loader.locale === sanitized) this.#loaderRecords.delete(loader);
        });

        // Sever matching in-flight loads — applying their pre-invalidation
        // data would resurrect the bookkeeping dropped above, permanently
        // suppressing the promised refetch.
        this.#inflight.forEach((_, key) => {
          if (key.startsWith(`${sanitized}\u0000`)) this.#inflight.delete(key);
        });
      }

      return;
    }

    this.#loaderRecords.clear();
    this.#namespaceRecords = Object.create(null);
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
   * `config.translations`, so a client hydrates by passing it to
   * `addTranslations()` — the bookkeeping derived from it then keeps the
   * matching loaders from fetching the same data again. Apply it to the
   * instance rather than assigning it to `config.translations`: the payload is
   * a subset — two locales, and nothing of a key its loaders claim for another
   * route — so assigning it would drop the rest of the config's own data.
   * A literal `__proto__` key is left out: the serializer SvelteKit hands load
   * data to refuses an object that carries one.
   */
  snapshot = (): Translations.SerializedTranslations => {
    const { fallbackLocale } = this.#config ?? {};

    const route = this.#route ?? '';

    // Both are held sanitized, the way the loaders key their data.
    const locales = [this.#locale, fallbackLocale].filter((locale): locale is Config.Locale => !!locale);

    return locales.reduce<Translations.SerializedTranslations>((acc, locale) => {
      if (hasOwn(acc, locale)) return acc;

      const data = read(this.#rawTranslations, locale);

      if (!data) return acc;

      const offRoute = this.#offRouteKeys(locale, route);

      const onRoute = Object.keys(data)
        .filter((key) => !offRoute.has(key))
        .reduce((keep, key) => ({ ...keep, [key]: read(data, key) }), {});

      const relevant = omitProtoKeys(onRoute);

      if (relevant !== onRoute) {
        logger.warn(`Leaving a '__proto__' key of locale '${locale}' out of the snapshot: load data cannot carry it.`);
      }

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

  #translate(locale: Config.Locale | undefined, key: string, params: Parser.Params): Translations.Translated<ParserOutput> {
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
   * Runs the loaders a locale and route select, WITHOUT applying their data.
   * The `cache` expiry is evaluated by load triggers, not here.
   */
  async #fetch(requests: LoadRequest[], route: string): Promise<Delivery[]> {
    logger.debug('Fetching translations...');

    return fetchTranslations(requests, route);
  }

  /**
   * Gives each delivery of the previous config to the loader of the new one
   * with the same id, so its params can still replace it. What no loader can
   * take over is kept as data supplied without a loader, so a namespace rebuilt
   * later keeps it rather than losing it.
   */
  #handOnDeliveries(loaders: Loader.Resolved[]): void {
    const takers = new Map(loaders.flatMap((loader) => (loader.id === null ? [] : [[loader.id, loader] as const])));

    const deliveries = Array.from(this.#deliveries.values());

    const orphaned = deliveries.filter(({ loader }) => loader.id === null || !takers.has(loader.id));

    this.#deliveries = new Map(deliveries.flatMap((delivery) => {
      const taker = delivery.loader.id === null ? undefined : takers.get(delivery.loader.id);

      return taker ? [[taker, { ...delivery, loader: taker }]] : [];
    }));

    this.#keepExternal(serialize(orphaned.map(({ loader, data }) => ({ ...loader, data }))));
  }

  /**
   * Applies what loaders delivered and records them as loaded. A loader whose
   * params changed replaces the part of its namespace it delivered before:
   * the namespace is rebuilt from the data supplied without a loader and from
   * what each of its loaders last delivered, so no key of the previous params
   * survives and a sibling's part stays in place. The preprocessed table of a
   * locale that lost data is derived again from the raw one, since a custom
   * `preprocess` may have renamed the keys that would have to go.
   */
  #applyDeliveries(deliveries: Delivery[]): void {
    const replaced = deliveries
      .filter(({ loader, signature }) => {
        const previous = this.#deliveries.get(loader);

        return previous !== undefined && previous.signature !== signature;
      })
      .map(({ loader }) => loader);

    deliveries.forEach((delivery) => {
      this.#deliveries.set(delivery.loader, delivery);
      this.#loaderRecords.set(delivery.loader, delivery.signature);
    });

    const isReplaced = ({ locale, namespace }: Loader.Resolved) => replaced.some(
      (loader) => loader.locale === locale && loader.namespace === namespace,
    );

    const { loaders = [] } = this.#config ?? {};

    const rebuilt = loaders
      .filter(isReplaced)
      .map((loader) => this.#deliveries.get(loader))
      .filter((delivery): delivery is Delivery => delivery !== undefined);

    replaced.forEach(({ locale, namespace }) => {
      const data = read(this.#rawTranslations, locale) ?? {};

      this.#rawTranslations = {
        ...this.#rawTranslations,
        [locale]: Object.fromEntries(Object.entries(data).filter(([key]) => !isNamespaceKey(key, namespace))),
      };
    });

    const external = replaced.reduce<Translations.SerializedTranslations>((acc, { locale, namespace }) => {
      const data = read(this.#externalTranslations, locale) ?? {};

      const own = Object.fromEntries(Object.entries(data).filter(([key]) => isNamespaceKey(key, namespace)));

      if (!Object.keys(own).length) return acc;

      return { ...acc, [locale]: { ...read(acc, locale), ...own } };
    }, {});

    this.#mergeTranslations(external);
    this.#mergeTranslations(serialize([
      ...deliveries.filter(({ loader }) => !isReplaced(loader)),
      ...rebuilt,
    ].map(({ loader, data }) => ({ ...loader, data }))));

    this.#translations = unique(replaced.map(({ locale }) => locale)).reduce(
      (acc, locale) => ({ ...acc, [locale]: this.#preprocess(read(this.#rawTranslations, locale)) }),
      this.#translations,
    );
  }

  /**
   * Merges data supplied without a loader. Its namespaces are recorded as
   * loaded, so the loaders that would fetch them do not, and the data is kept
   * to rebuild a namespace a loader later replaces its part of.
   */
  #addTranslations(translations?: Translations.SerializedTranslations): void {
    if (!translations) return;

    const sanitized = sanitizeTranslationLocales(translations, this.#sanitize);

    Object.keys(sanitized).forEach((locale) => {
      // A `null` payload for a locale must not take the whole call down —
      // every step of the merge tolerates it, so this bookkeeping does too.
      const data = read(sanitized, locale) ?? {};

      this.#namespaceRecords[locale] = Array.from(new Set([
        ...(read(this.#namespaceRecords, locale) || []),
        ...Object.keys(data).map((key) => `${key}`.split('.')[0]),
      ]));
    });

    this.#keepExternal(sanitized);
    this.#mergeTranslations(sanitized);
  }

  /** Keeps data held without a loader, to rebuild a namespace from. */
  #keepExternal(sanitized: Translations.SerializedTranslations): void {
    this.#externalTranslations = Object.keys(sanitized).reduce((acc, locale) => ({
      ...acc,
      [locale]: mergeTranslations(read(acc, locale) || {}, read(sanitized, locale) ?? {}, locale),
    }), this.#externalTranslations);
  }

  /** A locale's table as `config.preprocess` asks for it. */
  #preprocess(input: any): Translations.Input {
    const { preprocess } = this.#config ?? {};

    if (typeof preprocess === 'function') return preprocess(input) ?? {};

    if (preprocess === 'none') return input ?? {};

    return toDotNotation(input, preprocess === 'preserveArrays') ?? {};
  }

  /** Merges data keyed by sanitized locales into both tables. */
  #mergeTranslations(sanitized: Translations.SerializedTranslations): void {
    logger.debug('Adding translations...');

    const translationLocales = Object.keys(sanitized);

    this.#rawTranslations = translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: mergeTranslations(read(acc, locale) || {}, read(sanitized, locale) ?? {}, locale),
      }),
      this.#rawTranslations,
    );

    this.#translations = translationLocales.reduce(
      (acc, locale) => ({
        ...acc,
        [locale]: mergeTranslations(read(acc, locale) || {}, this.#preprocess(read(sanitized, locale)), locale),
      }),
      this.#translations,
    );

    translationLocales.forEach((locale) => {
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

    if (!inputLocale && !fallbackLocale) return undefined;

    const all = this.locales;

    // Nothing to match against yet; sanitizing here would only emit a
    // non-standard warning for a lookup that cannot succeed anyway.
    if (!all.length) return undefined;

    if (inputLocale) {
      // Sanitized once per lookup rather than once per candidate locale.
      const sanitized = this.#sanitize(inputLocale);

      const match = all.find((known) => sanitized.includes(known));

      if (match) return match;
    }

    // The fallback is held sanitized.
    return fallbackLocale && all.includes(fallbackLocale) ? fallbackLocale : undefined;
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

    loaders.forEach(({ namespace, locale, routes }) => {
      if (locale !== sanitizedLocale) return;

      (routes && !routes.some(testRoute(route)) ? offRoute : onRoute).add(namespace);
    });

    onRoute.forEach((namespace) => offRoute.delete(namespace));

    return offRoute;
  }

  /**
   * The loaders of `sanitizedLocale` (and the fallback locale) whose routes
   * match `route`, with the params the route yields for each.
   */
  #matchLoaders(sanitizedLocale: Config.Locale, route: string): LoadRequest[] {
    const { loaders = [], fallbackLocale } = this.#config ?? {};

    return loaders.flatMap((loader) => {
      if (loader.locale !== sanitizedLocale && loader.locale !== fallbackLocale) return [];

      const params = routeParams(loader.routes, route);

      return params ? [{ loader, params, signature: paramsSignature(params) }] : [];
    });
  }

  /**
   * The matching loaders a load has to run: all but those whose own record
   * holds the params the route yields now. A namespace supplied without a
   * loader stands in for the record of a loader without params that has none.
   */
  #unloaded(matching: LoadRequest[]): LoadRequest[] {
    return matching.filter(({ loader, signature }) => {
      if (this.#loaderRecords.has(loader)) return this.#loaderRecords.get(loader) !== signature;

      return signature !== '' || !(read<Loader.Key[]>(this.#namespaceRecords, loader.locale) || []).includes(loader.namespace);
    });
  }

  /**
   * Starts (or joins) a load. A load already in flight for the same locale
   * and route is returned as-is, so concurrent duplicate triggers share one
   * fetch. The pending entry is registered synchronously, so `loading` is
   * observable right after the triggering call; a load with nothing to fetch
   * never registers at all, so cache-served navigations do not flicker the flag.
   * A load that does not `activate` never registers either — until an
   * activating trigger joins it.
   */
  #load(requestedLocale: Config.Locale, route: string, activate = true): Promise<void> {
    const locale = this.#resolveLocale(requestedLocale);

    if (!locale) return Promise.resolve();

    // Expiry is evaluated per activating trigger, BEFORE the in-flight check.
    // That order is safe: a locale is stamped only once its data arrived, so a
    // shared in-flight load cannot be invalidated by its own duplicates. A
    // warm trigger leaves it to the next activating one: expiry severs every
    // in-flight load of the locale, and a warm trigger records no request that
    // would restart a severed activating load.
    if (activate) this.#invalidateExpired(locale, this.#config?.fallbackLocale);

    const matching = this.#matchLoaders(locale, route);

    // Recorded before the in-flight check, so a trigger joining a load, or one
    // served from the records, still decides which params the route shows.
    if (activate) matching.forEach(({ loader, signature }) => this.#wanted.set(loader, signature));

    // NUL never appears in a sanitized locale, so the key is unambiguous.
    const inflightKey = `${locale}\u0000${route}`;
    const inflight = this.#inflight.get(inflightKey);

    if (inflight) {
      if (activate && !inflight.activate) {
        inflight.activate = true;
        this.#pending = new Set(this.#pending).add(inflight.promise);
      }

      return inflight.promise;
    }

    const requests = this.#unloaded(matching);

    if (!requests.length) {
      // Nothing to fetch — the locale still becomes active (its data is
      // already present or it has no loaders).
      if (activate) this.#activate(locale);

      return Promise.resolve();
    }

    const promise: Promise<void> = this.#fetch(requests, route).then((deliveries) => {
      // An `invalidate()` — explicit, via expiry, or via reconfiguration —
      // that raced this load severed it from `#inflight`. Its data predates
      // the invalidation: applying it would resurrect the dropped bookkeeping
      // and permanently suppress the promised refetch.
      if (this.#inflight.get(inflightKey) !== entry) return;

      // Released before the load settles: a trigger arriving in between must
      // not join a load whose activation step has already run — it finds the
      // data recorded and activates at once.
      this.#inflight.delete(inflightKey);

      const wanted = deliveries.filter(({ loader, signature }) => (this.#wanted.get(loader) ?? signature) === signature);

      if (wanted.length) this.#applyDeliveries(wanted);

      // A load that delivered params the route no longer asks for leaves the
      // activation to the load of the params it asks for.
      if (entry.activate && wanted.length === deliveries.length) this.#activate(locale);
    });

    const entry = { promise, activate };

    this.#inflight.set(inflightKey, entry);
    if (activate) this.#pending = new Set(this.#pending).add(promise);

    const settle = () => {
      // Guarded by identity — a later load under the same key must not be
      // evicted by this one settling.
      if (this.#inflight.get(inflightKey) === entry) this.#inflight.delete(inflightKey);

      if (!this.#pending.has(promise)) return;

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
