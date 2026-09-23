# @sveltekit-i18n/base API Documentation

Complete API reference for `@sveltekit-i18n/base`. This package provides core i18n functionality with support for custom parsers.

## Table of Contents

- [Configuration](#configuration)
- [Instance Properties and Methods](#instance-properties-and-methods)
- [Server-Side Rendering](#server-side-rendering)
- [Utilities](#utilities)
- [The parser contract](#the-parser-contract)
- [TypeScript](#typescript)
- [See Also](#see-also)

## Configuration

When creating an i18n instance, you can configure it with these options:

```typescript
import { I18n } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

const config = {
  parser: parser({ onReport: null }),
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
import parser from '@sveltekit-i18n/parser-curly';

const config = {
  parser: parser({
    onReport: null,
    // other parser-specific options
  }),
};
```

What the factory takes is the parser's business, not the core's. Both official
parsers require `onReport` to be stated — `null` included — so that silence
about parser diagnostics is a decision rather than an omission; the samples in
this document state `null` because they have nowhere to route a report.

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

**Type:** `string | readonly string[]`

The locale identifier this loader is for (e.g., `'en'`, `'cs'`, `'de-DE'`), or a
list of them. A loader naming several locales is called once per locale, with
the one it is loading in its `locale` prop — see
[Several locales and namespaces](#several-locales-and-namespaces). Every listed
locale is sanitized like a single one and appears in [`locales`](#locales).

**Example:**

```javascript
{
  locale: 'en',
  // ...
}
```

##### `namespace` (required)

**Type:** `string | readonly string[]`

Translation namespace identifier. This acts as a prefix for translation keys. A
list names several namespaces: the loader is then called once per namespace,
with the one it is loading in its `namespace` prop.

**Rules:**
- Cannot contain dots (`.`)
- Use descriptive names (`common`, `home`, `auth`, etc.)

**Example:**

```javascript
{
  locale: 'en',
  namespace: 'common',
  // Translations will be accessible as i18n.t('common.greeting')
}
```

> **`key` is the deprecated spelling of this property.** A loader may still name
> its namespace `key` — it is honored exactly as `namespace` is, and reported
> once through the [logger](#loglevel) at `warn`. Naming both is a type error,
> and `key` takes a single namespace only. The alias is scheduled for removal in
> the next major.

**⚠️ Common Pitfall:** Using dots in the `namespace` will cause lookup issues (a
config-time `logger.error` reports such namespaces, but the loader still runs):

```javascript
// ❌ Bad
{ namespace: 'pages.home' }

// ✅ Good
{ namespace: 'home' }
```

**Sharing a namespace.** Several loaders may declare the same `locale` and
`namespace`:

- Their data is **merged** where they fill in different parts of the
  namespace — every loader contributes its own branches.
- A value is **replaced** where the same translation is declared twice (or one
  loader's object meets another's string). Within one load the loader
  declared later in `loaders` wins; across loads the data delivered last does.
  The collision is reported through the [logger](#loglevel).

**Each loader is recorded on its own.** A loader that has run does not count
for its siblings, so a namespace can be split into `routes`-scoped chunks —
each chunk loads on its own route and merges into what the others delivered:

```javascript
loaders: [
  { locale: 'en', namespace: 'common', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
  { locale: 'en', namespace: 'common', routes: ['/about'], loader: async () => ({ menu: { about: 'About' } }) },
]
// after visiting '/' and then '/about'
// i18n.t('common.menu.home')  => 'Home'
// i18n.t('common.menu.about') => 'About'
```

##### `loader` (required)

**Type:** `(props: { locale: string; namespace: string; route: string; params: Record<string, string> }) => Promise<Record<any, any>>`

Async function that returns translation data. It receives the load context —
the sanitized `locale` and the `namespace` this run fetches translations for,
the `route` the load was triggered for, and the `params` its
[`routes`](#route-params) captured (`{}` when they capture none). Loaders that
don't need the context can simply take no parameters.

A loader that throws is reported and runs again on the next load trigger. One
that returns nothing (`undefined` or `null`) has answered: it counts as loaded,
with no keys, just as one returning `{}` does.

**Loading from local files:**

```javascript
{
  locale: 'en',
  namespace: 'common',
  loader: async () => (await import('./en/common.json')).default,
}
```

**Loading from API (using the load context):**

```javascript
{
  locale: 'en',
  namespace: 'common',
  loader: async ({ locale }) => {
    const response = await fetch(`/api/translations/${locale}/common`);
    return await response.json();
  },
}
```

**⚠️ `route` is context, not a cache key.** A loader runs at most once per
locale per freshness window (see [`cache`](#cache)) and per set of
[route params](#route-params) — a later route yielding the same params does not
run it again. So a loader whose payload varies by `route` itself would serve the
first route's data everywhere. Capture the part of the route the data depends
on as a route param, or scope the data with [`routes`](#routes-optional), and
use the `route` argument for diagnostics:

```javascript
{
  locale: 'en',
  namespace: 'checkout',
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
  namespace: 'common',
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
  namespace: 'admin',
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
  namespace: 'home',
  routes: ['/'],
  loader: async () => (await import('./en/home.json')).default,
}
```

**Multiple routes:**

```javascript
{
  locale: 'en',
  namespace: 'products',
  routes: ['/products', '/shop'],
  loader: async () => (await import('./en/products.json')).default,
}
```

**Regular expressions:**

```javascript
{
  locale: 'en',
  namespace: 'products',
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

##### Route params

A named capture group in a route `RegExp` is a load parameter. Its match reaches
the loader as `params`, and the loader runs again whenever the params change:

```javascript
{
  locale: 'en',
  namespace: 'article',
  routes: [/^\/article\/(?<articleId>[^/]+)/],
  loader: async ({ locale, params }) => {
    const response = await fetch(`/api/articles/${params.articleId}/i18n/${locale}`);
    return await response.json();
  },
}
// '/article/5'          => runs with { articleId: '5' }
// '/article/6'          => runs again with { articleId: '6' }
// '/article/6/comments' => same params, does not run
```

- **Only a `RegExp` yields params.** A string route (an exact match) and a
  custom matcher yield `{}`, and so does a loader without `routes`.
- **The first matching route decides.** Where several `routes` match, the
  params come from the first one in the array. A group that took no part in the
  match is left out.
- **New params replace the old data.** What the loader delivered for the
  previous params is removed before its new data is added, so no key of
  article 5 survives on article 6, and browsing many articles does not keep
  them all in memory. Its siblings in the namespace keep their part. The
  tradeoff: going back to article 5 fetches it again.
- **The params are the cache key, not the route.** Two routes yielding the same
  params describe the same data and load it once.
- **The current route's params win.** Loads that settle out of order apply only
  the data of the params the current route asks for; an older load for other
  params is discarded.

Use a non-capturing group (`(?:...)`) where you only need grouping.

**Custom matchers:**

Any value with a `test` method works. It receives the bare route path (e.g.
`/products/123`), so a matcher that expects a full URL has to be wrapped. Keep
it pure — a matcher may be consulted more than once per load:

```javascript
{
  locale: 'en',
  namespace: 'products',
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
  namespace: 'common',
  // No routes specified → loads on every page
  loader: async () => (await import('./en/common.json')).default,
}
```

**Use Cases:**

- **Common translations:** Omit `routes` for navigation, errors, etc.
- **Page-specific:** Use exact routes for specific pages
- **Section-specific:** Use regex for groups of pages

**💡 Tip:** Keep common translations small and use route-based loading for page-specific content to optimize performance.

**Loader descriptors are read once.** `locale`, `namespace`, `loader` and `routes`
are captured when the config is applied, so a property implemented as a getter
is not re-evaluated on later loads. A descriptor that throws while being read
is reported through the [logger](#loglevel) and dropped — the remaining loaders
keep working, and [`locales`](#locales) lists the ones that resolved.

#### Several locales and namespaces

A descriptor may list several locales, several namespaces, or both. It stands
for one loader per locale and namespace pair: every pair shares the
descriptor's `loader` and `routes`, and the loader is called once per pair with
that pair's `locale` and `namespace` in its props. A loader that computes its
source from the props therefore needs one descriptor per set of `routes`,
instead of one per locale and namespace — this is the recommended way to write
a config:

```javascript
loaders: [
  {
    locale: ['en', 'cs'],
    namespace: ['common', 'nav', 'footer'],
    loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
  },
  {
    locale: ['en', 'cs'],
    namespace: 'home',
    routes: ['/'],
    loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
  },
]
```

Written out by hand, the config above is eight descriptors. Both spellings
behave the same. Every call still returns one namespace's table, and all pairs
that match a load are called before the first one is awaited. A pair named twice
in one descriptor counts once. A descriptor whose list is empty stands for no
loader, and is reported through the [logger](#loglevel) at `warn`.

Code that reads `config.loaders` from outside the instance sees the lists as
authored. [`resolveLoaders`](#utilities) from `@sveltekit-i18n/base/utils` turns
them into the single-valued loaders the instance itself works with.

#### Complete Loaders Example

```javascript
const config = {
  parser: parser({ onReport: null }),
  loaders: [
    // Common translations (all pages), one call per locale and namespace
    {
      locale: ['en', 'cs'],
      namespace: ['common', 'nav'],
      loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
    },

    // Homepage only
    {
      locale: ['en', 'cs'],
      namespace: 'home',
      routes: ['/'],
      loader: async ({ locale, namespace }) => (await import(`./${locale}/${namespace}.json`)).default,
    },

    // All product pages
    {
      locale: 'en',
      namespace: 'products',
      routes: [/^\/products/],
      loader: async () => (await import('./en/products.json')).default,
    },
    
    // Dynamic API loading
    {
      locale: 'en',
      namespace: 'dynamic',
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
loader-loaded data that top level is the loader `namespace`:

```javascript
// loaders: [{ namespace: 'user', locale: 'en', loader: /* the JSON above */ }]
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
keys are the loader `namespace`s – or the keys you passed to `addTranslations()` –
with each payload nested underneath.

**Example 1: Add prefixes**

```javascript
const config = {
  preprocess: (input) => Object.fromEntries(
    Object.entries(input).map(([key, value]) => [`app.${key}`, value]),
  ),
};

// loaders: [{ namespace: 'common', ... }] – the namespace moves under 'app.common'
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
`Schema.FromConfig`, `Schema.FromInstance`, `Schema.Key`, `Schema.Params` and
`Schema.Payload` — for generators and wrapper packages; application code only
supplies `schema`. `FromConfig` reads the slot off a config, `FromInstance` off
a constructed instance — what an extension has in hand when it types its own
output.

---

### `cache`

**Type:** `number` (milliseconds)  
**Default:** `Number.POSITIVE_INFINITY` (never expires)

How long loaded translations stay fresh. Once a locale's translations are
older than this window, the **next activating load trigger**
(`loadTranslations`, `setLocale`, `setRoute`) runs its loaders again; nothing
refetches on its own in the background, and a `loadTranslations()` call with
[`{ activate: false }`](#loadtranslationslocale-route-options) does not evaluate the
window.

**Default (never expires):**

```javascript
const config = {
  // cache: Number.POSITIVE_INFINITY — each loader runs once per locale and route params
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
Activating load trigger (loadTranslations / setLocale / setRoute)
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

**Type:** `(key: string, ...params: ParserParams) => ParserOutput | string`

`ParserOutput` is inferred from the configured parser's `parse` return type and
defaults to `string` (see [TypeScript](#typescript)). The `| string` is the
miss: an empty key, no active locale or a config carrying no parser yet returns
a plain string without the parser ever being called, so a parser declaring a
rich output is handed both. For a parser returning a string — every parser this
project ships — the union collapses and the type is `string`.

That is the un-narrowed signature: a [`schema`](#schema) narrows `key` to its
keys and `params` to the payload that key declares.

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

**Type:** `(locale: string, key: string, ...params: ParserParams) => ParserOutput | string`

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

`true` while **any** activating load is in flight; back to `false` once the
last one settles. A load started with `{ activate: false }` does not count until
an activating trigger joins it — it does not change what is rendered. To wait
for a specific load, await the promise returned by the method that started it —
never poll this flag.

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

### `loadTranslations(locale, route?, options?)`

**Type:** `(locale: string, route?: string, options?: { activate?: boolean }) => Promise<void>`

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

**`{ activate: false }`** only fills the tables. The requested locale, the
current route and [`locale`](#locale) stay as they were, and the load does not
count towards [`loading`](#loading), so nothing on screen changes. It uses the
same loader selection, bookkeeping and in-flight deduplication as an activating
call, and `invalidate()` severs it the same way. A loader whose
[route params](#route-params) differ from the ones the current route asks for
still runs, but its data is discarded rather than replacing what is displayed.
It does not evaluate the
[`cache`](#cache) window; the next activating trigger does. An activating trigger
for the same locale and route joins it: `loading` turns `true`, and the locale
activates when the shared load settles. Once it has settled, the activating call
fetches nothing and activates at once, unless the locale's `cache` window has
elapsed in the meantime.

```javascript
// Fetch what a link needs without switching to it.
await i18n.loadTranslations('de', '/about', { activate: false });
```

The option exists only here. On `setLocale()` and `setRoute()` activation is the
whole point of the call.

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

### `addTranslations(translations)`

**Type:** `(translations: Record<string, any>) => void`

Adds translations synchronously (static tables known ahead of time). Payload is
preprocessed per `config.preprocess` and merged into the tables; already-added
namespaces count as loaded, so their loaders do not refire — except a loader
whose [route params](#route-params) ask for data of their own. Locale keys are
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

### `snapshot(options?)`

**Type:** `(options?: { records?: boolean }) => Record<string, any> | Snapshot.Envelope`

Serializes what the instance currently holds for the **active locale** and the
**`fallbackLocale`**, whichever routes loaded it — the server half of the
[SSR hand-off](#server-side-rendering). Two forms:

- **`snapshot({ records: true })`** returns an envelope for
  [`hydrate()`](#hydrateenvelope): the data, the loaders that delivered it, the
  active locale and the route. This is the form to hand to a client.
- **`snapshot()`** returns the data alone, shaped like
  [`translations`](#translations). Applied with
  [`addTranslations()`](#addtranslationstranslations), it keeps every loader of
  every namespace it names from running.

```javascript
// +layout.server.js — one instance per request
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

export const load = async ({ url, locals }) => {
  const i18n = new I18n(config);

  await i18n.loadTranslations(locals.locale, url.pathname);

  return { i18n: i18n.snapshot({ records: true }) };
};
```

The envelope is plain data — strings, arrays and plain objects — so SvelteKit
serializes it like any other load data. Its locales are held sanitized and are
not sanitized again, so take it from `snapshot()` rather than building it by
hand. `Snapshot.Envelope` is its type.

What the payload leaves out:

- **Other locales** — only the active locale and the fallback are serialized.
- **A namespace fed by several loaders when one of them can capture [route
  params](#route-params).** The client could not tell which part of the
  namespace each loader delivered, so the next params could not replace theirs.
  The client loads the namespace itself. The same goes for a namespace whose
  one loader can capture params but holds no record — after an
  [`invalidate()`](#invalidatelocale), say.
- **A loader that cannot be named off-process** — two loaders the config spells
  the same, or whose only difference is a `RouteMatcher` — stays out of the
  records. Its data is handed over, and the client runs the loader again.
- **A literal `__proto__` key**, at any depth — SvelteKit serializes load data
  with `devalue`, which refuses an object carrying one, so keeping it would fail
  the render. The key is dropped with a warning; the rest of its namespace is
  kept.

Without records, plain data cannot say which loader delivered what, so
`snapshot()` also leaves out **every** namespace fed by several loaders — the
namespace record it would leave on the client would keep a loader whose part
is missing from running — and every namespace of a loader whose `routes` can
capture params, which on the client would count as data supplied without a
loader. The client loads those itself.

The data is **pre-preprocess** — the [`rawTranslations`](#translations--rawtranslations)
shape — so the receiving instance applies its own `config.preprocess`.
Freshness is not transferred either: the [`cache`](#cache) window of a hydrated
locale starts when the client receives the data, not when the server loaded it.

---

### `hydrate(envelope?)`

**Type:** `(envelope?: Snapshot.Envelope) => void`

Restores the state [`snapshot({ records: true })`](#snapshotoptions) captured
on another instance — the client half of the [SSR
hand-off](#server-side-rendering):

- the **data** is displayed at once;
- a loader named by the **records** does not run again for the same [route
  params](#route-params), while its siblings on other routes still run when
  their route matches; new params replace its data as they would after a load;
- data no record names is displayed, but keeps no loader from running — a
  loader the records do not cover loads again rather than going missing;
- the **active locale** and the **route** are restored, so the instance is
  [`initialized`](#initialized) and `t()` renders the server's locale before any
  load has run.

```javascript
// +layout.js — the client starts from the server's state
import { I18n } from '@sveltekit-i18n/base';
import { config } from '$lib/translations';

export const load = async ({ data, url }) => {
  const i18n = new I18n(config);

  i18n.hydrate(data.i18n);

  await i18n.loadTranslations(i18n.locale, url.pathname);

  return { i18n };
};
```

The envelope is **applied on top of** the config: a config that carries its own
`translations` keeps them.

`hydrate(undefined)` does nothing, so a `load` whose server half sent nothing
can call it unconditionally. An envelope without `records` is applied as plain
data, the way [`addTranslations()`](#addtranslationstranslations) applies it.
A record naming no loader of the client's config — one whose `routes` the two
sides spell differently, say — is dropped, and its loader runs again.

Call it before any load starts. With [`initLocale`](#initlocale) set, the
constructor starts one before `hydrate()` can be called, so the loaders run
regardless; `hydrate()` warns when that happens.

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
`loadConfig`, `addTranslations`, `hydrate`, `invalidate`) is ignored with a
warning.

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

Create **one instance per request** instead, and hand its state to the client
with [`snapshot()`](#snapshotoptions) and [`hydrate()`](#hydrateenvelope).

### 1. Export the config, not the instance

```javascript
// src/lib/translations/index.js
import parser from '@sveltekit-i18n/parser-curly';

/** @type {import('@sveltekit-i18n/base').Config.T} */
export const config = {
  parser: parser({ onReport: null }),
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

  return { i18n: i18n.snapshot({ records: true }) };
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
  let i18n = client;

  if (!i18n) {
    i18n = new I18n(config);

    i18n.hydrate(data.i18n);

    if (browser) client = i18n;
  }

  await i18n.loadTranslations(data.i18n?.locale ?? i18n.locale, url.pathname);

  return { i18n };
};
```

This `load` runs on the server for the SSR pass and again in the browser on
hydration. Both start from the server's state: the loaders that delivered on
the server do not run a second time, and the locale is active before the first
render. Only what the server did not load — the route-scoped translations of
pages the visitor has not opened yet, and the few namespaces the snapshot
cannot hand over — is fetched. Every later client-side navigation reuses the
same instance, so its cache survives.

The hand-off is applied once, inside the branch that builds the instance —
replaying it on a later navigation would mark loaders loaded again after an
[`invalidate()`](#invalidatelocale). It is applied on top of the config, so
whatever the config declares stays where it is.

Leave [`initLocale`](#initlocale) out of a config used this way. It starts its
load inside the constructor, before the hand-off can be applied, so the loaders
run regardless (and [`hydrate()`](#hydrateenvelope) warns) — the locale belongs
in the `loadTranslations()` call above.

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

Four pure helpers are published separately: three the instance uses
internally, for the cases where consumer code has to match the library's own
behavior, and one the instance never calls, for deciding which locale to ask it
for:

```javascript
import { matchLocale, resolveLoaders, sanitizeLocales, toDotNotation } from '@sveltekit-i18n/base/utils';
```

The rest of the internals stays private – the subpath exports these four, plus
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

### `resolveLoaders(loaders, sanitizeLocales?)`

**Type:** `(loaders?: readonly Loader.LoaderModule[], sanitizeLocales?: Config.SanitizeLocales) => Loader.Resolved[]`

Normalizes `config.loaders` the way the instance does when a config is applied,
for code that reads a config from outside the instance – a type generator, a
build step, a test:

```javascript
import { resolveLoaders } from '@sveltekit-i18n/base/utils';

resolveLoaders(config.loaders, config.sanitizeLocales);
// [{ locale: 'en', namespace: 'common', loader, routes, id: '["en","common"]' }, ...]
```

Every result has a single `locale` and a single `namespace`:

- A descriptor listing several locales or namespaces expands into one loader
  per pair (see [Several locales and namespaces](#several-locales-and-namespaces)).
- The deprecated `key` is read as the namespace.
- Each locale goes through [`sanitizeLocales`](#sanitizelocales). The second
  argument takes the config option's value, and defaults to `true` as the
  option does.

A descriptor that cannot be read, or that names no locale or no namespace, is
dropped and reported through the [logger](#loglevel).

Each result also carries an `id`: a string base derives from the loader's
locale, namespace and routes, used to name the loader outside the process that
resolved it. A loader never declares one. The same content yields the same id
on every run and in every process, and a string route and a pattern with the
same text yield different ids. How a route is **spelled** decides the id, not
what it matches, and a custom matcher contributes only that it is one. Loaders
whose content would give them the same id get `null` instead.

---

### `matchLocale(requested, available)`

**Type:** `<const L extends string>(requested: string | readonly string[] | null | undefined, available: readonly L[]) => L | undefined`

A locale rarely arrives spelled the way the config spells it. It comes from a
URL segment, a cookie or an `Accept-Language` header, so it carries `en-GB`,
`cs-CZ`, quality weights and casing nobody controls, while the configured set is
usually coarser. This is the bridge between the two:

```javascript
import { matchLocale } from '@sveltekit-i18n/base/utils';

matchLocale('en-GB,en;q=0.9,cs;q=0.8', ['en', 'cs']); // 'en'
matchLocale('cs-CZ', ['en', 'cs']);                   // 'cs'
matchLocale('de-AT', ['en', 'cs']);                   // undefined
```

`requested` is an `Accept-Language` field value, a single locale, or a
preference list such as `navigator.languages`. `available` is the configured
set, and the winner comes back **as `available` spells it**, so it can be handed
straight to [`setLocale()`](#setlocalelocale).

**What it does, exactly:**

1. **Matching scheme** – [RFC 4647](https://www.rfc-editor.org/rfc/rfc4647)
   *Lookup*: the requested range, then its progressively shorter prefixes
   (`zh-Hant-TW` → `zh-Hant` → `zh`), compared case-insensitively. Only when
   that finds nothing is the range **as written** tried once more as a prefix,
   so a request for `en` also reaches a configured `en-GB`.
2. **One result, or none** – a miss is `undefined` rather than a guess. What a
   miss means stays yours to decide, usually [`fallbackLocale`](#fallbacklocale).
3. **`q` weights** order the ranges, and `q=0` refuses one – beaten only by a
   strictly more specific range that matched.
4. **`*`** is read the way HTTP reads it: a preference of its own, consulted
   after every concrete range of the same weight.

**⚠️ Only the REQUESTED locale is ever truncated.** An available locale is
compared as you spelled it, and no region or script is ever inferred from
another, so a sibling is never substituted:

```javascript
matchLocale('en-AU', ['en-US']);    // undefined – not 'en-US'
matchLocale('zh-Hant', ['zh-Hans']); // undefined – not 'zh-Hans'
```

That is the whole of it: there is no CLDR data here, no likely-subtags
expansion, and `zh-Hant` → `zh` is a string operation rather than a knowledge
lookup. An app that needs real language negotiation reaches for a package built
on CLDR; this closes the everyday gap instead of becoming one of them.

**⚠️ The result is only as narrow as `available` is.** A plain `string[]` types
the result `string | undefined`; an array literal, an `as const` list or
[`locales`](#locales) keeps the union:

```typescript
const wide: string[] = ['en', 'cs'];

matchLocale('en-GB', wide);              // string | undefined
matchLocale('en-GB', ['en', 'cs']);      // 'en' | 'cs' | undefined
matchLocale('en-GB', i18n.locales);      // the instance's own locale union
```

**Server – the `Accept-Language` header:**

```javascript
// src/hooks.server.js
import { matchLocale } from '@sveltekit-i18n/base/utils';

const LOCALES = ['en', 'cs'];

export const handle = async ({ event, resolve }) => {
  event.locals.locale = matchLocale(event.cookies.get('locale'), LOCALES)
    ?? matchLocale(event.request.headers.get('accept-language'), LOCALES)
    ?? 'en';

  return resolve(event);
};
```

A visitor's explicit choice outranks their browser's, and `undefined` from both
lands on the app's default – which is why a miss is not answered with a guess.

**Client – `navigator.languages`:**

```javascript
import { matchLocale } from '@sveltekit-i18n/base/utils';

const preferred = matchLocale(navigator.languages, i18n.locales);

if (preferred && preferred !== i18n.locale) await i18n.setLocale(preferred);
```

Nothing here reads a request or a browser by itself: the helper computes a
locale from values you pass it, and assigning it stays your call.

---

## The parser contract

A parser is the only part of translation this package does not own. It receives
a translation value and returns the message a consumer renders. What follows is
what base guarantees a parser, what it requires back, and what it deliberately
leaves to the message format.

An adapter is a parser. `parse` may delegate to an implementation this project
has nothing to do with — `@sveltekit-i18n/parser-curly` is a thin adapter over
the [Curly Message Format](https://curlymessage.dev)'s reference
implementation, and `@sveltekit-i18n/parser-icu` wraps `intl-messageformat`.
The contract binds the adapter, not the engine behind it.

### What base guarantees before `parse` is called

`config.parser.parse(value, params, locale, key)`, always with four arguments,
in that order:

- **`value`** — the translation the tables hold for `key`, read as an **own**
  property, after [`preprocess`](#preprocess). It is arbitrary data: a string
  in the ordinary case, but whatever a loader returned otherwise. Never
  `undefined`: a key resolving to no translation in the active locale nor in
  [`fallbackLocale`](#fallbacklocale) is answered by base itself, and `parse`
  is not called at all.
- **`params`** — the rest arguments of the `t`/`l` call, as an array. An
  argumentless call passes `[]`, never `undefined`. Base does not read into it,
  does not validate it and does not fill it in; a [`schema`](#schema) narrows
  it at the type level only.
- **`locale`** — the locale the lookup resolved against, normalized by
  [`sanitizeLocales`](#sanitizelocales) where that yields one and as the caller
  spelled it otherwise. Never `undefined`: with no locale there is nothing to
  look up, and `parse` is not called at all.
- **`key`** — the serialized dot-notation path (`home.content.title`), the key
  as the caller spelled it.

Base calls `parse` on the `t`/`l` path and nowhere else. It is never called
during loading, preprocessing, serialization or hydration.

### What every parser must do

Regardless of format:

- **An undefined message must not throw.** Base does not hand one over — a key
  resolving to nothing is answered by [`fallbackValue`](#fallbackvalue), which
  defaults to the key echoed verbatim, and that is what makes a missing
  translation visible instead of blank. A parser called directly still has to
  answer rather than throw.
- **Undefined or surplus params must not throw.** `params` is whatever the call
  site passed. A message naming a parameter the payload omits is a normal
  event, not an error.
- **Errors stay inside `parse`.** A throwing parser propagates out of `t`,
  which is a render. Contain the failure and return something renderable —
  this package fails soft at its edges and a parser is one of them.

### What the format decides, and base does not

Out of contract, and expected to differ between parsers: the message syntax
itself; what a missing parameter renders as; whether a parameter has a default;
pluralization and selection rules; number, date and currency formatting; and
escaping. A consumer switching parsers is switching message formats, and these
are the things that change.

### What comes back

`parse` may return anything. `ParserOutput` is a class type parameter, so a
parser declaring a richer return type surfaces it on `t`/`l` (see
[Parser params and output inference](#parser-params-and-output-inference)); a
parser that declares none means `string`.

Base does not inspect, transform, validate or serialize what `parse` returns.
The value is handed to the caller of `t`/`l` and reaches nothing else — in
particular [`translations`](#translations--rawtranslations),
`rawTranslations` and [`snapshot()`](#snapshotoptions) all carry the translation
tables, before and after preprocessing, and never parser output. A rich return
type therefore has no effect on the SSR payload or on hydration.

The one qualification is the miss: the paths that never reach the parser return
a plain string, which is why `t`/`l` are typed `ParserOutput | string`. See
[`t(key, ...params)`](#tkey-params).

### The build-time half

A parser may also ship a message scanner for schema generation. It is not part
of `Parser.T` and the core never calls it — see
[Message parameter extraction](#message-parameter-extraction).

---

## TypeScript

Full TypeScript support with complete type definitions:

```typescript
import { I18n, type Config } from '@sveltekit-i18n/base';
import parser, { type Parser } from '@sveltekit-i18n/parser-curly';

// `Config.T` is generic over the parser's params (the rest parameters of
// `t`/`l`) and, optionally, its output. Annotate only when the config lives on
// its own — passed straight to `new I18n(...)`, both are inferred. Take the
// tuple from the parser rather than spelling it by hand: a hand-written one
// silently drops the slots the parser declares beyond the payload.
type Params = Parser.Params;

const config: Config.T<Params> = {
  parser: parser({ onReport: null }),
  loaders: [
    {
      locale: 'en',
      namespace: 'common',
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

i18n.t('home.title'); // typed { html: string } | string
```

Three cases yield `string`: a parser whose `parse` return type is `any`, one
built against the untyped `Parser.T` default, and one the consumer has no types
for at all. The common case stays ergonomic that way, and a parser producing
anything richer has to declare its output explicitly (e.g. `Parser.T<Params,
HtmlOutput>`).

**Why the `| string`:** the fail-soft paths bypass the parser entirely and
return a plain string — `''` when the key or the locale is missing, and the key
itself when the translation is missing and no
[`fallbackValue`](#fallbackvalue) is configured. The signature says so rather
than asserting the parser's output through those paths, so a consumer of a rich
output has to narrow before using it. A `fallbackValue` of the right shape covers the miss
that has one; the others stay strings whatever the config says.

### Locale completion

`new I18n(config)` also reads the locales the config **names** and completes
them on the instance. Every config slot carrying one feeds the same union: each
loader's `locale`, [`initLocale`](#initlocale),
[`fallbackLocale`](#fallbacklocale) and the keys of
[`translations`](#translations).

```typescript
const i18n = new I18n({
  parser: parser({ onReport: null }),
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
new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });  // inline

const frozen = { parser: parser({ onReport: null }), initLocale: 'en' } as const;
new I18n(frozen);                                  // `as const`

const checked = { parser: parser({ onReport: null }), initLocale: 'en' } as const satisfies Config.T<Params>;
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
  parser: parser({ onReport: null }),
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
parser ships it as a **separate export** instead — given ESM and
`sideEffects: false`, a bundle that never reaches it drops it. It is an
`ExtractParamsFactory` taking the same options the runtime parser takes: options
decide what a message means (a custom modifier, a disabled tag syntax), so a
generator has to build the extractor the way the app builds its parser:

```typescript
import type { Parser } from '@sveltekit-i18n/base';

// Your parser exposes this as an export of its own:
declare const extractParamsFactory: Parser.ExtractParamsFactory<{ modifiers?: string[] }>;

const extract: Parser.ExtractParams = extractParamsFactory({ modifiers: [] });

// Whatever the parser's own message syntax is:
const params: readonly Parser.ParamSpec[] = extract('Hello {name}!', { key: 'common.greeting' });
```

A value that is not a message the parser recognizes yields `[]` rather than
throwing — translation leaves are arbitrary data. The second argument
(`Parser.ExtractContext`, `{ key?, locale? }`) is diagnostic only; no
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
  is there for parsers that can prove it — no official parser reports it today.
- **`values`** — values the message names explicitly. A **hint** for authoring
  tools, never an exhaustive set: every official parser that reports them falls
  back to a default branch for anything unlisted, so it must not be used to
  close a union. It is omitted where the listed values are not values at all
  (numeric thresholds, plural categories) or mean the opposite (an inequality's
  operands).
- **`optional`** — whether the message renders without the parameter; defaults
  to `false`. A parameter only some selector branches use is optional:
  over-approximating trades a missed error for never demanding a parameter the
  caller's branch has no use for.
- **`when`** — the selector branches the parameter lives under, outermost first
  (`{ param, branch }[]`). It lets a generator emit a discriminated payload
  instead of the flat `optional: true` approximation; a generator that does not
  care can ignore it.

Every official parser ships one as a root export: `parser-curly`, `parser-icu`,
`parser-mf2` and `parser-i18next` each export `extractParamsFactory`, and
`sveltekit-i18n` re-exports the curly one beside the instance it types.

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
