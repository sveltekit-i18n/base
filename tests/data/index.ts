import type { Config } from '../../src';
export { default as getTranslations } from './translations';

export const CONFIG: Config.T = {
  initLocale: 'en',
  parser: {
    parse: (_text, _params, _locale, key) => key,
  },
  log: {
    level: 'error',
  },
  loaders: [
    {
      key: 'common',
      locale: 'EN',
      loader: async () => (await import('../data/translations/en/common.json')).default,
    },
    {
      key: 'route1',
      locale: 'EN',
      routes: [/./],
      loader: async () => (await import('../data/translations/en/route.json')).default,
    },
    {
      key: 'route2',
      locale: 'EN',
      routes: ['/path#hash?a=b&c=d'],
      loader: async () => (await import('../data/translations/en/route.json')).default,
    },
    {
      key: 'common',
      locale: 'zh-Hans',
      loader: async () => (await import('../data/translations/zh-Hans/common.json')).default,
    },
  ],
};