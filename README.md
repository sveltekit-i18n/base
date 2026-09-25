
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
✅ **TypeScript** – Locales inferred from your config, keys and payloads from a [`schema`](#schema)  
✅ **Zero dependencies** – Lightweight and fast

## Requirements

Svelte 5 or newer, and one of Node 22+, Bun 1.2+ or Deno 2+. The package is
ESM-only and imports no `node:` module, so every runtime that runs your
SvelteKit build runs it.

## Installation

```bash
npm install @sveltekit-i18n/base
# bun add @sveltekit-i18n/base
# deno add npm:@sveltekit-i18n/base
```

You'll also need a parser:

```bash
# Choose one:
npm install @sveltekit-i18n/parser-curly
npm install @sveltekit-i18n/parser-icu
npm install @sveltekit-i18n/parser-mf2
npm install @sveltekit-i18n/parser-i18next
```

## Quick Start

### 1. Create translation files

```jsonc
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
import parser from '@sveltekit-i18n/parser-curly';

/** @type {import('@sveltekit-i18n/base').Config.T} */
const config = {
  parser: parser({ onReport: null, /* other parser options */ }),
  loaders: [
    {
      locale: ['en', 'cs'],
      namespace: 'common',
      loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
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

> **Rendering per-visitor locales on the server?** The instance above is a
> module-level singleton — on the server it is shared by every request in the
> process, so concurrent visitors overwrite each other's locale. Use one
> instance per request and hand its state to the client with `snapshot()` and
> `hydrate()`: see [Server-Side Rendering](./docs/README.md#server-side-rendering).

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
  parser: parser({ onReport: null }),
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
    namespace: 'common',    // Required: translation namespace
    loader: async () => {}, // Required: async function returning translations
    routes: ['/about'],     // Optional: load only for specific routes
  },
]
```

`locale` and `namespace` each take a list as well. Such a descriptor stands for one loader per locale and namespace pair, and the loader receives the pair it is loading, so one computed loader can replace a descriptor per file:

```javascript
loaders: [
  {
    locale: ['en', 'cs'],
    namespace: ['common', 'nav'],
    loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
  },
]
```

A named capture group in a `RegExp` route is a load parameter: its match reaches the loader as `params`, and the loader runs again when it changes, its new data replacing the old:

```javascript
{
  locale: 'en',
  namespace: 'article',
  routes: [/^\/article\/(?<articleId>[^/]+)/],
  loader: async ({ locale, params }) => (await fetch(`/api/articles/${params.articleId}/i18n/${locale}`)).json(),
}
```

See [route params](./docs/README.md#route-params) for the rules.

A loader whose source does the caching itself — a SvelteKit remote `query`, an SWR layer, an HTTP cache — sets `cache: false`. It then runs on every load trigger that selects it, and `config.cache` does not apply to it; only a hydrated snapshot holds it back, for the locale and route it was rendered for. See [the loader's `cache`](./docs/README.md#cache-optional).

A loader that throws is logged, and the rest of the load lands without its data; it runs again on the next load trigger. SvelteKit's `redirect()` and an `error()` below 500 (told by their shape: an own `status` with a `location` or a `body`, on a value that is not an `Error`) are logged too, but they also reject the load, so a SvelteKit `load` awaiting the call hands them to SvelteKit; the rejected call is undone — what it replaced goes back — unless a later call that has not failed came in the meantime. See [the loader](./docs/README.md#loader-required).

Both `loaders` and a loader's `routes` accept readonly arrays, so a whole-config `as const` is fine.

### `translations`

Synchronous translations, available immediately. They seed the tables: the loaders of a namespace they name still run and merge into it. Hand a server's state over with [`hydrate()`](./docs/README.md#hydrateenvelope) instead:

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

### `schema`

A map of translation key to the payload its message expects (`never` for a message that takes none). Supplying it types `t`/`l` — keys autocomplete, an unknown key is a type error, and the payload argument is checked. Only its type is read, so the value can stay empty at runtime:

```typescript
type TranslationSchema = {
  'common.greeting': { name: string };
  'common.farewell': never;
};

const i18n = new I18n({ ...config, schema: {} as TranslationSchema });
```

Hand-write it for a small set of messages, or point the slot at a generated artifact. A schema whose keys are not a closed set is ignored, and keys stay plain strings. See [`schema`](./docs/README.md#schema) for the full rules.

### `cache`

Time in milliseconds the loaded translations stay fresh for. By default, loaded translations never expire — each loader (but one with [`cache: false`](./docs/README.md#cache-optional)) runs once per locale and [route params](./docs/README.md#route-params) (a loader's `routes` decide whether a load trigger considers it, and the params their named groups capture decide when it runs again).

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
- `loading` – `true` while any activating load is in flight; a `{ activate: false }` load counts only once an activating trigger joins it
- `initialized` – locale and route set, translations present
- `translations` / `rawTranslations` – the (pre/post-preprocess) tables

### Methods

Load-triggering methods return the promise of the matching load — concurrent duplicate triggers share one in-flight load (and its promise) instead of fetching twice.

- `loadTranslations(locale, route?, options?)` – load translations for locale and route; `route` defaults to the current one, and `{ activate: false }` only fills the tables without switching to them
- `loadNamespace(namespace, locale?)` – load one namespace on demand, whatever its loaders' routes, without switching to it; it stays loaded across routes
- `setLocale(locale)` – request a locale; loads once a route is known
- `setRoute(route)` – update the current route
- `loadConfig(config)` – (re)configure the instance
- `addTranslations(translations)` – seed synchronous translations; the loaders of their namespaces still run and merge into them
- `snapshot(options?)` – serialize what the active locale (and the fallback) holds; `{ records: true }` returns the envelope `hydrate()` restores, with the loaders that delivered, the active locale and the route, and no argument returns the data alone, shaped like `config.translations`, for a plain `hydrate({ translations })`
- `hydrate(envelope?)` – restore a server's snapshot: its data, its load records (so those loaders do not run again — one with `cache: false` only for the locale and route it was rendered for), its locale and its route; an envelope without records keeps the loaders of the namespaces its data names from running
- `invalidate(locale?, namespace?)` – mark loaded translations stale (one locale or all, one namespace or all); loaders run again on the next load trigger, and a loader still in flight for what was invalidated settles with whatever it returns or throws discarded — an activating trigger fetches it again before it activates, unless another loader of its load threw SvelteKit's control flow
- `destroy()` – detach a per-request or per-component instance: in-flight loads settle discarded, further load and mutation calls are ignored, reads keep working

### Utilities

Pure helpers ship from a separate subpath, for the code around the instance that has to match the library's own behavior or decide which locale to ask for:

```javascript
import { matchLocale, resolveLoaders, sanitizeLocales, toDotNotation } from '@sveltekit-i18n/base/utils';
```

- `toDotNotation(input, preserveArrays?)` – the flattening behind [`preprocess`](#preprocess), for a custom `preprocess` that still wants dot notation
- `resolveLoaders(loaders, sanitizeLocales?)` – normalizes `config.loaders` the way the instance does, into one loader per locale and namespace pair, for code that reads a config from outside the instance
- `sanitizeLocales(...locales)` – normalizes a locale from a URL, cookie or `Accept-Language` header the way the instance does, so it can be compared against `locale`
- `matchLocale(requested, available)` – picks the configured locale a visitor asked for, from an `Accept-Language` header or `navigator.languages`, falling back from `en-GB` to `en` and answering `undefined` when nothing matches

Full API documentation: [docs/README.md](./docs/README.md)

## Documentation

- 🌐 [sveltekit-i18n.github.io](https://sveltekit-i18n.github.io) – The documentation site, with a live playground
- 📖 [Full API Documentation](./docs/README.md) – Complete reference
- 📚 [Main Library Docs](https://github.com/sveltekit-i18n/lib/tree/master/docs/INDEX.md) – Guides, tutorials, and best practices
- 🎨 [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers and how to create your own
- 💡 [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Real-world usage examples

## TypeScript Support

```typescript
import { I18n, type Config } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// The parser's params – the rest parameters of `t`/`l`. Annotate only when the
// config lives on its own; `new I18n({ ... })` infers them.
type Params = [payload?: Record<string, unknown>];

const config: Config.T<Params> = {
  parser: parser({ onReport: null }),
  loaders: [/* ... */],
};
```

Two more things are inferred from the config itself. [`schema`](#schema) types the keys and payloads of `t`/`l`, and every locale the config names — loader locales, `initLocale`, `fallbackLocale` and the keys of `translations` — completes the locale arguments and reads (`setLocale`, `loadTranslations`, `invalidate`, `l`, `locale`, `locales`):

```typescript
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en', fallbackLocale: 'de' });

i18n.setLocale('en'); // 'en' | 'de' autocomplete here
i18n.setLocale('sv'); // still accepted — the union is a hint, not a constraint
```

The locales survive only when the config reaches the constructor as a literal — inline, as above, or a separate object with `as const`. An annotated or separately widened config, and any config with one dynamic locale source (`loaders: locales.map(...)`), leaves them plain `string`. See [TypeScript](./docs/README.md#typescript) for both.

## Related Packages

- [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) – Complete solution, with the Curly Message Format parser included
- [@sveltekit-i18n/parser-curly](https://github.com/sveltekit-i18n/parsers/tree/master/parser-curly) – [Curly Message Format](https://curlymessage.dev) parser
- [@sveltekit-i18n/parser-icu](https://github.com/sveltekit-i18n/parsers/tree/master/parser-icu) – ICU message format parser
- [@sveltekit-i18n/parser-mf2](https://github.com/sveltekit-i18n/parsers/tree/master/parser-mf2) – [Unicode MessageFormat 2](https://unicode.org/reports/tr35/tr35-messageFormat.html) parser
- [@sveltekit-i18n/parser-i18next](https://github.com/sveltekit-i18n/parsers/tree/master/parser-i18next) – [i18next](https://www.i18next.com) interpolation and formatting syntax parser
- [Extensions](https://github.com/sveltekit-i18n/extensions) – Official extensions for the `config.extensions` pipe

## Contributing

For general contribution guidelines, see the [Contributing Guide](https://github.com/sveltekit-i18n/lib/blob/master/CONTRIBUTING.md) in the main library repository.

For issues specific to base functionality, create a ticket [here](https://github.com/sveltekit-i18n/lib/issues).

## Changelog

See [Releases](https://github.com/sveltekit-i18n/base/releases) for version history.

## Sponsor

You can support the maintenance of this package through
[GitHub Sponsors](https://github.com/sponsors/sveltekit-i18n).

## License

MIT
