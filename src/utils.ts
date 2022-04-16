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
  if (!(key && locale)) {
    logger.warn('No translation key or locale provided. Skipping translation...');
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

export const sanitizeLocales = (...locales: any[]): string[] | [] => {
  if (!locales.length) return [];

  return locales.filter((locale) => !!locale).map((locale) => {
    let current = `${locale}`.toLowerCase();
    try {
      const [sanitized] = Intl.Collator.supportedLocalesOf(locale);

      if (!sanitized) throw new Error(`'${locale}' is non-standard.`);

      current = sanitized;
    } catch (error) {
      logger.warn(`Non-standard locale provided: '${locale}'. Check your 'translations' and 'loaders' in i18n config...`);
    }

    return current;
  });
};

export const toDotNotation: DotNotation.T = (input, parentKey) => Object.keys(input || {}).reduce((acc, key) => {
  const value = (input as any)[key];
  const outputKey = parentKey ? `${parentKey}.${key}` : `${key}`;

  if (value && typeof value === 'object') return ({ ...acc, ...toDotNotation(value, outputKey) });

  return ({ ...acc, [outputKey]: value });
}, {});

export const fetchTranslations: Translations.FetchTranslations = async (loaders) => {
  try {
    const response = await Promise.all(loaders.map(({ loader, ...rest }) => new Promise<Loader.LoaderModule & { data: any }>(async (res) => {
      let data;
      try {
        data = await loader();
      } catch (error) {
        logger.error(`Failed to load translation. Verify your '${rest.locale}' > '${rest.key}' Loader.`);
        logger.error(error);
      }
      res({ loader, ...rest, data });
    })));

    return response.reduce((acc, { key, data, locale }) => {
      if (!data) return acc;

      const [validLocale] = sanitizeLocales(locale);

      return ({
        ...acc,
        [validLocale]: toDotNotation({ ...(acc[validLocale] || {}), [key]: data }),
      });
    }, {} as DotNotation.Input);
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
  } catch (error) {}

  return out;
};
