import { I18n } from '@sveltekit-i18n/base';

const i18n = new I18n({
  parser: { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => key },
  loaders: [{ namespace: 'common', locale: 'de', loader: async () => ({}) }],
});

// What `preload()` resolves is what the commit is handed, `undefined` included.
const preloaded = await i18n.preload('de', '/about');

await i18n.loadTranslations('de', '/about', { preloaded });
await i18n.setRoute('/about', { preloaded });
