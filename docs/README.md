# @sveltekit-i18n/base API Documentation

Complete API reference for `@sveltekit-i18n/base`. This package provides core i18n functionality with support for custom parsers.

## Table of Contents

- [Configuration](#configuration)
- [Instance Properties and Methods](#instance-properties-and-methods)
- [Utilities](#utilities)
- [TypeScript](#typescript)
- [See Also](#see-also)

## Configuration

When creating an i18n instance, you can configure it with these options:

```typescript
import { I18n } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';

const config = {
  parser: parser(),
  loaders: [/* ... */],
  // ... other options
};

export const i18n = new I18n(config);
```

---

### `parser` (required)

**Type:** `Parser.T`

Message parser instance that handles interpolation of variables into translation strings.

**Example:**

```javascript
import parser from '@sveltekit-i18n/parser-default';

const config = {
  parser: parser({
    // parser-specific options
  }),
};
```

**See:** [Parsers documentation](https://github.com/sveltekit-i18n/parsers)

---

### `loaders`

**Type:** `Loader.LoaderModule[]` (optional)

Array of loader configurations that define how and when translations should be loaded.

#### Loader Properties

Each loader object can have:

##### `locale` (required)

**Type:** `string`

The locale identifier this loader is for (e.g., `'en'`, `'cs'`, `'de-DE'`).

**Example:**

```javascript
{
  locale: 'en',
  // ...
}
```

##### `key` (required)

**Type:** `string`

Translation namespace identifier. This acts as a prefix for translation keys.

**Rules:**
- Should be unique within a locale
- Cannot contain dots (`.`)
- Use descriptive names (`common`, `home`, `auth`, etc.)

**Example:**

```javascript
{
  locale: 'en',
  key: 'common',
  // Translations will be accessible as i18n.t('common.greeting')
}
```

**⚠️ Common Pitfall:** Using dots in the `key` will cause lookup issues (a
config-time `logger.error` reports such keys, but the loader still runs):

```javascript
// ❌ Bad
{ key: 'pages.home' }

// ✅ Good
{ key: 'home' }
```

##### `loader` (required)

**Type:** `(props: { locale: string; route: string }) => Promise<Record<any, any>>`

Async function that returns translation data. It receives the load context —
the sanitized `locale` this run fetches translations for and the `route` the
load was triggered for. Loaders that don't need the context can simply take no
parameters.

**Loading from local files:**

```javascript
{
  locale: 'en',
  key: 'common',
  loader: async () => (await import('./en/common.json')).default,
}
```

**Loading from API (using the load context):**

```javascript
{
  locale: 'en',
  key: 'common',
  loader: async ({ locale }) => {
    const response = await fetch(`/api/translations/${locale}/common`);
    return await response.json();
  },
}
```

**⚠️ `route` is context, not a cache key.** A loader runs at most once per
locale per freshness window (see [`cache`](#cache)) — its `key` is recorded as
loaded and it is skipped on later routes. So a loader whose payload varies by
`route` would serve the first route's data everywhere. Scope such data with
[`routes`](#routes-optional) instead, one loader entry per route group, and use
the `route` argument for diagnostics, or in a loader that is scoped to exactly
one route:

```javascript
{
  locale: 'en',
  key: 'checkout',
  routes: ['/checkout'],
  loader: async ({ locale, route }) => {
    console.debug(`loading ${locale} translations for ${route}`);
    const response = await fetch(`/api/translations/${locale}/checkout`);
    return await response.json();
  },
}
```

**Loading from database (server-side):**

```javascript
{
  locale: 'en',
  key: 'common',
  loader: async () => {
    const translations = await db.translations.findOne({ locale: 'en', key: 'common' });
    return translations.data;
  },
}
```

**Conditional loading:**

```javascript
{
  locale: 'en',
  key: 'admin',
  loader: async () => {
    // Only load admin translations if user is admin
    if (userIsAdmin) {
      return (await import('./en/admin.json')).default;
    }
    return {};
  },
}
```

##### `routes` (optional)

**Type:** `Array<string | RegExp | { test: (route: string) => boolean }>`

Array of route patterns. Loader will only execute if current route matches one of these patterns.

**Exact string match:**

```javascript
{
  locale: 'en',
  key: 'home',
  routes: ['/'],
  loader: async () => (await import('./en/home.json')).default,
}
```

**Multiple routes:**

```javascript
{
  locale: 'en',
  key: 'products',
  routes: ['/products', '/shop'],
  loader: async () => (await import('./en/products.json')).default,
}
```

**Regular expressions:**

```javascript
{
  locale: 'en',
  key: 'products',
  routes: [/^\/products/, /^\/shop/],
  loader: async () => (await import('./en/products.json')).default,
}
```

This will match:
- `/products`
- `/products/123`
- `/products/category/electronics`
- `/shop`
- `/shop/cart`

**Custom matchers:**

Any value with a `test` method works. It receives the bare route path (e.g.
`/products/123`), so a matcher that expects a full URL has to be wrapped. Keep
it pure — a matcher may be consulted more than once per load:

```javascript
{
  locale: 'en',
  key: 'products',
  routes: [
    { test: (route) => route.startsWith('/products') },
    // A matcher built for full URLs has to be given an origin:
    { test: (route) => productPattern.test(new URL(route, 'https://example.com')) },
  ],
  loader: async () => (await import('./en/products.json')).default,
}
```

**No routes (global):**

```javascript
{
  locale: 'en',
  key: 'common',
  // No routes specified → loads on every page
  loader: async () => (await import('./en/common.json')).default,
}
```

**Use Cases:**

- **Common translations:** Omit `routes` for navigation, errors, etc.
- **Page-specific:** Use exact routes for specific pages
- **Section-specific:** Use regex for groups of pages

**💡 Tip:** Keep common translations small and use route-based loading for page-specific content to optimize performance.

#### Complete Loaders Example

```javascript
const config = {
  parser: parser(),
  loaders: [
    // Common translations (all pages)
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
    
    // Homepage only
    {
      locale: 'en',
      key: 'home',
      routes: ['/'],
      loader: async () => (await import('./en/home.json')).default,
    },
    
    // All product pages
    {
      locale: 'en',
      key: 'products',
      routes: [/^\/products/],
      loader: async () => (await import('./en/products.json')).default,
    },
    
    // Dynamic API loading
    {
      locale: 'en',
      key: 'dynamic',
      loader: async () => {
        const res = await fetch('/api/translations/en/dynamic');
        return await res.json();
      },
    },
  ],
};
```

---

### `translations`

**Type:** `Translations.T` (optional)

Synchronous translations that are available immediately, before any loaders execute.

**Use Cases:**
- Language names (same across all locales)
- Configuration values
- Critical translations needed immediately

**Example:**

```javascript
const config = {
  translations: {
    en: {
      'languages.en': 'English',
      'languages.cs': 'Czech',
      'languages.de': 'German',
    },
    cs: {
      'languages.en': 'Angličtina',
      'languages.cs': 'Čeština',
      'languages.de': 'Němčina',
    },
  },
  loaders: [/* async translations */],
};
```

**Benefits:**
- No loading delay
- Perfect for language switcher
- Available during SSR

---

### `preprocess`

**Type:** `'full' | 'preserveArrays' | 'none' | (input: Translations.Input) => Translations.Input`  
**Default:** `'full'`

Defines how to transform loaded translation data.

#### `'full'` (default)

Flattens all nested objects and arrays to dot notation.

**Input:**

```json
{
  "user": {
    "profile": {
      "name": "Name",
      "settings": ["Option 1", "Option 2"]
    }
  }
}
```

**Output:**

```json
{
  "user.profile.name": "Name",
  "user.profile.settings.0": "Option 1",
  "user.profile.settings.1": "Option 2"
}
```

**Usage:**

```javascript
i18n.t('user.profile.name')
i18n.t('user.profile.settings.0')
```

#### `'preserveArrays'`

Flattens objects but keeps arrays intact.

**Input:**

```json
{
  "user": {
    "profile": {
      "name": "Name",
      "settings": ["Option 1", "Option 2"]
    }
  }
}
```

**Output:**

```json
{
  "user.profile.name": "Name",
  "user.profile.settings": ["Option 1", "Option 2"]
}
```

**Usage:**

```javascript
i18n.t('user.profile.name')
i18n.t('user.profile.settings')[0]  // Access array directly
```

**Use Case:** When you need to iterate over arrays in your components.

#### `'none'`

No preprocessing – keep original structure.

**Input/Output:** Same structure

A lookup is a single own-property read of the locale's table, not a walk down a
path, so without flattening only its **top-level** keys resolve. For
loader-loaded data that top level is the loader `key`:

```javascript
// loaders: [{ key: 'user', locale: 'en', loader: /* the JSON above */ }]
i18n.t('user')           // The whole namespace, exactly as the loader returned it
i18n.t('user.profile')   // Not found – nothing flattened this key
```

**Use Case:** When your parser walks the nested structure itself, or when you read `translations` directly.

#### Custom Function

Create your own preprocessing logic. Like `'none'`, a custom function bypasses
the dot-notation flattening entirely – its return value is stored as-is, so
keys are then looked up exactly as the function produced them (top level only,
see [`'none'`](#none)).

The function is called once per locale with that locale's table. Its top-level
keys are the loader `key`s – or the keys you passed to `addTranslations()` –
with each payload nested underneath.

**Example 1: Add prefixes**

```javascript
const config = {
  preprocess: (input) => Object.fromEntries(
    Object.entries(input).map(([key, value]) => [`app.${key}`, value]),
  ),
};

// loaders: [{ key: 'common', ... }] – the namespace moves under 'app.common'
i18n.t('app.common')
```

**Example 2: Transform values**

```javascript
const config = {
  preprocess: (input) => JSON.parse(JSON.stringify(
    input,
    (_key, value) => (typeof value === 'string' ? value.toUpperCase() : value),
  )),
};

// All translation values will be uppercase; keys stay untouched
```

**Example 3: Merge with defaults**

```javascript
const defaults = { 'common.error': 'An error occurred' };

const config = {
  preprocess: (input) => {
    return { ...defaults, ...input };
  },
};
```

---

### `initLocale`

**Type:** `string` (optional)

Initialize translations immediately with this locale.

**Example:**

```javascript
const config = {
  initLocale: 'en',
  loaders: [/* ... */],
};
```

**Use Cases:**
- Server-side rendering with known locale
- Default language for your app
- Preloading before user interaction

**⚠️ Note:** Translations will load immediately on instance creation. Make sure loaders are ready.

---

### `fallbackLocale`

**Type:** `string` (optional)

Fallback locale when translation is missing in current locale.

**Example:**

```javascript
const config = {
  fallbackLocale: 'en',
  loaders: [/* ... */],
};
```

**Behavior:**

```javascript
// Current locale: 'cs'
// Translation exists in 'cs': returns Czech translation
i18n.t('greeting')  // → "Ahoj"

// Translation missing in 'cs' but exists in 'en': returns English translation
i18n.t('new.feature')  // → "New Feature" (from 'en')

// Translation missing in both: returns fallbackValue or key
i18n.t('nonexistent')  // → "nonexistent"
```

**⚠️ Performance Impact:** Both current locale and fallback locale translations are loaded, doubling network/memory usage. Use only if necessary.

**Use Cases:**
- Gradual translation rollout (new features in English, translate later)
- Incomplete translations
- Development/testing

---

### `fallbackValue`

**Type:** `any` (optional)  
**Default:** Translation key itself

Value returned when translation key is not found.

**Default behavior:**

```javascript
i18n.t('unknown.key')  // → "unknown.key"
```

**Custom fallback:**

```javascript
const config = {
  fallbackValue: '...',
};

i18n.t('unknown.key')  // → "..."
```

**Dynamic fallback:**

```javascript
const config = {
  fallbackValue: '',  // Return empty string
};

i18n.t('unknown.key')  // → ""
```

**Use Cases:**
- Hide missing translations in production
- Show consistent placeholder
- Debugging (default behavior shows missing keys)

---

### `cache`

**Type:** `number` (milliseconds)  
**Default:** `Number.POSITIVE_INFINITY` (never expires)

How long loaded translations stay fresh. Once a locale's translations are
older than this window, the **next load trigger** (`loadTranslations`,
`setLocale`, `setRoute`) runs its loaders again; nothing refetches on its own
in the background.

**Default (never expires):**

```javascript
const config = {
  // cache: Number.POSITIVE_INFINITY — loaders run once per locale and key
};
```

The right fit for the common case: translation files ship with the app and
change only with a deploy.

**Finite cache (CMS or other runtime source):**

```javascript
const config = {
  cache: 3600000,  // Translations older than 1 hour refetch on the next load
};
```

Use this when loaders fetch from a source that can change while the app runs —
a CMS, a translation service API, a database. Long-lived instances (e.g. a
shared server-side instance) then pick up content updates on a later
navigation instead of serving the first fetch forever.

**Always stale:**

```javascript
const config = {
  cache: 0,  // Refetch on every load trigger
};
```

**How it works:**

```
Load trigger (loadTranslations / setLocale / setRoute)
   ↓
Locale's translations older than `cache`? → drop its loaded state
   ↓
Loaders not marked as loaded run again
   ↓
Fresh data replaces the stale keys; freshness is stamped per locale
```

**💡 Tip:** For event-driven refreshes (a CMS webhook, a manual "reload
translations" action), keep the infinite default and call
[`invalidate()`](#invalidatelocale) instead — expiry and manual invalidation
compose.

**Use Cases:**
- **Static translation files:** Keep the default — nothing ever refetches needlessly
- **CMS integration:** Finite cache to reflect content updates, or `invalidate()` on demand
- **Development against live content:** `cache: 0` to always see the latest data

---

### `extensions`

**Type:** `readonly Extension.T[]` (optional)

Extension functions the constructed instance is piped through, left to right.
Each extension receives the surface produced so far — the raw instance for the
first one — and returns the surface handed on. `new I18n(config)` evaluates to
the **last extension's output**.

**Using an official extension:**

```javascript
import { I18n } from '@sveltekit-i18n/base';
import stores from '@sveltekit-i18n/extension-stores';

const { t, locale, loading } = new I18n({
  ...config,
  extensions: [stores],
});
```

**Writing your own** — an extension is just a function. It may augment the
instance in place:

```javascript
const withGreeting = (i18n) => Object.assign(i18n, {
  greet: (name) => i18n.t('common.greeting', { name }),
});

export const i18n = new I18n({ ...config, extensions: [withGreeting] });

i18n.greet('World');
```

…or replace the surface entirely:

```javascript
const minimal = (i18n) => ({
  t: i18n.t,
  setLocale: i18n.setLocale,
  instance: i18n,
});
```

**Behavior:**

- **Construction-time only.** The pipe runs once, inside the constructor. A
  later `loadConfig()` call ignores this property — it cannot re-pipe an
  already-constructed surface.
- **Extensions receive a configured instance.** The synchronous part of the
  config load (config assignment, `translations`, `initLocale` bookkeeping)
  has already happened when the first extension runs.
- **`instanceof` caveat.** When an extension returns a new object, the result
  is no longer `instanceof I18n`. The original instance stays reachable through
  whatever the extension exposes — the official extensions expose it as
  `instance`.
- **Typed end to end.** The type of `new I18n(config)` folds through the
  `extensions` tuple, so the expression's type is the last extension's return
  type (see [TypeScript](#typescript)).

Official extensions live in the
[extensions](https://github.com/sveltekit-i18n/extensions) repository.

---

### `log.level`

**Type:** `'error' | 'warn' | 'debug'`  
**Default:** `'warn'`

Controls logging verbosity.

**Options:**

```javascript
const config = {
  log: {
    level: 'error',   // Only errors
    // level: 'warn',  // Errors and warnings (default)
    // level: 'debug', // Everything (verbose)
  },
};
```

**What gets logged:**

- `'error'`: Critical failures (loader errors, parser errors)
- `'warn'`: Missing translations, locale issues
- `'debug'`: All operations (loading, caching, lookups)

**Use Cases:**
- **Production:** `'error'` or `'warn'`
- **Development:** `'debug'` for troubleshooting
- **Testing:** `'error'` to reduce noise

---

### `log.prefix`

**Type:** `string`  
**Default:** `'[i18n]: '`

Prefix for all log messages.

**Example:**

```javascript
const config = {
  log: {
    prefix: '[MyApp i18n]: ',
  },
};

// Logs will appear as:
// [MyApp i18n]: Translation loaded...
```

---

### `log.logger`

**Type:** `Logger.T`  
**Default:** `console`

Custom logger instance. Every level method takes the prefixed `message` as its
first argument. When the report was caused by a thrown value (e.g. a failed
loader), the raw `error` follows as a second argument — unformatted and
unprefixed, so your logger can render its stack or serialize it as it sees fit.
Reports with no such value are called with the message alone, so `console`
methods never print a trailing `undefined`.

The shape matches the exported `Logger.T` type:

```typescript
type CustomLogger = {
  error: (message: string, error?: unknown) => void;
  warn: (message: string, error?: unknown) => void;
  debug: (message: string, error?: unknown) => void;
};
```

A logger may omit levels it does not care about — a missing method is skipped,
never called.

**Custom logger:**

```javascript
const customLogger = {
  error: (...args) => console.error('ERROR:', ...args),
  warn: (...args) => console.warn('WARN:', ...args),
  debug: (...args) => console.debug('DEBUG:', ...args),
};

const config = {
  log: {
    logger: customLogger,
  },
};
```

**External logging service:**

```javascript
import * as Sentry from '@sentry/browser';

const config = {
  log: {
    logger: {
      error: (message, error) => {
        console.error(message, error);
        Sentry.captureException(error ?? new Error(message));
      },
      warn: console.warn,
      debug: console.debug,
    },
  },
};
```

---

## Instance Properties and Methods

Everything lives on one reactive instance. Reading its properties is reactive
wherever reads are tracked (component templates, `$derived`, `$effect`); the
load-triggering methods return the promise of the **matching** load —
concurrent duplicate triggers for the same locale and route join the load
already in flight (and receive its promise) instead of fetching twice.

```javascript
export const i18n = new I18n(config);
```

Do not destructure value properties off the instance — a destructured value is
a one-time snapshot. `t` and `l` are functions and stay reactive even when
destructured, because their tracked reads happen at call time. To use
destructured value reads in a component, destructure through `$derived` — each
binding then stays in sync with the instance:

```svelte
<script>
  import { i18n } from '$lib/translations';

  const { loading, locale } = $derived(i18n);
</script>

{#if loading}Loading…{:else}{locale}{/if}
```

---

### `t(key, ...params)`

**Type:** `(key: string, ...params: ParserParams) => ParserOutput`

`ParserOutput` is inferred from the configured parser's `parse` return type and
defaults to `string` (see [TypeScript](#typescript)).

Translates `key` for the active locale.

```svelte
<script>
  import { i18n } from '$lib/translations';
</script>

<h1>{i18n.t('home.title')}</h1>
<p>{i18n.t('greeting', { name: 'Alice' })}</p>
```

The call reads the reactive translation table and locale, so the rendered text
updates when either changes. Outside templates it is an ordinary function call.

---

### `l(locale, key, ...params)`

**Type:** `(locale: string, key: string, ...params: ParserParams) => ParserOutput`

Like `t`, for an explicit locale — useful for rendering a language switcher in
each language's own name.

---

### `locale`

**Type:** `string | undefined` (reactive; assignable)

The **active** locale — the one whose translations are loaded. Assigning it is
a shorthand for a fire-and-forget `setLocale()`, so the value advances once the
new locale's translations resolved, not synchronously on assignment.

```svelte
<script>
  import { i18n } from '$lib/translations';
</script>

<p>Current language: {i18n.locale}</p>
<button onclick={() => { i18n.locale = 'en'; }}>English</button>
```

Await the change explicitly when you need to know it finished:

```javascript
await i18n.setLocale('cs');
```

---

### `locales`

**Type:** `string[]` (reactive)

All known locales (from loaders and added translations).

```svelte
{#each i18n.locales as loc}
  <button onclick={() => i18n.setLocale(loc)}>{loc}</button>
{/each}
```

---

### `loading`

**Type:** `boolean` (reactive)

`true` while **any** load is in flight; back to `false` once the last one
settles. To wait for a specific load, await the promise returned by the method
that started it — never poll this flag.

```svelte
{#if i18n.loading}
  <p>Loading translations…</p>
{/if}
```

---

### `initialized`

**Type:** `boolean` (reactive)

`true` once a locale and route are set and translations are present. Useful to
gate the first render:

```svelte
{#if i18n.initialized}
  <slot />
{/if}
```

---

### `translations` / `rawTranslations`

**Type:** `Record<string, Record<string, any>>` (reactive)

The locale-indexed tables — `rawTranslations` before preprocessing,
`translations` after. Treat them as read-only; use `addTranslations()` to
write.

---

### `loadTranslations(locale, route?)`

**Type:** `(locale: string, route?: string) => Promise<void>`

Loads translations for a locale and route, and activates the locale once they
resolved. The canonical SSR wiring:

```javascript
// +layout.js
import { i18n } from '$lib/translations';

export const load = async ({ url }) => {
  await i18n.loadTranslations('en', url.pathname);
  return {};
};
```

**Errors:** a loader that throws is caught and logged individually, so one
broken loader does not fail the batch. Anything that throws afterwards — a
custom `preprocess`, a malformed payload — **rejects the returned promise**, so
`await` surfaces it (in SvelteKit, straight to the error boundary). A result
you discard is safe: the failure is logged through the configured logger and
never becomes an unhandled rejection — but it is then only visible in the log.

---

### `setLocale(locale)`

**Type:** `(locale?: string) => Promise<void>`

Requests a locale. If a route is already set the load starts immediately;
otherwise it fires when the route arrives. An unknown locale (no loader, no
`fallbackLocale` match) resolves without changing anything.

---

### `setRoute(route)`

**Type:** `(route: string) => Promise<void>`

Updates the current route and loads route-scoped translations for the
requested locale, if one is known.

---

### `loadConfig(config)`

**Type:** `(config: Config) => Promise<void>`

(Re)configures the instance — same as passing the config to the constructor.
Safe to call fire-and-forget: a failure is reported through the logger and the
returned promise is marked handled, while an awaiting caller still receives
the rejection.

---

### `addTranslations(translations)`

**Type:** `(translations: Record<string, any>) => void`

Adds translations synchronously (static tables known ahead of time). Payload is
preprocessed per `config.preprocess` and merged into the tables; already-added
keys count as loaded, so matching loaders will not refire.

```javascript
i18n.addTranslations({
  en: { 'lang.en': 'English', 'lang.cs': 'Czech' },
  cs: { 'lang.en': 'Anglicky', 'lang.cs': 'Česky' },
});
```

---

### `snapshot()`

**Type:** `() => Record<string, any>`

Serializes what the instance currently holds for the **active locale** and the
**`fallbackLocale`**, narrowed to the current route. The result is shaped like
[`translations`](#translations), so the receiving instance hydrates by handing
it straight to its constructor — the bookkeeping derived from it keeps the
matching loaders from fetching the same data again:

```javascript
// +layout.server.js — one instance per request
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

export const load = async ({ url, locals }) => {
  const i18n = new I18n(config);

  await i18n.loadTranslations(locals.locale, url.pathname);

  return { locale: locals.locale, translations: i18n.snapshot() };
};
```

```javascript
// +layout.js — the client starts from the server's data
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

export const load = async ({ data, url }) => {
  const i18n = new I18n({ ...config, translations: data.translations });

  await i18n.loadTranslations(data.locale, url.pathname);

  return { i18n };
};
```

What the payload leaves out:

- **Other locales** — only the active locale and the fallback are serialized.
- **Other routes** — a key claimed *only* by loaders whose `routes` do not match
  the current route is dropped; the client loads it when it navigates there. A
  key no loader claims (added through `addTranslations()`) is always kept.

The data is **pre-preprocess** — the [`rawTranslations`](#translations--rawtranslations)
shape — so the receiving instance applies its own `config.preprocess`.
Freshness is not transferred either: the [`cache`](#cache) window of a hydrated
locale starts when the client receives the data, not when the server loaded it.

---

### `invalidate(locale?)`

**Type:** `(locale?: string) => void`

Marks loaded translations stale — for one locale, or for all of them when
called without arguments. The call itself starts **no** load and the currently
displayed translations stay in place; loaders run again on the next load
trigger and fresh data replaces the old.

```javascript
// A CMS webhook / admin action told us the English content changed:
i18n.invalidate('en');

// Nothing happens yet — the next navigation (or explicit load) refetches:
await i18n.loadTranslations('en', location.pathname);
```

A load already in flight when `invalidate()` is called is severed: it still
settles, but its data is discarded — it predates the invalidation — and the
next load trigger starts a fresh fetch instead of joining it.

Works independently of `config.cache`: with the default infinite cache it is
the way to pick up runtime content changes; with a finite cache it forces a
refresh before the window elapses.

---

## Utilities

Two helpers the instance uses internally are published separately, for the
cases where consumer code has to match the library's own behavior:

```javascript
import { sanitizeLocales, toDotNotation } from '@sveltekit-i18n/base/utils';
```

The rest of the internals stays private – the subpath exports these two, plus
the `DotNotation` type they are described with.

### `toDotNotation(input, preserveArrays?)`

**Type:** `<I>(input: I, preserveArrays?: boolean) => DotNotation.Output<I>`

The flattening behind [`preprocess`](#preprocess). A custom `preprocess`
function *replaces* the built-in flattening, so call this when you want to
transform the input and still end up with dot notation:

```javascript
import { toDotNotation } from '@sveltekit-i18n/base/utils';

const defaults = { common: { error: 'An error occurred' } };

const config = {
  preprocess: (input) => toDotNotation({ ...defaults, ...input }),
};

// i18n.t('common.error')
```

Pass `true` as the second argument to keep arrays intact – the
[`'preserveArrays'`](#preprocess) behavior.

---

### `sanitizeLocales(...locales)`

**Type:** `(...locales: any[]) => string[]`

Normalizes locales the way the instance does before storing them, so a value
coming from a URL, a cookie or an `Accept-Language` header can be compared
against [`locale`](#locale) and [`locales`](#locales):

```javascript
import { sanitizeLocales } from '@sveltekit-i18n/base/utils';

const [locale] = sanitizeLocales(page.params.lang); // 'en-us' -> 'en-US'

if (locale && locale !== i18n.locale) await i18n.setLocale(locale);
```

Falsy inputs are dropped, so the result can be shorter than the argument list.
A locale `Intl` does not recognize is lowercased and reported through the
[logger](#loglevel) instead of throwing.

---

## TypeScript

Full TypeScript support with complete type definitions:

```typescript
import { I18n, type Config } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';

// `Config.T` is generic over the parser's params (the rest parameters of
// `t`/`l`) and, optionally, its output. Annotate only when the config lives on
// its own — passed straight to `new I18n(...)`, both are inferred.
type Params = [payload?: Record<string, unknown>];

const config: Config.T<Params> = {
  parser: parser(),
  loaders: [
    {
      locale: 'en',
      key: 'common',
      loader: async () => (await import('./en/common.json')).default,
    },
  ],
};

export const i18n = new I18n(config);
```

The library provides:
- ✅ Complete type definitions for configuration
- ✅ Typed methods and reactive properties (`t`/`l` output inferred from the parser)
- ✅ Generic types for custom parser integration
- ❌ Automatic translation key inference (planned for the type generator)

### Parser params and output inference

`new I18n(config)` infers both the parser's **params** (the rest parameters of
`t`/`l`) and its **output** (their return type) from `config.parser.parse`:

```typescript
const richParser = {
  // parse returns { html: string } instead of a string
  parse: (value: unknown, params: unknown[], locale: string, key: string) => ({
    html: renderSomehow(value, params),
  }),
};

const i18n = new I18n({ parser: richParser, /* ... */ });

i18n.t('home.title'); // typed { html: string }
```

Three cases yield `string`: a parser whose `parse` return type is `any`, one
built against the untyped `Parser.T` default, and one the consumer has no types
for at all. The common case stays ergonomic that way, and a parser producing
anything richer has to declare its output explicitly (e.g. `Parser.T<Params,
HtmlOutput>`).

**Caveat for non-string outputs:** the fail-soft paths bypass the parser
entirely and return a plain string — `''` when the key or the locale is
missing, the key itself when no parser is configured yet (see
[`fallbackValue`](#fallbackvalue)). That string is still typed as the parser's
output, so a component consuming a rich output should tolerate it — either by
setting a `fallbackValue` of the right shape, or by guarding the render.

### Extensions and the constructor's type

`new I18n(config)` is typed through a construct signature that folds the
instance type through the `config.extensions` tuple — the expression's type is
the **last extension's return type**, inferred without any manual annotation:

```typescript
import { I18n, type Extension } from '@sveltekit-i18n/base';
import stores from '@sveltekit-i18n/extension-stores';

// Typed as the store adapter's output — destructuring is fully typed:
const { t, locale, loading } = new I18n({ ...config, extensions: [stores] });
```

A custom extension only needs an accurate function type — `Extension.T<I, O>`
is `(input: I) => O`:

```typescript
const withGreeting = (i18n: I18n) => Object.assign(i18n, {
  greet: (name: string) => i18n.t('common.greeting', { name }),
});

// Typed as I18n & { greet: (name: string) => string }:
export const i18n = new I18n({ ...config, extensions: [withGreeting] });
```

Without `extensions`, the expression is a plain `I18n<ParserParams,
ParserOutput>` — the exported `I18n` name is both the constructor value and the
instance type. Bare `I18n` stands for the `string`-output instance, so
`const i: I18n = new I18n(config)` fits a string parser; a rich-output parser
needs its arguments spelled out (`I18n<Params, HtmlOutput>`), or no annotation
at all, letting the constructor's inference stand.

For type-safe translation keys, see [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md#typescript-patterns).

---

## See Also

- [Getting Started Guide](https://github.com/sveltekit-i18n/lib/tree/master/docs/GETTING_STARTED.md) – Step-by-step tutorial
- [Architecture Overview](https://github.com/sveltekit-i18n/lib/tree/master/docs/ARCHITECTURE.md) – How it works
- [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers
- [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Working code examples
- [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md) – Recommended patterns
