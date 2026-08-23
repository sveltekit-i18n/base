# @sveltekit-i18n/base API Documentation

Complete API reference for `@sveltekit-i18n/base`. This package provides core i18n functionality with support for custom parsers.

## Table of Contents

- [Configuration](#configuration)
- [Instance Properties and Methods](#instance-properties-and-methods)
- [Server-Side Rendering](#server-side-rendering)
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

**Type:** `readonly Loader.LoaderModule[]` (optional)

Array of loader configurations that define how and when translations should be loaded.

#### Loader Properties

Both `loaders` and a loader's `routes` are typed as **readonly** arrays, so a
whole config frozen with `as const` — routed loaders included — is accepted (see
[Locale completion](#locale-completion)).

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

**Sharing a key.** Several loaders may declare the same `locale` and `key`:

- Their data is **merged** where they fill in different parts of the
  namespace — every loader contributes its own branches.
- A value is **replaced** where the same translation is declared twice (or one
  loader's object meets another's string). The loader declared later in
  `loaders` wins and the collision is reported through the
  [logger](#loglevel).

**A key is loaded only once per locale.** Loaders sharing a key therefore merge
only when they run in the same load — when their `routes` all match the route
that triggered it:

```javascript
loaders: [
  { locale: 'en', key: 'common', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
  { locale: 'en', key: 'common', loader: async () => ({ menu: { about: 'About' } }) },
]
// both loaders run when '/' is loaded
// i18n.t('common.menu.home')  => 'Home'
// i18n.t('common.menu.about') => 'About'
```

As soon as one loader has supplied `common`, every other `common` loader is
skipped — including one that never had the chance to run, because its `routes`
did not match.

**⚠️ Common Pitfall:** Splitting one namespace into `routes`-scoped chunks. Give
each route a key of its own instead:

```javascript
// ❌ Bad — a visitor landing on '/about' loads `common` from the second loader,
// and moving to '/' no longer runs the first one
loaders: [
  { locale: 'en', key: 'common', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
  { locale: 'en', key: 'common', routes: ['/about'], loader: async () => ({ menu: { about: 'About' } }) },
]
// i18n.t('common.menu.home') => not loaded

// ✅ Good
loaders: [
  { locale: 'en', key: 'home', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
  { locale: 'en', key: 'about', routes: ['/about'], loader: async () => ({ menu: { about: 'About' } }) },
]
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

**Type:** `readonly (string | RegExp | { test: (route: string) => boolean })[]`

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

**⚠️ Named capture groups are reserved.** A named group in a route `RegExp` —
`/^\/article\/(?<articleId>[^/]+)/` — matches today exactly as any other group
does, and the loader still runs at most once per locale per freshness window.
A future minor may read those matches as load parameters and re-run the loader
when they change, so don't rely on named groups staying inert. Use a
non-capturing group (`(?:...)`) where you only need grouping.

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

**Loader descriptors are read once.** `locale`, `key`, `loader` and `routes`
are captured when the config is applied, so a property implemented as a getter
is not re-evaluated on later loads. A descriptor that throws while being read
is reported through the [logger](#loglevel) and dropped — the remaining loaders
keep working, and [`locales`](#locales) lists the ones that resolved.

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

Locale keys are normalized per [`sanitizeLocales`](#sanitizelocales), so by
default `EN` and `en` are one entry — the one `t()` reads.

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

### `sanitizeLocales`

**Type:** `boolean | ((locale: string) => string)` (optional)  
**Default:** `true`

How locale identifiers are normalized before they key anything —
[`translations`](#translations), [`loaders`](#loaders),
[`initLocale`](#initlocale), [`fallbackLocale`](#fallbacklocale), the
[translation tables](#translations--rawtranslations) and every locale you pass
to `l()`, `setLocale()`, `loadTranslations()` or
[`invalidate()`](#invalidatelocale).

**Default (`true`) — ISO normalization:**

```javascript
const config = {
  // sanitizeLocales: true — 'en-us', 'EN-US' and 'en-US' are one locale: 'en-US'
};
```

Locales are resolved through `Intl`, so one locale is spelled one way no matter
where the value came from — a URL segment, a cookie, an `Accept-Language`
header. A locale `Intl` does not recognize is lowercased and reported through
the [logger](#loglevel).

**`false` — locales stay exactly as authored:**

```javascript
const config = {
  sanitizeLocales: false,
  translations: { CS: { greeting: 'Ahoj' } },
};

i18n.locale;  // → 'CS'
```

Nothing is normalized, so `CS` and `cs` are two different locales. Use this
when your locale identifiers are not ISO codes, or when their exact spelling is
part of your URLs.

**A function — normalize your way:**

```javascript
const config = {
  sanitizeLocales: (locale) => locale.toLowerCase(),  // 'en-US' -> 'en-us'
};
```

The function receives every locale before it is used as a key, and its return
value is what gets stored and reported by [`locale`](#locale) and
[`locales`](#locales). It runs on lookups too, so keep it cheap and pure. A
call that throws — or returns nothing usable — falls back to the locale as
authored and is reported through the [logger](#loglevel).

Because normalization may map an arbitrary input onto a known locale, the locale
union TypeScript completes on the instance stays open — see
[Locale completion](#locale-completion).

**Use Cases:**
- **Default:** one spelling per locale, whatever the source
- **`false`:** non-ISO locale identifiers, or spellings that have to round-trip
- **Function:** a project-wide convention (e.g. always lowercase)

---

### `schema`

**Type:** `{ [translationKey]: PayloadType }` (optional)

A map of each translation key to the payload its message expects — the slot a
generated schema artifact fills. Supplying it types [`t()`](#tkey-params) and
[`l()`](#llocale-key-params): keys autocomplete, an unknown key is a type error,
and the payload argument is checked against the key's entry.

**Only the type is read.** Nothing reads this value at runtime, so the artifact
may be empty as long as it is typed:

```typescript
type TranslationSchema = {
  'common.greeting': { name: string };  // payload required
  'common.about': never;                // message takes no parameters
  'home.title': { title?: string };     // nothing required — payload optional
};

const i18n = new I18n({
  ...config,
  schema: {} as TranslationSchema,
});
```

**Accepted calls:**

```typescript
i18n.t('common.greeting', { name: 'Alice' });
i18n.t('common.about');
i18n.t('home.title');
```

**Rejected calls:**

```typescript
i18n.t('common.headline');                  // unknown translation key
i18n.t('common.greeting');                  // missing payload
i18n.t('common.greeting', { name: 42 });    // wrong payload shape
i18n.t('common.about', { title: 'About' }); // payload for a message that takes none
```

**Payload rules:**

- `never`, `undefined`, `void` or `null` — the message takes no parameters, so
  the payload argument is omitted, and passing one is a type error.
- A payload with no **required** property (`{ name?: string }`), or one the
  schema itself marks optional (`{ value: string } | undefined`) — the argument
  may be omitted.
- `any` — the payload slot stays unchecked. That is not the same as "no
  payload": anything passes, nothing is demanded.
- A **union of keys** (`t(condition ? 'a' : 'b', …)`) takes the
  **intersection** of their payloads — one call has to satisfy every key it
  might be.

The payload occupies slot 0 of the parser's params, so a parser's **trailing**
slots survive: an ICU `formats` argument still type-checks after the payload.

**⚠️ A schema whose keys are not a closed set is ignored.** An open index
signature (`Record<string, …>`), or a schema with no keys at all, would reject
every key or demand a payload for keys it knows nothing about — so keys stay
plain strings instead and calls are typed as if no schema were supplied:

```typescript
new I18n({ ...config, schema: {} });
new I18n({ ...config, schema: {} as Record<string, { value: string }> });
```

**⚠️ Construction time only.** The type is read off the config the constructor
receives: a later [`loadConfig()`](#loadconfigconfig) cannot retype an existing
instance, and an [`extension`](#extensions) typed by a fixed return type erases
the instance's type parameters altogether — that surface is typed by the
extension, not by the schema. An extension typed by an `Extension.Operator`
keeps them (see [Extensions and the constructor's type](#extensions-and-the-constructors-type)).

No generator ships in this package: the schema is a type you hand-write for a
small project, or a generated artifact for a large one (see
[Message parameter extraction](#message-parameter-extraction) for the
build-time contract a generator reads messages through). The types the slot is
resolved through are exported from the package root as the `Schema` namespace —
`Schema.FromConfig`, `Schema.Key`, `Schema.Params` and `Schema.Payload` — for
generators and wrapper packages; application code only supplies `schema`.

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
Fresh data merges over the stale keys; freshness is stamped per locale
```

**Expiry refreshes, it never removes.** A refetch merges leaf by leaf into what
is already displayed, so a message the source dropped since the first load stays
until the instance is recreated. The same holds for
[`invalidate()`](#invalidatelocale) — both drop the bookkeeping that would
prevent a refetch, neither clears the tables.

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
  type. An extension whose output shape depends on the surface it receives
  declares that dependency with an `Extension.Operator` (see
  [TypeScript](#typescript)).

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
destructured, because their tracked reads happen at call time. Their identity
is refreshed whenever the config, the translations or the locale change, so a
component that only holds the reference — passing `t` to a child, say — is
tracked as well. To use destructured value reads in a component, destructure
through `$derived` — each binding then stays in sync with the instance:

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
defaults to `string` (see [TypeScript](#typescript)). That is the un-narrowed
signature: a [`schema`](#schema) narrows `key` to its keys and `params` to the
payload that key declares.

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
each language's own name. A [`schema`](#schema) narrows `key` and `params` just
as it does on `t`, and the locales the config names complete `locale` (see
[Locale completion](#locale-completion)). The locale is normalized before the lookup
([`sanitizeLocales`](#sanitizelocales)), so by default `l('EN', ...)` and
`l('en', ...)` read the same table.

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
`translations` after. Indexed by the normalized locale
([`sanitizeLocales`](#sanitizelocales)), the same value
[`locale`](#locale) reports. Treat them as read-only; use `addTranslations()`
to write.

---

### `loadTranslations(locale, route?)`

**Type:** `(locale: string, route?: string) => Promise<void>`

Loads translations for a locale and route, and activates the locale once they
resolved.

```javascript
// +layout.js
import { i18n } from '$lib/translations';

export const load = async ({ url }) => {
  await i18n.loadTranslations('en', url.pathname);
  return {};
};
```

The instance above is a module-level singleton, which on the server is shared
by every request in the process — see
[Server-Side Rendering](#server-side-rendering) for the per-request wiring.

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

**Type:** `(config: Config.T) => Promise<void>`

(Re)configures the instance — same as passing the config to the constructor.
Safe to call fire-and-forget: a failure is reported through the logger and the
returned promise is marked handled, while an awaiting caller still receives
the rejection.

---

### `configLoader(config)`

**Type:** `(config: Config.T) => Promise<void>`

The overridable seam a config is applied through. `loadConfig()` delegates to
it, and the constructor goes through `loadConfig()`, so a wrapper package that
subclasses the instance can inject its own defaults and have them apply to
`new I18n(config)` as well — `sveltekit-i18n` wires its default parser this
way.

Application code calls [`loadConfig()`](#loadconfigconfig) instead: the public
entry adds the destroyed-instance guard and marks the rejection handled, and
this method does neither.

---

### `addTranslations(translations)`

**Type:** `(translations: Record<string, any>) => void`

Adds translations synchronously (static tables known ahead of time). Payload is
preprocessed per `config.preprocess` and merged into the tables; already-added
keys count as loaded, so matching loaders will not refire. Locale keys are
normalized ([`sanitizeLocales`](#sanitizelocales)) before they are merged.

Merging goes branch by branch, so a payload for a namespace that already holds
data adds to it instead of replacing it; a leaf declared twice takes the
incoming value.

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

### `destroy()`

**Type:** `() => void`

Detaches the instance from its loading lifecycle. Loads still in flight settle
with their data discarded, [`loading`](#loading) drops to `false`, and every
further load or mutation call (`loadTranslations`, `setLocale`, `setRoute`,
`loadConfig`, `addTranslations`, `invalidate`) is ignored with a warning.

Reads keep working — `t`, `l`, `locale`, `translations` and `snapshot()` still
return the instance's last state, so a component that is still tearing down
renders instead of breaking.

Call it when a per-request or per-component instance goes out of scope:

```svelte
<script>
  import { I18n } from '@sveltekit-i18n/base';
  import { config } from '$lib/translations';

  const i18n = new I18n(config);

  $effect(() => () => i18n.destroy());
</script>
```

A module-level singleton lives as long as the app and needs no call. The method
is idempotent — calling it twice is a no-op.

---

## Server-Side Rendering

A module that creates an instance is evaluated **once per process** on the
server, not once per request. A module-level singleton is therefore shared by
every visitor being rendered concurrently: two requests for different locales
overwrite each other's `locale` and translation tables, and one visitor's
language can end up in another visitor's HTML.

Create **one instance per request** instead, and hand its data to the client
with [`snapshot()`](#snapshot).

### 1. Export the config, not the instance

```javascript
// src/lib/translations/index.js
import parser from '@sveltekit-i18n/parser-default';

/** @type {import('@sveltekit-i18n/base').Config.T} */
export const config = {
  parser: parser(),
  loaders: [/* ... */],
};
```

### 2. Load on the server, per request

```javascript
// src/routes/+layout.server.js
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

export const load = async ({ url, locals }) => {
  const i18n = new I18n(config);

  await i18n.loadTranslations(locals.locale, url.pathname);

  return { locale: locals.locale, translations: i18n.snapshot() };
};
```

`locals.locale` is whatever your `handle` hook resolved from the cookie, the URL
or the `Accept-Language` header — [`sanitizeLocales()`](#sanitizelocaleslocales)
normalizes such a value the way the instance does.

### 3. Build the instance the app renders with

```javascript
// src/routes/+layout.js
import { browser } from '$app/environment';
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

// Assigned in the browser only — on the server this module-level binding
// would be the shared state we are avoiding.
let client;

export const load = async ({ data, url }) => {
  const i18n = client ?? new I18n({ ...config, translations: data.translations });

  if (browser) client = i18n;

  await i18n.loadTranslations(data.locale, url.pathname);

  return { i18n };
};
```

This `load` runs on the server for the SSR pass and again in the browser on
hydration. Both start from the server's snapshot, so the loaders behind it do
not run a second time; only data the snapshot left out — the route-scoped
translations of pages the visitor has not opened yet — is fetched. Every later
client-side navigation reuses the same instance, so its cache survives.

### 4. Pass it down through context

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { setContext } from 'svelte';

  let { data, children } = $props();

  setContext('i18n', data.i18n);
</script>

{@render children()}
```

```svelte
<!-- any component -->
<script>
  import { getContext } from 'svelte';

  const i18n = getContext('i18n');
</script>

<p>{i18n.t('common.greeting')}</p>
```

The instance is reactive, so components re-render on a locale change without
any store subscription.

### When a singleton is enough

The shared-state problem exists only on the server. A module-level instance is
safe when the server renders nothing visitor-specific:

- the app is client-only (`export const ssr = false`), or
- every request renders the same locale.

Then the [Quick Start](../README.md#quick-start) wiring — one
`export const i18n = new I18n(config)` imported wherever it is needed — is all
you need. An instance with a shorter life than the app (a per-request one, or a
component-scoped one) should be released with [`destroy()`](#destroy) when its
owner goes away.

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

This is the DEFAULT normalization only: an instance configured with
[`sanitizeLocales`](#sanitizelocales) keys its locales its own way, so a value
compared against [`locale`](#locale) has to go through that same transform.

---

## TypeScript

Full TypeScript support with complete type definitions:

```typescript
import { I18n, type Config } from '@sveltekit-i18n/base';
import parser, { type Parser } from '@sveltekit-i18n/parser-default';

// `Config.T` is generic over the parser's params (the rest parameters of
// `t`/`l`) and, optionally, its output. Annotate only when the config lives on
// its own — passed straight to `new I18n(...)`, both are inferred. Take the
// tuple from the parser rather than spelling it by hand: a hand-written one
// silently drops the slots the parser declares beyond the payload.
type Params = Parser.Params;

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
- ✅ Typed translation keys and payloads, from a [`schema`](#schema) you supply
- ❌ Generating that schema from your translation files — the slot ships, not the generator

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

### Locale completion

`new I18n(config)` also reads the locales the config **names** and completes
them on the instance. Every config slot carrying one feeds the same union: each
loader's `locale`, [`initLocale`](#initlocale),
[`fallbackLocale`](#fallbacklocale) and the keys of
[`translations`](#translations).

```typescript
const i18n = new I18n({
  parser: parser(),
  initLocale: 'en',
  fallbackLocale: 'de',
  translations: { cs: { greeting: 'Ahoj' } },
  loaders: [{ locale: 'sk', key: 'common', loader: async () => ({}) }],
});

i18n.locale;  // 'en' | 'de' | 'cs' | 'sk' | (string & {}) | undefined
```

The union narrows **inputs** — `setLocale()`, `loadTranslations()`,
`invalidate()`, the first argument of `l()`, and assignment to
[`locale`](#locale) — and the **reads** [`locale`](#locale) and
[`locales`](#locales). The [translation tables](#translations--rawtranslations)
are not narrowed: they stay plain `string`-keyed records.

**The union is open** — `Config.LocaleInput<L>` is `L | (string & {})`, so it
drives completion without closing the input. A locale can arrive from a URL, a
cookie or an `Accept-Language` header, and
[`sanitizeLocales`](#sanitizelocales) may map an arbitrary input onto a known
one. With the default normalization, an unlisted spelling compiles and lands on
the locale it normalizes to:

```typescript
await i18n.setLocale('EN');

i18n.locale;  // → 'en'
```

Staying open also keeps the narrowed instance assignable in both directions, so
narrowing never makes the instance type invariant:

```typescript
const plain: I18n = i18n;
const narrowed: I18n<any, string, never, 'en' | 'de'> = plain;
```

**The literals survive** when the config reaches the constructor as a literal
type:

```typescript
new I18n({ parser: parser(), initLocale: 'en' });  // inline

const frozen = { parser: parser(), initLocale: 'en' } as const;
new I18n(frozen);                                  // `as const`

const checked = { parser: parser(), initLocale: 'en' } as const satisfies Config.T<Params>;
new I18n(checked);                                 // `as const satisfies`
```

**They are lost** — the union degrades to plain `string` — when the config is
annotated (`const config: Config.T<Params> = { initLocale: 'en', … }`, since
the annotation, not the literal, is the type the constructor sees), or when it
is assigned separately without `as const` (`const config = { initLocale: 'en' }`
widens `initLocale` to `string`).

**⚠️ One dynamic source degrades the whole union.** A config that builds its
loaders from a runtime array yields `string` even where it also names a
literal:

```typescript
const locales: string[] = ['cs', 'sk'];

const config = {
  parser: parser(),
  initLocale: 'en',
  loaders: locales.map((locale) => ({ locale, key: 'common', loader: async () => ({}) })),
} as const;

// Config.LocalesFromConfig<typeof config> is `string`, not `'en'`
```

A half-known set would complete `'en'` while silently **hiding** every locale
the dynamic source names — worse than completing nothing at all.

`Config.LocaleInput<L>` and `Config.LocalesFromConfig<C>` are both exported, for
code that has to spell the union it works with.

### Message parameter extraction

A [`schema`](#schema) maps each key to a payload, and something has to derive
that payload from the messages themselves. `Parser.ExtractParams` is the
**build-time** half of the parser contract: given a translation value, it
reports the parameters that message expects, and a schema generator turns those
reports into the schema artifact. **The core never calls it** — nothing in this
package extracts anything at runtime.

It is deliberately **not** a member of `Parser.T`. A message scanner attached to
the runtime parser object could never be shaken out of a browser bundle, so a
parser ships it from its **own subpath** instead, as an `ExtractParamsFactory`
taking the same options the runtime parser takes — options decide what a message
means (a custom modifier, a disabled tag syntax), so a generator has to build
the extractor the way the app builds its parser:

```typescript
import type { Parser } from '@sveltekit-i18n/base';

// Your parser exposes this from its own subpath:
declare const extractParamsFactory: Parser.ExtractParamsFactory<{ modifiers?: string[] }>;

const extract: Parser.ExtractParams = extractParamsFactory({ modifiers: [] });

// Whatever the parser's own message syntax is:
const params: readonly Parser.ParamSpec[] = extract('Hello {name}!', { key: 'common.greeting' });
```

A value that is not a message the parser recognizes yields `[]` rather than
throwing — translation leaves are arbitrary data. The second argument
(`Parser.ExtractContext`, `{ key?, locale? }`) is diagnostic only; neither
official parser needs it to extract.

**`Parser.ParamSpec` fields:**

- **`name`** (required) — the key the payload is read by, already unescaped. It
  is not necessarily a valid identifier, so a generator has to quote it.
- **`kind`** — `'unknown' | 'string' | 'number' | 'boolean' | 'date' |
  'function'`, or an array of them when the message uses the parameter in
  several ways and any of them is valid. `'unknown'` is the **top** of this
  lattice, not a conflict marker: merging it with anything yields the other
  kind. `'date'` covers date and time formatting and means `Date | number`.
  `'function'` is a rich-text callback, the shape ICU tags require. `'boolean'`
  is there for parsers that can prove it — neither official parser can, since
  both compare stringified values.
- **`values`** — values the message names explicitly. A **hint** for authoring
  tools, never an exhaustive set: both official parsers fall back to a default
  branch for anything unlisted, so it must not be used to close a union. It is
  omitted where the listed values are not values at all (numeric thresholds,
  plural categories) or mean the opposite (an inequality's operands).
- **`optional`** — whether the message renders without the parameter; defaults
  to `false`. A parameter only some selector branches use is optional:
  over-approximating trades a missed error for never demanding a parameter the
  caller's branch has no use for.
- **`when`** — the selector branches the parameter lives under, outermost first
  (`{ param, branch }[]`). It lets a generator emit a discriminated payload
  instead of the flat `optional: true` approximation; a generator that does not
  care can ignore it.

No official parser ships an extractor yet — these types are the contract one
will ship against.

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

**Keeping the surface an extension was handed.** The extension above spells its
input as the bare `I18n`, so that is what the pipe folds on: the
[`schema`](#schema) and the locale union the config narrowed are gone from the
result. Making the function generic (`<I>(i18n: I) => I & { … }`) does not help
— reading a generic signature instantiates its type parameters at their
constraints, so the pipe would fold `unknown` and erase the surface entirely.

Declare the dependency as an `Extension.Operator` instead. It is an interface
with an `input` and an `output`, and the output is expressed through `this`:

```typescript
import { I18n, type Extension } from '@sveltekit-i18n/base';

interface WithGreeting extends Extension.Operator {
  readonly output: this['input'] & { greet: (name: string) => string };
}

const withGreeting: Extension.Generic<WithGreeting> = (i18n: I18n) => Object.assign(i18n, {
  greet: (name: string) => i18n.t('common.greeting', { name }),
});

// Typed as the narrowed instance & { greet: … } — schema and locales intact:
export const i18n = new I18n({ ...config, extensions: [withGreeting] });

i18n.t('common.greeting', { name: 'World' }); // still key- and payload-checked
```

`Extension.Generic<O>` is `Extension.T` carrying `O` as a type-only brand, so
the function itself is written as usual — the annotation is the only difference.
The pipe applies each operator to the surface reaching it, so operators compose:
a stores adapter layered over a greeting extension sees both. An extension
without an operator keeps the old behavior and contributes its declared return
type.

Without `extensions`, the expression is a plain
`I18n<ParserParams, ParserOutput, TranslationSchema, LocaleUnion>` — the
exported `I18n` name is both the constructor value and the instance type. The
trailing two parameters default to no schema and open locales, so bare `I18n`
stands for the `string`-output, un-narrowed instance:
`const i: I18n = new I18n(config)` fits a string parser, while a rich-output
parser needs its arguments spelled out (`I18n<Params, HtmlOutput>`), or no annotation at all,
letting the constructor's inference stand.

For type-safe translation keys, supply a [`schema`](#schema); the wider
TypeScript patterns live in [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md#typescript-patterns).

---

## See Also

- [Getting Started Guide](https://github.com/sveltekit-i18n/lib/tree/master/docs/GETTING_STARTED.md) – Step-by-step tutorial
- [Architecture Overview](https://github.com/sveltekit-i18n/lib/tree/master/docs/ARCHITECTURE.md) – How it works
- [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers
- [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Working code examples
- [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md) – Recommended patterns
