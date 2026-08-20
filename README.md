
[![npm version](https://badge.fury.io/js/@sveltekit-i18n%2Fbase.svg)](https://badge.fury.io/js/@sveltekit-i18n%2Fbase) ![](https://github.com/sveltekit-i18n/base/workflows/Tests/badge.svg)

# @sveltekit-i18n/base

Core i18n functionality for SvelteKit with support for custom message parsers. This package provides the foundation for [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) and can be used standalone when you need maximum flexibility with custom parsers.

## When to use @sveltekit-i18n/base

**Use this package if you:**
- Need a custom message parser (like ICU, Fluent, or your own format)
- Want full control over message interpolation
- Are building a custom i18n solution

**Use [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) if you:**
- Want the quickest setup with sensible defaults
- Are happy with the default placeholder/modifier syntax
- Don't need custom parsers

## Key Features

✅ **Svelte 5 runes** – One reactive instance, no stores  
✅ **Framework ready** – Full SSR and CSR support  
✅ **Parser-agnostic** – Use any message syntax you need  
✅ **Custom data sources** – Load translations from anywhere (files, APIs, databases)  
✅ **Module-based** – Translations load only for visited pages  
✅ **Route-aware** – Automatic loading based on SvelteKit routes  
✅ **Component-scoped** – Multiple translation instances with custom definitions  
✅ **Extensible** – Pipe the instance through [extensions](#extensions) to reshape or augment its surface  
✅ **TypeScript** – Full type support  
✅ **Zero dependencies** – Lightweight and fast

## Installation

```bash
npm install @sveltekit-i18n/base
```

You'll also need a parser:

```bash
# Choose one:
npm install @sveltekit-i18n/parser-default
npm install @sveltekit-i18n/parser-icu
# or create your own
```

## Quick Start

### 1. Create translation files

```json
// src/lib/translations/en/common.json
{
  "greeting": "Hello, {{name}}!",
  "farewell": "Goodbye!"
}
```

### 2. Setup with a parser

```javascript
// src/lib/translations/index.js
import { I18n } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';

/** @type {import('@sveltekit-i18n/base').Config} */
const config = {
  parser: parser({ /* parser options */ }),
  loaders: [
    {
      locale: 'en',
      key: 'common',
      loader: async () => (await import('./en/common.json')).default,
    },
    {
      locale: 'cs',
      key: 'common',
      loader: async () => (await import('./cs/common.json')).default,
    },
  ],
};

// One reactive instance. Do NOT destructure its value properties — reading
// them off the instance is what makes templates reactive. (`t`/`l` are
// functions and stay reactive even when destructured, since the tracked reads
// happen at call time. In a component, `const { loading } = $derived(i18n)`
// destructures value reads without losing reactivity.)
export const i18n = new I18n(config);
```

### 3. Load translations in your layout

```javascript
// src/routes/+layout.js
import { i18n } from '$lib/translations';

/** @type {import('./$types').LayoutLoad} */
export const load = async ({ url }) => {
  const { pathname } = url;
  const initLocale = 'en';

  await i18n.loadTranslations(initLocale, pathname);

  return {};
};
```

### 4. Use in components

```svelte
<script>
  import { i18n } from '$lib/translations';
</script>

<p>{i18n.t('common.greeting', { name: 'World' })}</p>
```

The call reads the reactive translation table and locale, so the text updates
automatically when either changes — no stores, no `$` prefix.

## Using Different Parsers

### ICU Message Format

```javascript
import i18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-icu';

const config = {
  parser: parser(),
  loaders: [/* ... */],
};
```

```json
{
  "items": "You have {count, plural, =0 {no items} one {# item} other {# items}}."
}
```

### Custom Parser

```javascript
import i18n from '@sveltekit-i18n/base';

const customParser = () => ({
  parse: (value, params) => {
    // Your custom interpolation logic
    return value.replace(/\{(\w+)\}/g, (_, key) => params[0]?.[key] ?? key);
  },
});

const config = {
  parser: customParser(),
  loaders: [/* ... */],
};
```

Learn more about [creating custom parsers](https://github.com/sveltekit-i18n/parsers#creating-custom-parsers).

## Configuration Options

### `parser` (required)

Message parser instance. See [Parsers](https://github.com/sveltekit-i18n/parsers).

### `loaders`

Array of loader configurations:

```javascript
loaders: [
  {
    locale: 'en',           // Required: locale identifier
    key: 'common',          // Required: translation namespace
    loader: async () => {}, // Required: async function returning translations
    routes: ['/about'],     // Optional: load only for specific routes
  },
]
```

### `translations`

Synchronous translations loaded immediately:

```javascript
translations: {
  en: {
    'app.name': 'My App',
  },
}
```

### `initLocale`

Initialize with a specific locale immediately:

```javascript
initLocale: 'en'
```

### `fallbackLocale`

Fallback when translation is missing:

```javascript
fallbackLocale: 'en'
```

**Note:** This loads translations for both current locale and fallback locale, which may impact performance.

### `fallbackValue`

Default return value when translation key is not found:

```javascript
fallbackValue: '...' // Default: returns the key itself
```

### `preprocess`

Transform translations after loading:

```javascript
preprocess: 'full' // 'full' | 'preserveArrays' | 'none' | custom function
```

- `'full'` (default): Flattens all nested objects to dot notation
- `'preserveArrays'`: Flattens objects but preserves arrays
- `'none'`: No preprocessing
- Custom function: `(input) => transformedOutput`

### `cache`

Time in milliseconds the loaded translations stay fresh for. By default, loaded translations never expire — loaders run once per locale and key (a loader's `routes` only decide whether a load trigger considers it, not how often it runs).

Set a finite value when your loaders fetch from a source that can change at runtime (e.g. a CMS):

```javascript
cache: 3600000 // Translations older than 1 hour refetch on the next load
```

Set to `0` to treat translations as always stale (refetch on every load trigger). You can also drop the loaded state manually at any time with [`invalidate()`](#methods).

### `extensions`

Pipes the constructed instance through extension functions, left to right. Each extension receives the surface produced so far (the raw instance for the first one) and returns the surface handed on — `new I18n(config)` evaluates to the last extension's output:

```javascript
import stores from '@sveltekit-i18n/extension-stores';

const { t, locale, loading } = new I18n({
  ...config,
  extensions: [stores],
});
```

An extension may augment the instance in place, or replace the surface entirely (like the store adapter above). Official extensions live in the [extensions](https://github.com/sveltekit-i18n/extensions) repository; a custom extension is just a function:

```javascript
const withGreeting = (i18n) => Object.assign(i18n, {
  greet: (name) => i18n.t('common.greeting', { name }),
});

export const i18n = new I18n({ ...config, extensions: [withGreeting] });

i18n.greet('World');
```

**Notes:**
- Applied at construction time only — a later `loadConfig()` call ignores this property.
- When an extension returns a new object, the result is no longer `instanceof I18n`; the original instance stays reachable through whatever the extension exposes (the official extensions expose it as `instance`).

### `log`

Logging configuration:

```javascript
log: {
  level: 'warn',        // 'error' | 'warn' | 'debug'
  prefix: '[i18n]: ',   // Log prefix
  logger: console,      // Custom logger
}
```

## API Reference

### Reactive properties

- `t(key, ...params)` – translate for the active locale (reactive function)
- `l(locale, key, ...params)` – translate for an explicit locale
- `locale` – the ACTIVE locale; assignment is a fire-and-forget `setLocale()`
- `locales` – available locales
- `loading` – `true` while any load is in flight
- `initialized` – locale and route set, translations present
- `translations` / `rawTranslations` – the (pre/post-preprocess) tables

### Methods

Load-triggering methods return the promise of the matching load — concurrent duplicate triggers share one in-flight load (and its promise) instead of fetching twice.

- `loadTranslations(locale, route)` – load translations for locale and route
- `setLocale(locale)` – request a locale; loads once a route is known
- `setRoute(route)` – update the current route
- `loadConfig(config)` – (re)configure the instance
- `addTranslations(translations)` – add synchronous translations
- `invalidate(locale?)` – mark loaded translations stale (one locale, or all); loaders run again on the next load trigger, and a load still in flight for an invalidated locale settles with its data discarded

### Utilities

Two helpers the instance uses internally ship from a separate subpath, for code that has to match the library's own behavior:

```javascript
import { sanitizeLocales, toDotNotation } from '@sveltekit-i18n/base/utils';
```

- `toDotNotation(input, preserveArrays?)` – the flattening behind [`preprocess`](#preprocess), for a custom `preprocess` that still wants dot notation
- `sanitizeLocales(...locales)` – normalizes a locale from a URL, cookie or `Accept-Language` header the way the instance does, so it can be compared against `locale`

Full API documentation: [docs/README.md](./docs/README.md)

## Documentation

- 📖 [Full API Documentation](./docs/README.md) – Complete reference
- 📚 [Main Library Docs](https://github.com/sveltekit-i18n/lib/tree/master/docs/INDEX.md) – Guides, tutorials, and best practices
- 🎨 [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers and how to create your own
- 💡 [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Real-world usage examples

## TypeScript Support

```typescript
import { I18n, type Config } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';

// The parser's params – the rest parameters of `t`/`l`. Annotate only when the
// config lives on its own; `new I18n({ ... })` infers them.
type Params = [payload?: Record<string, unknown>];

const config: Config.T<Params> = {
  parser: parser(),
  loaders: [/* ... */],
};
```

## Related Packages

- [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) – Complete solution with default parser
- [@sveltekit-i18n/parser-default](https://github.com/sveltekit-i18n/parsers/tree/master/parser-default) – Default message parser
- [@sveltekit-i18n/parser-icu](https://github.com/sveltekit-i18n/parsers/tree/master/parser-icu) – ICU message format parser
- [Extensions](https://github.com/sveltekit-i18n/extensions) – Official extensions for the `config.extensions` pipe

## Contributing

For general contribution guidelines, see the [Contributing Guide](https://github.com/sveltekit-i18n/lib/blob/master/CONTRIBUTING.md) in the main library repository.

For issues specific to base functionality, create a ticket [here](https://github.com/sveltekit-i18n/lib/issues).

## Changelog

See [Releases](https://github.com/sveltekit-i18n/base/releases) for version history.

## License

MIT
