import type { Config, DotNotation, Translations, Loader, Parser } from './types.js';
import { logError, logger } from './logger.js';

// Safe own-property read. Translation keys like `toString`, `constructor` or
// `__proto__` would otherwise resolve to inherited `Object.prototype` members
// instead of being treated as missing translations.
export const hasOwn = (obj: any, key: PropertyKey): boolean => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

// Own-property read: returns the value only when `key` is the object's own
// property, otherwise undefined. Centralizes the prototype-safe table lookup.
export const read = <T = any>(obj: any, key: PropertyKey): T | undefined => (hasOwn(obj, key) ? obj[key] : undefined);

export const translate = <P extends Parser.Params = Parser.Params, O = Parser.Output>({
  parser,
  key,
  params,
  translations,
  locale,
  fallbackLocale,
  ...rest
}: {
  parser: Parser.T<P, O>;
  key: string;
  params: Parser.Params;
  translations: Translations.SerializedTranslations;
  locale: Translations.Locales[number] | undefined;
  fallbackLocale?: Config.FallbackLocale;
  fallbackValue?: Config.FallbackValue;
}): Translations.Translated<O> => {
  if (!key) {
    logger.warn(`No translation key provided ('${locale}' locale). Skipping translation...`);
    return '';
  }

  if (!locale) {
    logger.warn(`No locale provided for '${key}' key. Skipping translation...`);
    return '';
  }

  const localeTranslations = read(translations, locale);
  let text = read(localeTranslations, key);

  if (fallbackLocale && text === undefined) {
    logger.debug(`No translation provided for '${key}' key in locale '${locale}'. Trying fallback '${fallbackLocale}'`);
    const fallbackTranslations = read(translations, fallbackLocale);
    text = read(fallbackTranslations, key);
  }

  if (text === undefined) {
    logger.debug(`No translation provided for '${key}' key in fallback '${fallbackLocale}'.`);
    if (hasOwn(rest, 'fallbackValue')) {
      return rest.fallbackValue;
    }
    logger.warn(`No translation nor fallback found for '${key}' .`);

    // There is nothing to interpolate, so no parser is asked to. Echoing the
    // key is what makes a missing translation visible instead of blank.
    return key;
  }

  if (!parser || typeof parser.parse !== 'function') {
    // Reached on every call while no parser is set (e.g. before config loads),
    // so keep it at debug to avoid flooding logs on the render path.
    logger.debug(`No parser configured. Returning raw value for '${key}' key.`);

    return text;
  }

  // A key schema narrows the rest params to one key's payload — still a `P`,
  // but no longer provably so once the tuple has been rebuilt.
  return parser.parse(text, params as P, locale, key);
};

// `Intl.Collator.supportedLocalesOf` is comparatively expensive and locales
// repeat constantly — per loader on every load trigger, per lookup.
const LOCALE_CACHE_LIMIT = 1000;
const sanitizedLocaleCache = new Map<string, string>();

// Insertion order is the eviction order, so reinserting on a hit makes it
// least-recently-used: a flood of visitor-supplied locales evicts itself
// rather than the app's own.
const recallSanitizedLocale = (locale: string) => {
  const cached = sanitizedLocaleCache.get(locale);

  if (cached === undefined) return undefined;

  sanitizedLocaleCache.delete(locale);
  sanitizedLocaleCache.set(locale, cached);

  return cached;
};

const rememberSanitizedLocale = (locale: string, sanitized: string) => {
  if (sanitizedLocaleCache.size >= LOCALE_CACHE_LIMIT) {
    sanitizedLocaleCache.delete(sanitizedLocaleCache.keys().next().value as string);
  }

  sanitizedLocaleCache.set(locale, sanitized);
};

type Sanitizer = (...locales: any[]) => Config.Locale[];

const mapLocales = (transform: (locale: any) => Config.Locale): Sanitizer => (...locales) => {
  if (!locales.length) return [];

  return locales.filter((locale) => !!locale).map(transform);
};

export const sanitizeLocales = mapLocales((locale) => {
  // Only a string is a faithful key for itself.
  const cacheable = typeof locale === 'string';

  if (cacheable) {
    const cached = recallSanitizedLocale(locale);

    if (cached !== undefined) return cached;
  }

  let current = `${locale}`.toLowerCase();
  try {
    const [sanitized] = Intl.Collator.supportedLocalesOf(locale);

    if (!sanitized) throw new Error();

    current = sanitized;

    if (cacheable) rememberSanitizedLocale(locale, current);
  } catch {
    // Deliberately not remembered: a locale Intl does not know yet can
    // recover, and the warning stays tied to the call rather than to
    // whichever logger was installed first.
    logger.warn(`'${locale}' locale is non-standard.`);
  }

  return current;
});

