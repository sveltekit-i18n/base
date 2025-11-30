# @sveltekit-i18n/base API Documentation

Complete API reference for `@sveltekit-i18n/base`. This package provides core i18n functionality with support for custom parsers.

## Table of Contents

- [Configuration](#configuration)
- [Instance Properties and Methods](#instance-properties-and-methods)
- [TypeScript](#typescript)
- [See Also](#see-also)

## Configuration

When creating an i18n instance, you can configure it with these options:

```typescript
import i18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';

const config = {
  parser: parser(),
  loaders: [/* ... */],
  // ... other options
};

const { t, locale, loadTranslations } = new i18n(config);
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
  // Translations will be accessible as $t('common.greeting')
}
```

**⚠️ Common Pitfall:** Using dots in the `key` will cause lookup issues:

```javascript
// ❌ Bad
{ key: 'pages.home' }

// ✅ Good
{ key: 'home' }
```

##### `loader` (required)

**Type:** `() => Promise<Record<any, any>>`

Async function that returns translation data.

**Loading from local files:**

```javascript
{
  locale: 'en',
  key: 'common',
  loader: async () => (await import('./en/common.json')).default,
}
```

**Loading from API:**

```javascript
{
  locale: 'en',
  key: 'common',
  loader: async () => {
    const response = await fetch('/api/translations/en/common');
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

**Type:** `Array<string | RegExp>`

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

**Type:** `'full' | 'preserveArrays' | 'none' | (input: Translations.Input) => any`  
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
$t('user.profile.name')
$t('user.profile.settings.0')
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
$t('user.profile.name')
$t('user.profile.settings')[0]  // Access array directly
```

**Use Case:** When you need to iterate over arrays in your components.

#### `'none'`

No preprocessing – keep original structure.

**Input/Output:** Same structure

**Usage:**

```javascript
// Must match your JSON structure exactly
$t('user')           // Returns entire user object
$t('user.profile')   // Returns profile object
```

**Use Case:** When working with complex nested structures or when your parser handles nested objects.

#### Custom Function

Create your own preprocessing logic:

**Example 1: Add prefixes**

```javascript
const config = {
  preprocess: (input) => {
    const output = {};
    Object.keys(input).forEach(key => {
      output[`app.${key}`] = input[key];
    });
    return output;
  },
};

// All keys will have 'app.' prefix
$t('app.greeting')
```

**Example 2: Transform values**

```javascript
const config = {
  preprocess: (input) => {
    return JSON.parse(
      JSON.stringify(input).toUpperCase()
    );
  },
};

// All translations will be uppercase
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
$t('greeting')  // → "Ahoj"

// Translation missing in 'cs' but exists in 'en': returns English translation
$t('new.feature')  // → "New Feature" (from 'en')

// Translation missing in both: returns fallbackValue or key
$t('nonexistent')  // → "nonexistent"
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
$t('unknown.key')  // → "unknown.key"
```

**Custom fallback:**

```javascript
const config = {
  fallbackValue: '...',
};

$t('unknown.key')  // → "..."
```

**Dynamic fallback:**

```javascript
const config = {
  fallbackValue: '',  // Return empty string
};

$t('unknown.key')  // → ""
```

**Use Cases:**
- Hide missing translations in production
- Show consistent placeholder
- Debugging (default behavior shows missing keys)

---

### `cache`

**Type:** `number` (milliseconds)  
**Default:** `86400000` (24 hours)

Server-side cache refresh period.

**Default (24 hours):**

```javascript
const config = {
  cache: 86400000,  // Refresh every 24 hours
};
```

**Disable caching:**

```javascript
const config = {
  cache: Number.POSITIVE_INFINITY,  // Never refresh
};
```

**Short cache (development):**

```javascript
const config = {
  cache: 60000,  // Refresh every minute
};
```

**How it works:**

```
Server starts
   ↓
Translations load
   ↓
Cache for X milliseconds
   ↓
After X milliseconds → reload from source
```

**⚠️ Note:** Only affects server-side. Client-side cache persists for the session.

**Use Cases:**
- **Production:** Long cache (hours/days) for performance
- **Development:** Short cache or infinity for consistency
- **CMS integration:** Short cache to reflect content updates

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

Custom logger instance.

**Custom logger:**

```javascript
const customLogger = {
  log: (...args) => console.log('LOG:', ...args),
  warn: (...args) => console.warn('WARN:', ...args),
  error: (...args) => console.error('ERROR:', ...args),
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
      log: console.log,
      warn: console.warn,
      error: (message) => {
        console.error(message);
        Sentry.captureException(new Error(message));
      },
    },
  },
};
```

---

## Instance Properties and Methods

After creating an i18n instance, you have access to these stores and methods:

```javascript
const { t, locale, locales, loading, initialized, translations, loadTranslations } = new i18n(config);
```

---

### `t`

**Type:** `Readable<(key: string, vars?: Record<any, any>) => string> & { get: (key: string, vars?: Record<any, any>) => string }`

Translation function store.

**In Svelte components:**

```svelte
<script>
  import { t } from '$lib/translations';
</script>

<h1>{$t('home.title')}</h1>
<p>{$t('greeting', { name: 'Alice' })}</p>
```

**In JavaScript/TypeScript files:**

```javascript
import { t } from '$lib/translations';

const message = t.get('home.title');
const greeting = t.get('greeting', { name: 'Alice' });
```

**Parameters:**

- `key` – Translation key (dot notation)
- `vars` – Variables for interpolation (optional)
- Additional parameters passed to parser

**Returns:** Translated string

---

### `l`

**Type:** `Readable<(locale: string, key: string, vars?: Record<any, any>) => string> & { get: (locale: string, key: string, vars?: Record<any, any>) => string }`

Locale-specific translation function. Get translation for a specific locale regardless of current locale.

**Usage:**

```svelte
<script>
  import { l } from '$lib/translations';
</script>

<!-- Always show English version -->
<p>{$l('en', 'home.title')}</p>

<!-- Always show Czech version -->
<p>{$l('cs', 'home.title')}</p>

<!-- With variables -->
<p>{$l('en', 'greeting', { name: 'Bob' })}</p>
```

**Use Cases:**
- Showing multiple languages simultaneously
- Language comparison tools
- Admin interfaces

---

### `locale`

**Type:** `Writable<string> & { get: () => string }`

Current locale store.

**Read current locale:**

```svelte
<script>
  import { locale } from '$lib/translations';
</script>

<p>Current language: {$locale}</p>
```

**Change locale:**

```svelte
<script>
  import { locale } from '$lib/translations';
  
  function switchToEnglish() {
    locale.set('en');
  }
</script>

<button on:click={switchToEnglish}>English</button>
```

**In JS files:**

```javascript
import { locale } from '$lib/translations';

const currentLocale = locale.get();
locale.set('cs');
```

---

### `locales`

**Type:** `Readable<string[]>`

Array of all available locales (from loaders).

**Usage:**

```svelte
<script>
  import { locale, locales } from '$lib/translations';
</script>

<select bind:value={$locale}>
  {#each $locales as loc}
    <option value={loc}>{loc}</option>
  {/each}
</select>
```

**Returns:** `['en', 'cs', 'de', ...]`

---

### `loading`

**Type:** `Readable<boolean> & { toPromise: () => Promise<void[]>, get: () => boolean }`

Loading state indicator.

**Show loading state:**

```svelte
<script>
  import { loading, t } from '$lib/translations';
</script>

{#if $loading}
  <p>Loading translations...</p>
{:else}
  <p>{$t('home.title')}</p>
{/if}
```

**Wait for loading:**

```javascript
import { loading } from '$lib/translations';

await loading.toPromise();
// Translations are now loaded
```

**Check loading state:**

```javascript
if (loading.get()) {
  console.log('Still loading...');
}
```

---

### `initialized`

**Type:** `Readable<boolean>`

Initialization state.

**Usage:**

```svelte
<script>
  import { initialized } from '$lib/translations';
</script>

{#if $initialized}
  <p>App is ready!</p>
{/if}
```

**Use Case:** Show app content only after first translation loads.

---

### `translations`

**Type:** `Readable<{ [locale: string]: { [key: string]: string } }> & { get: () => object }`

All preprocessed translations store.

**Structure:**

```javascript
{
  en: {
    'common.greeting': 'Hello',
    'home.title': 'Welcome',
  },
  cs: {
    'common.greeting': 'Ahoj',
    'home.title': 'Vítejte',
  },
}
```

**Usage:**

```svelte
<script>
  import { translations } from '$lib/translations';
</script>

<pre>{JSON.stringify($translations, null, 2)}</pre>
```

**Use Cases:**
- Debugging
- Checking available translations
- Custom translation logic

---

### `rawTranslations`

**Type:** `Readable<{ [locale: string]: { [key: string]: any } }> & { get: () => object }`

All loaded translations before preprocessing.

**Difference from `translations`:**

- `rawTranslations`: Original nested structure
- `translations`: After preprocessing (flattened)

---

### `loadTranslations`

**Type:** `(locale: string, route?: string) => Promise<void>`

Load translations for a specific locale and route.

**Usage in layouts:**

```javascript
// +layout.js
import { loadTranslations } from '$lib/translations';

export const load = async ({ url }) => {
  await loadTranslations('en', url.pathname);
  return {};
};
```

**Parameters:**
- `locale` – Locale to load
- `route` – Current route (optional, for route-based loading)

**What it does:**
1. Sets the locale
2. Finds matching loaders
3. Executes loaders (if not cached)
4. Preprocesses translations
5. Updates stores

---

### `setLocale`

**Type:** `(locale: string) => Promise<void>`

Set locale and load its translations.

**Usage:**

```javascript
import { setLocale } from '$lib/translations';

await setLocale('cs');
// Czech translations are now loaded and active
```

**Safety features:**
- Converts to lowercase
- Validates locale exists in config
- Loads translations if not cached

---

### `setRoute`

**Type:** `(route: string) => Promise<void>`

Update current route and load route-specific translations.

**Usage:**

```javascript
import { setRoute } from '$lib/translations';

await setRoute('/products/electronics');
// Translations for /products/* are loaded
```

**Use Case:** Manual route tracking (usually handled by `loadTranslations`).

---

### `loadConfig`

**Type:** `(config: Config) => Promise<void>`

Replace current configuration.

**Usage:**

```javascript
import { loadConfig } from '$lib/translations';

await loadConfig({
  parser: newParser(),
  loaders: [/* new loaders */],
});
```

**Use Case:** Dynamic configuration (advanced scenarios).

---

### `getTranslationProps`

**Type:** `(locale: string, route?: string) => Promise<[{ [locale: string]: Record<string, string> }, Record<string, string[]>]>`

Get translations and keys for a specific locale/route without storing them.

**Usage:**

```javascript
import { getTranslationProps } from '$lib/translations';

const [translations, keys] = await getTranslationProps('en', '/about');
console.log(translations);  // { en: { 'about.title': 'About' } }
console.log(keys);           // { en: ['about'] }
```

**Use Case:** Server-side pre-loading, custom caching logic.

---

### `addTranslations`

**Type:** `(translations?: { [locale: string]: Record<string, any> }, keys?: Record<string, string[]>) => void`

Manually add translations to the store.

**Usage:**

```javascript
import { addTranslations } from '$lib/translations';

addTranslations({
  en: {
    'custom.key': 'Custom value',
  },
}, {
  en: ['custom'],
});
```

**Use Cases:**
- Manual translation injection
- Testing
- Dynamic translation updates

---

## TypeScript

Full TypeScript support with complete type definitions:

```typescript
import i18n, { type Config } from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-default';
import type { Config as ParserConfig } from '@sveltekit-i18n/parser-default';

const config: Config<ParserConfig> = {
  parser: parser(),
  loaders: [
    {
      locale: 'en',
      key: 'common',
      loader: async () => (await import('./en/common.json')).default,
    },
  ],
};

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
```

The library provides:
- ✅ Complete type definitions for configuration
- ✅ Typed API methods and stores
- ✅ Generic types for custom parser integration
- ❌ Automatic translation key inference (not built-in)

For type-safe translation keys, see [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md#typescript-patterns).

---

## See Also

- [Getting Started Guide](https://github.com/sveltekit-i18n/lib/tree/master/docs/GETTING_STARTED.md) – Step-by-step tutorial
- [Architecture Overview](https://github.com/sveltekit-i18n/lib/tree/master/docs/ARCHITECTURE.md) – How it works
- [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers
- [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Working code examples
- [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md) – Recommended patterns
