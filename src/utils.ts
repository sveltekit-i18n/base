import type { DotNotation, Translations, Loader } from './types';
import { logger } from './logger';

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
    const output = Object.keys(input).reduce((acc, key) => {
      const value = (input as any)[key];
      const outputKey = parentKey ? `${parentKey}.${key}` : `${key}`;

      if (value && typeof value === 'object' && !(preserveArrays && Array.isArray(value))) {
        return ({ ...acc, ...toDotNotation(value, preserveArrays, outputKey) });
      }

      return ({ ...acc, [outputKey]: toDotNotation(value, preserveArrays) });
    }, {});

    if (Object.keys(output).length) {
      return output;
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
  try {
    const response = await Promise.all(loaders.map(({ loader, ...rest }) => new Promise<Translations.TranslationData>(async (res) => {
      let data;
      try {
        data = await loader();
      } catch (error) {
        logger.error(`Failed to load translation. Verify your '${rest.locale}' > '${rest.key}' Loader.`);
        logger.error(error);
      }
      res({ loader, ...rest, data });
    })));

    return serialize(response);
  } catch (error) {
    logger.error(error);
  }

  return {};
};

export const testRoute = (route: string) => (input: Loader.Route) => {
  try {
    if (typeof input === 'string') return input === route;
    if (typeof input === 'object') return input.test(route);
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
