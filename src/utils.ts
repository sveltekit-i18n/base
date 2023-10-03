import type { DotNotation, Translations, Loader } from './types';
import { logger } from './logger';

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

  let text = (translations[locale] || {})[key];

  if (fallbackLocale && text === undefined) {
    text = (translations[fallbackLocale] || {})[key];
  }

  if (rest.hasOwnProperty('fallbackValue') && text === undefined) {
    return rest.fallbackValue;
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
