import type { DotNotation, Translations, Loader } from './types';

export const toDotNotation: DotNotation.T = (input, parentKey) => Object.keys(input || {}).reduce((acc, key) => {
  const value = (input as any)[key];
  const outputKey = parentKey ? `${parentKey}.${key}` : `${key}`;

  if (value && typeof value === 'object') return ({ ...acc, ...toDotNotation<typeof value>(value, outputKey) });

  return ({ ...acc, [outputKey as keyof typeof outputKey]: value as typeof value });
}, {});

export const fetchTranslations: Translations.FetchTranslations = async (loaders) => {
  try {
    const response = await Promise.all(loaders.map(({ loader, ...rest }) => new Promise<Loader.LoaderModule & { data: any }>(async (res) => {
      let data;
      try {
        data = await loader();
      } catch (error) {
        console.error(`Failed to load translation. Verify your '${rest.locale}' > '${rest.key}' Loader.`);
        console.error(error);
      }
      res({ loader, ...rest, data });
    })));

    return response.reduce((acc, { key, data, locale }) => data ? ({
      ...acc,
      [locale]: toDotNotation({ ...(acc[locale] || {}), [key]: data }),
    }) : acc, {} as DotNotation.Input);
  } catch (error) {
    console.error(error);
  }

  return {};
};

export const testRoute = (route: string) => (input: Loader.Route) => {
  try {
    if (typeof input === 'string') return input === route;
    if (typeof input === 'object') return input.test(route);
  } catch (error) {
    throw new Error('Invalid route config!');
  }

  return false;
};

export const sanitizeLocales = (locales: string[] | string) => {
  let outputLocales = locales;

  if (!Array.isArray(locales)) {
    outputLocales = [locales];
  } else {
    outputLocales = locales;
  }

  outputLocales = outputLocales.map((locale) => {
    let current = `${locale}`.toLowerCase();
    try {
      [current] = Intl.Collator.supportedLocalesOf(locale);
    } catch (error) {console.warn('Unstandard locale provided! Check your `translations` and `loaders` in config...');}

    return current;
  });

  return outputLocales;
};