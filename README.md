

[![npm version](https://badge.fury.io/js/@sveltekit-i18n%2Fbase.svg)](https://badge.fury.io/js/@sveltekit-i18n%2Fbase) ![](https://github.com/sveltekit-i18n/base/workflows/Tests/badge.svg)

# @sveltekit-i18n/base
This repository contains the base functionality of [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) and provides support for external message [parsers](https://github.com/sveltekit-i18n/parsers).


## Key features

✅ SvelteKit ready\
✅ SSR support\
✅ Custom parsers – you can use any message syntax you need\
✅ Custom data sources – no matter if you are using local files or remote API to get your translations\
✅ Module-based – your translations are loaded for visited pages only (and only once!)\
✅ Component-scoped translations – you can create multiple instances with custom definitions\
✅ TS support\
✅ No external dependencies

## Usage

Setup `translations.js` in your lib folder...
```javascript
import i18n from '@sveltekit-i18n/base';
// use your preferred parser (or create your own)
import parser from '@sveltekit-i18n/parser-default';
// import parser from '@sveltekit-i18n/parser-icu';

/** @type {import('@sveltekit-i18n/parser-default').Config} */
const config = ({
  parser: parser({/* Parser options */}),
  loaders: [
    {
      locale: 'en',
      key: 'common',
      loader: async () => (
        await import('./en/common.json')
      ).default,
    },
    {
      locale: 'en',
      key: 'home',
      routes: ['/'], // you can use regexes as well!
      loader: async () => (
        await import('./en/home.json')
      ).default,
    },
    {
      locale: 'en',
      key: 'about',
      routes: ['/about'],
      loader: async () => (
        await import('./en/about.json')
      ).default,
    },
    {
      locale: 'cs',
      key: 'common',
      loader: async () => (
        await import('./cs/common.json')
      ).default,
    },
    {
      locale: 'cs',
      key: 'home',
      routes: ['/'],
      loader: async () => (
        await import('./cs/home.json')
      ).default,
    },
    {
      locale: 'cs',
      key: 'about',
      routes: ['/about'],
      loader: async () => (
        await import('./cs/about.json')
      ).default,
    },
  ],
});

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
```

...load your translations in `+layout.js`...

```js
import { loadTranslations } from '$lib/translations';

/** @type {import('@sveltejs/kit').Load} */
export const load = async ({ url }) => {
  const { pathname } = url;

  const initLocale = 'en'; // get from cookie, user session, ...

  await loadTranslations(initLocale, pathname); // keep this just before the `return`

  return {};
}
```

...and include your translations within pages and components.

```svelte
<script>
  import { t } from '$lib/translations';

  const pageName = 'This page is Home page!';
</script>

<div>
  <h2>{$t('common.page', { pageName })}</h2>
  <p>{$t('home.content')}</p>
</div>
```


## More info
[Parsers](https://github.com/sveltekit-i18n/parsers)\
[Docs](https://github.com/sveltekit-i18n/base/tree/master/docs/README.md)\
[Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples#parsers)\
[Changelog](https://github.com/sveltekit-i18n/base/releases)


## Issues
If you are facing some issues related to the base functionality, create a ticket [here](https://github.com/sveltekit-i18n/lib/issues).
