
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

✅ **SvelteKit ready** – Full SSR and CSR support  
✅ **Parser-agnostic** – Use any message syntax you need  
✅ **Custom data sources** – Load translations from anywhere (files, APIs, databases)  
✅ **Module-based** – Translations load only for visited pages  
✅ **Route-aware** – Automatic loading based on SvelteKit routes  
✅ **Component-scoped** – Multiple translation instances with custom definitions  
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
import i18n from '@sveltekit-i18n/base';
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

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
```

### 3. Load translations in your layout

```javascript
// src/routes/+layout.js
import { loadTranslations } from '$lib/translations';

/** @type {import('./$types').LayoutLoad} */
export const load = async ({ url }) => {
  const { pathname } = url;
  const initLocale = 'en';
  
  await loadTranslations(initLocale, pathname);
  
  return {};
};
```

### 4. Use in components

```svelte
<script>
  import { t } from '$lib/translations';
</script>

<p>{$t('common.greeting', { name: 'World' })}</p>
```

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

Server-side cache duration in milliseconds:

```javascript
cache: 86400000 // Default: 24 hours
```

Set to `Number.POSITIVE_INFINITY` to disable cache refresh.

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

### Stores

- `t` – Translation function store
- `locale` – Current locale (writable)
- `locales` – Available locales (readable)
- `loading` – Loading state (readable)
- `initialized` – Initialization state (readable)
- `translations` – All loaded translations (readable)

### Methods

- `loadTranslations(locale, route)` – Load translations for locale and route
- `setLocale(locale)` – Change current locale
- `setRoute(route)` – Update current route

Full API documentation: [docs/README.md](./docs/README.md)

## Documentation

- 📖 [Full API Documentation](./docs/README.md) – Complete reference
- 📚 [Main Library Docs](https://github.com/sveltekit-i18n/lib/tree/master/docs/INDEX.md) – Guides, tutorials, and best practices
- 🎨 [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers and how to create your own
- 💡 [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Real-world usage examples

## TypeScript Support

```typescript
import i18n, { type Config } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';
import type { Config as ParserConfig } from '@sveltekit-i18n/parser-default';

const config: Config<ParserConfig> = {
  parser: parser(),
  loaders: [/* ... */],
};
```

## Related Packages

- [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) – Complete solution with default parser
- [@sveltekit-i18n/parser-default](https://github.com/sveltekit-i18n/parsers/tree/master/parser-default) – Default message parser
- [@sveltekit-i18n/parser-icu](https://github.com/sveltekit-i18n/parsers/tree/master/parser-icu) – ICU message format parser

## Contributing

For general contribution guidelines, see the [Contributing Guide](https://github.com/sveltekit-i18n/lib/blob/master/CONTRIBUTING.md) in the main library repository.

For issues specific to base functionality, create a ticket [here](https://github.com/sveltekit-i18n/lib/issues).

## Changelog

See [Releases](https://github.com/sveltekit-i18n/base/releases) for version history.

## License

MIT