// The normalization `config.sanitizeLocales` asks for. A custom transform is
// consumer code and every table is keyed by what it returns, so a throwing or
// empty-handed one degrades to the locale as authored.
export const sanitizerFactory = (sanitize: Config.SanitizeLocales = true): Sanitizer => {
  if (typeof sanitize === 'function') {
    return mapLocales((locale) => {
      const input: Config.Locale = `${locale}`;

      try {
        const transformed = sanitize(input);

        if (transformed) return `${transformed}`;

        logger.warn(`'sanitizeLocales' returned no locale for '${input}'.`);
      } catch (error) {
        logError(`'sanitizeLocales' failed for '${input}' locale.`, error);
      }

      return input;
    });
  }

  if (!sanitize) return mapLocales((locale) => `${locale}`);

  return sanitizeLocales;
};

// Every other locale-keyed surface (`locale`, `fallbackLocale`, loader data,
// the loaded-key bookkeeping) is sanitized, so a table handed in under a raw
// locale would be unreachable. Merged rather than replaced: two spellings of
// one locale are one entry.
export const sanitizeTranslationLocales = (input: Translations.SerializedTranslations, sanitize: Sanitizer): Translations.SerializedTranslations => (
  Object.keys(input).reduce<Translations.SerializedTranslations>((acc, locale) => {
    const [sanitized = locale] = sanitize(locale);

    return { ...acc, [sanitized]: { ...read(acc, sanitized), ...read(input, locale) } };
  }, {})
);

// An `Accept-Language` field is visitor-controlled and unbounded, while a
// browser sends a handful of ranges — the tail of a flood carries no
// preference worth reading.
const MAX_RANGES = 100;

// RFC 4647 §4.4 lets a protocol cap a range but never below 35 characters:
// language(8) + script(5) + region(4) + two variants(18). The cap is also what
// bounds the truncation chain below.
const MAX_RANGE_LENGTH = 64;

const WILDCARD = '*';
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const ALPHANUM = `${ALPHA}0123456789`;
const QVALUE = '0123456789.';

type LanguageRange = { range: string; q: number; order: number; specificity: number };

const isSubtag = (subtag: string, allowed: string): boolean => (
  !!subtag.length && subtag.length <= 8 && [...subtag].every((char) => allowed.includes(char))
);

// RFC 4647 §2.1: `(1*8ALPHA *("-" 1*8alphanum))`. Anything else is not a range,
// which is what keeps `constructor` and a half-parsed header from becoming one.
const isLanguageRange = (range: string): boolean => {
  const [primary = '', ...rest] = range.split('-');

  return isSubtag(primary, ALPHA) && rest.every((subtag) => isSubtag(subtag, ALPHANUM));
};

const specificityOf = (range: string): number => (range === WILDCARD ? 0 : range.split('-').length);

// RFC 9110 §12.4.2: `q` is case-insensitive and its absence means 1. A weight
// that is not a number drops its own range — reading it as 1 would promote
// junk to the strongest preference, and 0 would turn it into a refusal.
const readWeight = (parameters: string[]): number | undefined => {
  const value = parameters.reduce<string | undefined>((acc, parameter) => {
    if (acc !== undefined) return acc;

    const compact = parameter.split(' ').join('').split('\t').join('').toLowerCase();

    return compact.startsWith('q=') ? compact.slice(2) : acc;
  }, undefined);

  if (value === undefined) return 1;

  // A qvalue is decimal digits and a dot; `Number` alone would also read
  // `0x10` and `1e3`, and an empty one as zero.
  if (!value.length || [...value].some((char) => !QVALUE.includes(char))) return undefined;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return undefined;

  return Math.min(1, Math.max(0, parsed));
};

const parseRanges = (field: string): LanguageRange[] => (
  // Bounded at the split rather than after it: materializing every member of a
  // hostile field would spend exactly what the cap is there to refuse.
  field.split(',', MAX_RANGES).reduce<LanguageRange[]>((acc, element, order) => {
    const [head = '', ...parameters] = element.split(';');
    const range = head.trim().toLowerCase();

    if (!range || range.length > MAX_RANGE_LENGTH) return acc;

    if (range !== WILDCARD && !isLanguageRange(range)) return acc;

    const q = readWeight(parameters);

    if (q === undefined) return acc;

    const seen = acc.find((known) => known.range === range);

    // A range repeated within one field is one preference, at the strongest
    // weight it was given.
    if (seen) return acc.map((known) => (known === seen ? { ...known, q: Math.max(known.q, q) } : known));

    return [...acc, { range, q, order, specificity: specificityOf(range) }];
  }, [])
);

