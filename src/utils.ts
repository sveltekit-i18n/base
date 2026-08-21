import type { Config, DotNotation, Translations, Loader, Parser } from './types.js';
import { logError, logger } from './logger.js';

// Safe own-property read. Translation keys like `toString`, `constructor` or
// `__proto__` would otherwise resolve to inherited `Object.prototype` members
// instead of being treated as missing translations.
export const hasOwn = (obj: any, key: PropertyKey): boolean => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

// Own-property read: returns the value only when `key` is the object's own
// property, otherwise undefined. Centralizes the prototype-safe table lookup.
export const read = <T = any>(obj: any, key: PropertyKey): T | undefined => (hasOwn(obj, key) ? obj[key] : undefined);

// The fail-soft paths return placeholder strings (`''`, the key itself) even
// for a parser with a non-string output — hence the `as unknown as O` casts.
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
}): O => {
  if (!key) {
    logger.warn(`No translation key provided ('${locale}' locale). Skipping translation...`);
    return '' as unknown as O;
  }

  if (!locale) {
    logger.warn(`No locale provided for '${key}' key. Skipping translation...`);
    return '' as unknown as O;
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
  }

  if (!parser || typeof parser.parse !== 'function') {
    // Reached on every call while no parser is set (e.g. before config loads),
    // so keep it at debug to avoid flooding logs on the render path.
    logger.debug(`No parser configured. Returning raw value for '${key}' key.`);
    // Mirror the missing-translation contract: fall back to the key itself.
    if (text === undefined) return key as unknown as O;

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

// Loader properties are consumer code — an accessor may throw. Materialized
// once at the config boundary, so a single unreadable loader costs only itself
// instead of taking down every locale-keyed read downstream.
export const resolveLoaders = (input: readonly Loader.LoaderModule[] = []): Loader.LoaderModule[] => (
  input.reduce<Loader.LoaderModule[]>((acc, descriptor) => {
    try {
      const { key, locale, loader, routes } = descriptor;

      return [...acc, { key, locale, loader, routes }];
    } catch (error) {
      logError('Skipping a loader that cannot be read.', error);

      return acc;
    }
  }, [])
);

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

const reportLoaderConflict = (path: string) => {
  logger.warn(`Conflicting translations for '${path}'. Keeping the value of the last loader.`);
};

export const serialize = (input: Array<Loader.LoaderModule & { data: any }>) => {
  return input.reduce((acc, { key, data, locale }) => {
    if (!data) return acc;

    // The locale is already sanitized — loaders are normalized before the fetch.
    const namespaces = read(acc, locale);

    return ({
      ...acc,
      [locale]: {
        ...namespaces,
        [key]: hasOwn(namespaces, key) ? mergeTranslations(read(namespaces, key), data, `${key}`, reportLoaderConflict) : data,
      },
    });
  }, {} as Translations.SerializedTranslations);
};

export const fetchTranslations = async (loaders: Loader.LoaderModule[], route: string) => {
  const response = await Promise.all(loaders.map(async ({ loader, ...rest }) => {
    let data;
    try {
      data = await loader({ locale: rest.locale, route });
    } catch (error) {
      logError(`Failed to load translation. Verify your '${rest.locale}' > '${rest.key}' Loader.`, error);
    }
    return { loader, ...rest, data };
  }));

  return serialize(response);
};

// `test` advances `lastIndex` on a `g`/`y` pattern, so a route object reused
// across navigations would match only every other time — and writing to the
// consumer's own pattern is not ours to do, least of all when it is frozen.
const withoutMatchState = (input: Loader.RouteMatcher) => (
  input instanceof RegExp && (input.global || input.sticky)
    ? new RegExp(input.source, input.flags)
    : input
);

export const testRoute = (route: string) => (input: Loader.Route) => {
  try {
    if (typeof input === 'string') return input === route;

    return withoutMatchState(input).test(route);
  } catch (error) {
    logError('Invalid route config!', error);
  }

  return false;
};
