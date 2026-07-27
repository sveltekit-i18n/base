import type { DotNotation, Translations, Loader } from './types';
import { logError, logger } from './logger';

// Safe own-property read. Translation keys like `toString`, `constructor` or
// `__proto__` would otherwise resolve to inherited `Object.prototype` members
// instead of being treated as missing translations.
export const hasOwn = (obj: any, key: PropertyKey): boolean => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

// Own-property read: returns the value only when `key` is the object's own
// property, otherwise undefined. Centralizes the prototype-safe table lookup.
export const read = <T = any>(obj: any, key: PropertyKey): T | undefined => (hasOwn(obj, key) ? obj[key] : undefined);

export const translate: Translations.Translate = ({
  parser,
  key,
  params,
  translations,
  locale,
  fallbackLocale,
  ...rest
}) => {
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
  }

  if (!parser || typeof parser.parse !== 'function') {
    // Reached on every call while no parser is set (e.g. before config loads),
    // so keep it at debug to avoid flooding logs on the render path.
    logger.debug(`No parser configured. Returning raw value for '${key}' key.`);
    // Mirror the missing-translation contract: fall back to the key itself.
    return text === undefined ? key : text;
  }

  return parser.parse(text, params, locale, key);
};

export const sanitizeLocales = (...locales: any[]) => {
  if (!locales.length) return [];

  return locales.filter((locale) => !!locale).map((locale) => {
    let current = `${locale}`.toLowerCase();
    try {
      const [sanitized] = Intl.Collator.supportedLocalesOf(locale);

      if (!sanitized) throw new Error();

      current = sanitized;
    } catch (error) {
      logger.warn(`'${locale}' locale is non-standard.`);
    }

    return current;
  });
};

export const toDotNotation: DotNotation.T = (input, preserveArrays, parentKey) => {
  if (preserveArrays && Array.isArray(input)) {
    return input.map((v) => toDotNotation(v, preserveArrays));
  }

  if (input && typeof input === 'object') {
    // This runs over the whole translation set on every load, so the
    // accumulator is mutated instead of being rebuilt per key (which is
    // quadratic). It has a null prototype so that a literal '__proto__' key
    // stays an own property rather than reaching the prototype setter; the
    // single spread below restores a normal object for consumers, with
    // DefineProperty semantics that preserve that key.
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

export const serialize = (input: Translations.TranslationData[]) => {
  return input.reduce((acc, { key, data, locale }) => {
    if (!data) return acc;

    const [validLocale] = sanitizeLocales(locale);

    const output = { ...(acc[validLocale] || {}), [key]: data };

    return ({
      ...acc,
      [validLocale]: output,
    });
  }, {} as Translations.SerializedTranslations);
};

export const fetchTranslations: Translations.FetchTranslations = async (loaders) => {
  const response = await Promise.all(loaders.map(async ({ loader, ...rest }) => {
    let data;
    try {
      data = await loader();
    } catch (error) {
      logError(`Failed to load translation. Verify your '${rest.locale}' > '${rest.key}' Loader.`, error);
    }
    return { loader, ...rest, data };
  }));

  return serialize(response);
};

export const testRoute = (route: string) => (input: Loader.Route) => {
  try {
    if (typeof input === 'string') return input === route;
    if (typeof input === 'object') {
      // `test` advances `lastIndex` on a `g`/`y` pattern, so a route object
      // shared across navigations would match only every other time and the
      // consumer's own use of it would be corrupted. A throwaway copy starts at
      // `lastIndex === 0` every time, keeps the flags' meaning (sticky still
      // anchors), and never writes to the original — which also matters when
      // the original is frozen.
      //
      // Only an actual RegExp is copied: `source`/`flags` on anything else are
      // not a pattern, and `new RegExp(undefined)` is `/(?:)/`, which matches
      // every route. Everything else is asked for `test` as-is, with the route
      // passed through unchanged — a custom matcher may distinguish an unset
      // route from the string 'undefined'.
      const stateful = input instanceof RegExp && (input.global || input.sticky);
      const pattern = stateful ? new RegExp(input.source, input.flags) : input;

      return pattern.test(route);
    }
  } catch (error) {
    logger.error('Invalid route config!');
  }

  return false;
};

export const checkProps = (props: any, object: any) => {
  let out = true;

  try {
    out = Object.keys(props).filter(
      (key) => props[key] !== undefined,
    ).every(
      (key) => props[key] === object[key],
    );
  } catch (error) { }

  return out;
};