// RFC 5646 §4.4.2: a single-character subtag introduces an extension or a
// private-use sequence, so it never outlives the subtag it introduced.
const withoutTrailingSingleton = (subtags: string[]): string[] => (
  subtags.at(-1)?.length === 1 ? withoutTrailingSingleton(subtags.slice(0, -1)) : subtags
);

// The range, then its progressively shorter prefixes – `zh-hant-tw`, `zh-hant`,
// `zh`. Only the REQUESTED range is ever truncated; an available locale is
// compared as it was spelled.
const prefixes = (range: string): string[] => {
  const walk = (subtags: string[]): string[] => (
    subtags.length ? [subtags.join('-'), ...walk(withoutTrailingSingleton(subtags.slice(0, -1)))] : []
  );

  return walk(range.split('-'));
};

const covers = (range: string, folded: string): boolean => range === WILDCARD || folded === range || folded.startsWith(`${range}-`);

// Weight first; at equal weight a concrete range is consulted before the
// wildcard, and the order the field spelled them in breaks what is left.
const byPreference = (a: LanguageRange, b: LanguageRange): number => (
  b.q - a.q
  || Number(a.range === WILDCARD) - Number(b.range === WILDCARD)
  || a.order - b.order
);

/**
 * Matches what a visitor asked for against the locales an app actually has.
 *
 * `requested` is an `Accept-Language` field value, a single locale, or a
 * preference list such as `navigator.languages`; `available` is the configured
 * set, and the winner is returned as IT spells it. A miss is `undefined` rather
 * than a guess – what a miss means is the caller's to decide.
 */
export const matchLocale = <const L extends string>(
  requested: string | readonly string[] | null | undefined,
  available: readonly L[],
): L | undefined => {
  // Narrowing `available` in place would widen it to `any[]` and take the
  // locale union down with it, so the guard hands the value back as it is
  // declared.
  const locales: readonly L[] = Array.isArray(available) ? available : [];

  const candidates = locales.reduce<Array<{ locale: L; folded: string }>>((acc, locale) => (
    locale && typeof locale === 'string' ? [...acc, { locale, folded: locale.toLowerCase() }] : acc
  ), []);

  if (!candidates.length) return undefined;

  // Anything that is not a field value carries no preference – an absent
  // header, a parsed body, a mistyped local. Reading one is a miss, not a throw.
  const field = typeof requested === 'string'
    ? requested
    : Array.isArray(requested)
      ? requested.slice(0, MAX_RANGES).filter((value) => typeof value === 'string').join(',')
      : '';

  const parsed = parseRanges(field);
  const refusals = parsed.filter(({ q }) => !q);

  // RFC 2616's longest-matching-range rule, reduced to the only comparison it
  // ever needs: a refusal loses to a strictly more specific positive match. A
  // refused candidate is skipped rather than blacklisted, so a later, more
  // specific range can still select it.
  const accepted = (folded: string, specificity: number): boolean => refusals.every(({ range, specificity: refused }) => (
    !covers(range, folded) || refused < specificity
  ));

  const select = (range: string): L | undefined => {
    if (range === WILDCARD) return candidates.find(({ folded }) => accepted(folded, 0))?.locale;

    const found = prefixes(range).reduce<L | undefined>((match, prefix) => match ?? candidates.find(
      ({ folded }) => folded === prefix && accepted(folded, specificityOf(prefix)),
    )?.locale, undefined);

    if (found) return found;

    // Truncation answers nothing when the available set is FINER than the
    // range, which is the other half of the gap. The range AS WRITTEN is then
    // read as a prefix – never a truncated one, so `en` reaches `en-GB` while
    // `en-GB` never reaches the sibling `en-US`.
    return candidates.find(({ folded }) => folded.startsWith(`${range}-`) && accepted(folded, specificityOf(range)))?.locale;
  };

  return parsed
    .filter(({ q }) => q > 0)
    .sort(byPreference)
    .reduce<L | undefined>((match, { range }) => match ?? select(range), undefined);
};

