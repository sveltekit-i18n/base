import type { Config } from '../../src';
export { default as TRANSLATIONS } from './translations';

export const CONFIG: Config.T = {
  initLocale: 'en',
  parser: {
    parse: (_text, _params, _locale, key) => key,
  },
  loaders: [
    {
      key: 'common',
      locale: 'EN',
      loader: async () => (import('../data/translations/en/common.json')),
    },
    {
      key: 'route1',
      locale: 'EN',
      routes: [/./],
      loader: async () => (import('../data/translations/en/route.json')),
    },
    {
      key: 'route2',
      locale: 'EN',
      routes: ['/path#hash?a=b&c=d'],
      loader: async () => (import('../data/translations/en/route.json')),
    },
    {
      key: 'common',
      locale: 'zh-Hans',
      loader: async () => (import('../data/translations/zh-Hans/common.json')),
    },
  ],
};