export const toDotNotation: DotNotation.T = (input, preserveArrays, parentKey) => {
  if (preserveArrays && Array.isArray(input)) {
    return input.map((v) => toDotNotation(v, preserveArrays));
  }

  if (input && typeof input === 'object') {
    // Mutated in place (rebuilding per key is quadratic) into a null-prototype
    // object, then spread once on the way out — a literal '__proto__' key stays
    // an own property instead of reaching the prototype setter.
    const output: any = Object.create(null);
    let hasEntries = false;

    const walk = (node: any, prefix?: string) => {
      Object.keys(node).forEach((key) => {
        const value = node[key];
        const outputKey = prefix ? `${prefix}.${key}` : `${key}`;

        if (value && typeof value === 'object' && !(preserveArrays && Array.isArray(value))) {
          walk(value, outputKey);
        } else {
          output[outputKey] = toDotNotation(value, preserveArrays);
          hasEntries = true;
        }
      });
    };

    walk(input, parentKey);

    if (hasEntries) {
      return { ...output };
    }

    return null;
  }

  return input;
};

const asList = <V>(value: V | readonly V[]): readonly V[] => (Array.isArray(value) ? value : [value as V]);

export const unique = <V>(values: readonly V[]): V[] => Array.from(new Set(values));

// Tagged by form, so a string route and a pattern with the same text differ. A
// matcher's behavior cannot be read — only that it is one.
const describeRoute = (route: Loader.Route): string => {
  if (typeof route === 'string') return `s:${route}`;

  if (route instanceof RegExp) return `r:${String(route)}`;

  return 'm';
};

// The content itself rather than a hash of it: equality stays exact, and the
// string repeats what a serialized payload already carries, so it compresses
// with it.
const loaderId = ({ locale, namespace, routes }: Omit<Loader.Resolved, 'id' | 'loader'>): string => JSON.stringify(
  routes ? [locale, namespace, routes.map(describeRoute)] : [locale, namespace],
);

// A name shared by two loaders would hand one's records to the other, so
// neither keeps it.
const withIds = (loaders: Array<Omit<Loader.Resolved, 'id'>>): Loader.Resolved[] => {
  const ids = loaders.map((loader) => {
    try {
      return loaderId(loader);
    } catch (error) {
      logError('Cannot derive an id for a loader.', error);

      return null;
    }
  });

  const counts = ids.reduce((acc, id) => acc.set(id, (acc.get(id) ?? 0) + 1), new Map<string | null, number>());

  return loaders.map((loader, index) => {
    const id = ids[index] ?? null;

    return { ...loader, id: counts.get(id) === 1 ? id : null };
  });
};

// Loader properties are consumer code — an accessor may throw. Materialized
// once at the config boundary, so a single unreadable loader costs only itself
// instead of taking down every locale-keyed read downstream. Everything a
// descriptor may spell more than one way is settled here, so nothing
// downstream knows there were several: the two names of the namespace, and a
// list of locales or namespaces, which expands into one loader per pair with
// its locale sanitized. Each loader is named by its content here too.
export const resolveLoaders = (
  input: readonly Loader.LoaderModule[] = [],
  sanitizeLocales: Config.SanitizeLocales = true,
): Loader.Resolved[] => {
  const sanitize = sanitizerFactory(sanitizeLocales);

  return withIds(input.reduce<Array<Omit<Loader.Resolved, 'id'>>>((acc, descriptor) => {
    try {
      const { namespace, key, locale, loader, routes } = descriptor;

      if (key !== undefined) logger.warn(`Loader '${String(key)}' uses 'key', which is deprecated. Rename it to 'namespace'.`);

      const namespaces = unique(asList(namespace ?? key).filter((name) => name != null));
      const locales = unique(sanitize(...asList(locale).filter((name) => name != null)));

      if (!namespaces.length || !locales.length) {
        logger.warn('Skipping a loader that names no locale or no namespace.');

        return acc;
      }

      return [
        ...acc,
        ...locales.flatMap((pairLocale) => namespaces.map((pairNamespace) => ({ namespace: pairNamespace, locale: pairLocale, loader, routes }))),
      ];
    } catch (error) {
      logError('Skipping a loader that cannot be read.', error);

      return acc;
    }
  }, []));
};

const isMergeable = (value: any): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

// Data reaching a namespace that already holds some — route-scoped chunks of
// one namespace, a later load, a second `addTranslations` — contributes to it
// instead of replacing it. Plain objects merge branch by branch; anything else
// is a leaf, and a leaf collision has no merge to perform, so the incoming
// value is kept. Only callers for which a collision means an authoring mistake
// pass `onConflict`.
export const mergeTranslations = (target: any, source: any, path: string, onConflict?: (path: string) => void): any => {
  if (!isMergeable(target) || !isMergeable(source)) {
    onConflict?.(path);

    return source;
  }

  return Object.keys(source).reduce((acc, key) => ({
    ...acc,
    [key]: hasOwn(acc, key) ? mergeTranslations(read(acc, key), read(source, key), `${path}.${key}`, onConflict) : read(source, key),
  }), target);
};

const isPlainObject = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
};

// devalue, which SvelteKit serializes load data with, refuses an object with
// an own '__proto__' key. Branches without one are returned as they are.
export const omitProtoKeys = (value: any): any => {
  if (Array.isArray(value)) {
    const items = value.map(omitProtoKeys);

    return items.some((item, i) => item !== value[i]) ? items : value;
  }

  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value);
  const entries = keys.filter((key) => key !== '__proto__').map((key) => [key, omitProtoKeys(value[key])] as const);

  if (entries.length === keys.length && entries.every(([key, item]) => item === value[key])) return value;

  return entries.reduce((acc, [key, item]) => ({ ...acc, [key]: item }), {});
};

const reportLoaderConflict = (path: string) => {
  logger.warn(`Conflicting translations for '${path}'. Keeping the value of the last loader.`);
};

export const serialize = (input: Array<Loader.Resolved & { data: any }>) => {
  return input.reduce((acc, { namespace, data, locale }) => {
    if (!data) return acc;

    // The locale is already sanitized — loaders are normalized before the fetch.
    const namespaces = read(acc, locale);

    return ({
      ...acc,
      [locale]: {
        ...namespaces,
        [namespace]: hasOwn(namespaces, namespace) ? mergeTranslations(read(namespaces, namespace), data, `${namespace}`, reportLoaderConflict) : data,
      },
    });
  }, {} as Translations.SerializedTranslations);
};

/** A loader selected for a load, with the params its route yielded. */
export type LoadRequest = { loader: Loader.Resolved; params: Loader.Params; signature: string };

/** What a loader delivered. A loader that threw has no entry; one that returned nothing delivered no keys. */
export type Delivery = { loader: Loader.Resolved; signature: string; data: Translations.Input };

// Every loader is called before the first one is awaited, and one that throws
// costs only its own data. Only a throw is retried: an empty answer is an
// answer, and it still replaces what the loader delivered for other params.
export const fetchTranslations = async (requests: LoadRequest[], route: string): Promise<Delivery[]> => {
  const responses = await Promise.all(requests.map(async ({ loader: resolved, params, signature }) => {
    const { loader, locale, namespace } = resolved;

    try {
      const data = await loader({ locale, namespace, route, params });

      return [{ loader: resolved, signature, data: data || {} }];
    } catch (error) {
      logError(`Failed to load translation. Verify your '${locale}' > '${namespace}' Loader.`, error);

      return [];
    }
  }));

  return responses.flat();
};

// `exec` advances `lastIndex` on a `g`/`y` pattern, so a route object reused
// across navigations would match only every other time — and writing to the
// consumer's own pattern is not ours to do, least of all when it is frozen.
const withoutMatchState = (input: RegExp) => (
  input.global || input.sticky
    ? new RegExp(input.source, input.flags)
    : input
);

// A match yields the named groups of a pattern, copied onto a plain object
// (a match's `groups` has a null prototype) without the groups that did not
// take part. A string route and a matcher yield none. `undefined` is no match.
export const matchRoute = (route: string) => (input: Loader.Route): Loader.Params | undefined => {
  try {
    if (typeof input === 'string') return input === route ? {} : undefined;

    if (input instanceof RegExp) {
      const match = withoutMatchState(input).exec(route);

      if (!match) return undefined;

      return Object.entries(match.groups ?? {}).reduce<Loader.Params>(
        (acc, [name, value]: [string, string | undefined]) => (value === undefined ? acc : { ...acc, [name]: value }),
        {},
      );
    }

    return input.test(route) ? {} : undefined;
  } catch (error) {
    logError('Invalid route config!', error);
  }

  return undefined;
};

export const testRoute = (route: string) => (input: Loader.Route): boolean => matchRoute(route)(input) !== undefined;

/** The params a loader loads with on `route` – its first matching route's – or `undefined` when none matches. */
export const routeParams = (routes: readonly Loader.Route[] | undefined, route: string): Loader.Params | undefined => {
  if (!routes) return {};

  const match = matchRoute(route);

  return routes.reduce<Loader.Params | undefined>((found, input) => found ?? match(input), undefined);
};

// Keyed on the params alone, not the route: two routes yielding the same params
// describe the same data. Stable in key order, and '' for none, so a loader
// without params keys the way a namespace record does.
export const paramsSignature = (params: Loader.Params): string => {
  const names = Object.keys(params).sort();

  return names.length ? JSON.stringify(names.map((name) => [name, read(params, name)])) : '';
};
