# @sveltekit-i18n/base API Documentation

Complete API reference for `@sveltekit-i18n/base`. This package provides core i18n functionality with support for custom parsers.

The snippets import from `src/lib` through `#lib`, the entry `sv create`
scaffolds in the `imports` field of a SvelteKit 3 app's `package.json`, and name
the file's extension, which TypeScript needs to resolve such an import. A
SvelteKit 2 app adds the same entry, `"imports": { "#lib/*": "./src/lib/*" }`,
or imports from `$lib` instead, without the extension — as it must on Vite 5
when a `.ts` file is imported from a `.js` module or a plain `<script>`.

## Table of Contents

- [Configuration](#configuration)
- [Instance Properties and Methods](#instance-properties-and-methods)
- [SvelteKit](#sveltekit)
- [Server-Side Rendering](#server-side-rendering)
- [Utilities](#utilities)
- [The parser contract](#the-parser-contract)
- [TypeScript](#typescript)
- [Upgrading from 3.2](#upgrading-from-32)
- [Upgrading from 3.1](#upgrading-from-31)
- [Upgrading from 3.0](#upgrading-from-30)
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

What the factory takes is the parser's business, not the core's. Every official
parser — curly, icu, mf2 and i18next — requires `onReport` to be stated, `null`
included, so that silence about parser diagnostics is a decision rather than an
omission; the samples in this document state `null` because they have nowhere
to route a report.

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
> through the [logger](#loglevel) at `warn` once per loader descriptor, however
> many instances read it. Naming both is a type error,
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
  The collision is reported through the [logger](#loglevel) when both values
  are merged in one pass — one load delivering both, the namespace rebuilt
  because one of its loaders delivered again, or a reconfiguration keeping, as
  seed data, what the loaders it dropped delivered — not when a later load
  simply overrides an earlier one.

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
the `route` the load was triggered for (without [`basePath`](#basepath)), and the `params` its
[`routes`](#route-params) captured (`{}` when they capture none). Loaders that
don't need the context can simply take no parameters. A loader must not
await a load of the same instance for the route it was called with —
`setLocale()`, `loadNamespace()` and the rest: that load can be the one waiting
for the loader, which then never settles. A load of another route, such as the
navigation a remote `query`'s `redirect()` waits on, is a load of its own.

A loader that throws is reported and runs again on the next load trigger; the
rest of the load lands without its data. One that returns nothing (`undefined`
or `null`) has answered: it counts as loaded, with no keys, just as one
returning `{}` does.

The exception is SvelteKit's control flow — `redirect()`, and `error()` below
500. It is told by the shape of what SvelteKit throws — an integer `status`
from 300 to 308 with a string `location`, or an integer `status` from 400 to
499 with an object `body`, each an own property of a value that is neither an
`Error` of this realm nor tagged `'Error'` — so nothing is imported from
`@sveltejs/kit`. It **rejects the load**
with the thrown value, unchanged, once the load's other loaders have settled:
`loadTranslations()`, `setLocale()`, `setRoute()`, `loadNamespace()` and the
`initLocale` load of [`loadConfig()`](#loadconfigconfig) reject with it, and so
does every call that shares the load, a warm one included. Awaited in code
SvelteKit runs — a `load`, the `handle` hook, an endpoint, a form action or a
remote function — it reaches SvelteKit, which follows it; code of your own that
awaits a call, an event handler say, follows it itself (SvelteKit's
`isRedirect()` and `isHttpError()` tell it apart). Assigning
[`locale`](#locale), the `initLocale` load the constructor starts and any call
nobody awaits only log it. The load reports it once through the logger, at the
`error` level, whether or not the call is awaited. When several loaders throw
it, the first in `loaders` order wins — the requested locale's before the
[`fallbackLocale`](#fallbacklocale)'s, whose loaders take part in the load of
every locale.

- **A call that fails is undone.** A call fails when a loader of its load
  throws control flow, whether the call rejects with it or a later call
  replaced it (below), and when what its load brought cannot be applied — a
  custom [`preprocess`](#preprocess) that throws. The locale does not advance, and the requested locale,
  the route and the [route params](#route-params) go back to what the call
  replaced — unless a later call that has not failed came in the meantime: a
  `setLocale()`, a `setRoute()`, an activating `loadTranslations()` or a
  [`hydrate()`](#hydrateenvelope). Should that later call fail too, both are
  undone. A later `setRoute()` therefore loads the locale asked for before, not
  the rejected one. The request put back activates at once when its data is
  already there — or leaves it to its own activating load still in flight,
  which activates it or fails — and is loaded again otherwise — the undo starts that load
  itself, `loading` shows it, and it joins a load of the request still in
  flight — unless the undo put back the very request that failed, or a loader
  it needs threw for it in the load of a call the undo drops: a failure never runs again by itself, so the
  next trigger loads that. A locale or a route nothing was asked for before stands,
  each on its own: it is all there is for the next trigger to load. A call
  whose data could not be applied keeps its route, which the page is on
  already, so the locale put back is loaded for that route; a call before it
  keeps that route too, whether it failed already or fails later.
- **What the other loaders delivered is kept**, as a
  [warm load](#loadtranslationslocale-route-options) keeps it: it lands in the
  tables without activating anything, and the next trigger does not fetch it
  again (a [`cache: false`](#cache-optional) loader aside). What was fetched
  for params the route no longer asks for is kept aside, as a warm load's is. The loaders that threw,
  whether control flow or a failure, run again. Should applying it fail — a
  custom [`preprocess`](#preprocess) that throws — that is logged, none of it
  is kept, and the call still rejects with the control flow.
- **Control flow a later call replaced is discarded.** The load of a call a
  later one replaced — with another locale, or with other route params for the
  loader that threw — resolves without it. A later route that does not select
  that loader asks it for no params, so it replaces the load of params its
  routes captured, not one of none. A warm load asks for
  nothing, so nothing replaces its control flow, unless it shares the load of
  an activating call, whose outcome it then gets. What a loader throws is
  discarded like its data when an invalidation severed it before its load
  settled — [`invalidate()`](#invalidatelocale-namespace), an elapsed
  [`cache`](#cache) window, [`loadConfig()`](#loadconfigconfig) or
  [`destroy()`](#destroy) — and whatever runs that loader next decides instead.
  Discarded control flow is logged at the `debug` level, with the thrown value.

An `error()` of 500 or more is a throw like any other, and so is an `Error` of
any kind, whatever `status` it carries, and a thrown `Response`, whose `status`
and `body` are not its own properties. SvelteKit's remote `query` throws such
an `HttpError` on the client whenever the server failed with an `Error`
(during SSR, the query throws the server's own error), so a loader backed by
one fails soft on both. Under SvelteKit 2, a failed validation is an
`error(400)` on the server too, so it rejects the load on both passes.

A value an HTTP client rejects with can have the same shape: `redaxios`, for
one, rejects a 4xx with a plain object carrying the response's `status` and
its `body`. To have such a failure fail soft, a loader built on that client
catches the rejection and throws an `Error` instead.

```javascript
import { error } from '@sveltejs/kit';

export const helpLoader = {
  locale: 'en',
  namespace: 'help',
  routes: [/^\/help\/(?<topic>[\w-]+)$/],
  loader: async ({ locale, params }) => {
    const response = await fetch(`https://api.example.com/i18n/${locale}/help/${params.topic}`);

    // No such topic: SvelteKit renders its error page.
    if (response.status === 404) error(404, 'No such topic');
    // Anything else failed: logged, and the page renders without it.
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    return response.json();
  },
};
```

A loader that redirects must not run on the page it redirects to — give it
`routes` that leave that page out — or SvelteKit follows the redirect until it
gives up. A loader runs only until it has delivered (once per freshness window
and route params), so its throw is no access check: a route guards itself in
its own `load`.

What SvelteKit then does depends on where and when the load runs (checked
against SvelteKit 2.70 and 3.0):

- **In the root layout**, an `error()` renders SvelteKit's static
  `src/error.html`, not your `+error.svelte`, and a client navigation reloads
  the page first. Your own error page needs the loaders that throw `error()`
  triggered from a nested layout or page instead, which then hands their
  namespaces off itself; the [SvelteKit wiring](#sveltekit) and the
  [SSR recipe](#server-side-rendering) below load every loader of the route in
  the root layout.
- **During hydration**, the client runs again whatever the server did not hand
  over — a loader that failed on the server among them. Control flow it throws
  then makes SvelteKit leave the page it rendered: a redirect navigates away
  and leaves the server-rendered URL in the history, where Back redirects
  again, and an `error()` renders the root error page whichever layout threw —
  the static `src/error.html` when the root layout's load throws again — while
  the HTTP status stays what the server sent. Throw control flow only for what
  holds on both passes.
- **A remote function** behaves differently on the client. A `query` (or
  `query.batch`, `prerender`) that calls `redirect()` to a page of the app
  navigates there itself, and the call resolves `undefined`, which would count
  as loaded — so a loader backed by one should throw an `Error` when it gets
  `undefined`, to fail soft and run again. Redirect a remote function only
  within the app: to another origin, SvelteKit 2 rejects the call with an
  `Error` (a `prerender` resolves `undefined` and leaves an unhandled
  rejection), and under SvelteKit 3 the call never settles, so neither does
  the load. Any failed request rejects with an `HttpError` of the response's
  status — a 404 after a deploy, a proxy's 429 — and, under SvelteKit 3, a
  failed validation, a status the server's `handleError` assigns, a refresh
  the server did not handle and a request that never reached it (offline, say)
  whose status the client's `handleError` sets arrive as a 4xx too, while the
  same call during SSR throws a plain `Error`. All of these reject the load like
  `error()`; a loader that wants them to fail soft catches a 4xx and throws an
  `Error` instead.
- **Preloading a link** runs the route's loads ahead of the navigation. When
  a loader throws `error()` there, SvelteKit drops what the preload loaded,
  and the navigation, if it follows, renders the error; under SvelteKit 3 with
  `kit.experimental.forkPreloads`, the preload instead leaves an unhandled
  rejection whose reason is an `App.Error` object. The `app.html` that
  `sv create` scaffolds turns hover preloading on for the whole `<body>`, so to
  keep such a loader from running on hover, give its links, or an element
  around them, `data-sveltekit-preload-data="false"`; `"tap"` still preloads,
  on `mousedown` and `touchstart`.

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
    const response = await fetch(`${API_ORIGIN}/api/translations/${locale}/common`);
    return await response.json();
  },
}
```

A loader runs on the server too, where `fetch` takes only an absolute URL (the
core hands a loader no `fetch` of its own), so `API_ORIGIN` in these examples
stands for an origin such as `https://api.example.com`.

**⚠️ `route` is context, not a cache key.** A loader runs at most once per
locale per freshness window (see [`cache`](#cache)) and per set of
[route params](#route-params) — a later route yielding the same params does not
run it again, unless the loader sets [`cache: false`](#cache-optional). So a loader whose payload varies by `route` itself would serve the
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
    const response = await fetch(`${API_ORIGIN}/api/translations/${locale}/checkout`);
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

Array of route patterns. Loader will only execute if current route matches one of these patterns. The route is matched without [`basePath`](#basepath).

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
    const response = await fetch(`${API_ORIGIN}/api/articles/${params.articleId}/i18n/${locale}`);
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
  params describe the same data and load it once — unless the loader sets
  [`cache: false`](#cache-optional).
- **The current route's params win.** Loads that settle out of order apply only
  the data of the params the current route asks for. The latest data to arrive
  for other params is kept aside, one set per loader, as a router keeps one
  preload: the trigger that asks for those params applies it instead of
  fetching it again. It counts towards its locale's [`cache`](#cache)
  window, and `invalidate()` drops it — even while a trigger is about to apply
  it, which then fetches it again. A loader the current route does not select
  is asked for no params: data a load of another route delivers for it lands
  only while it replaces nothing, and what
  [`loadNamespace()`](#loadnamespacenamespace-locale) fetches for it without
  params lands.

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

##### `cache` (optional)

**Type:** `false`

Set when the loader's source does the caching itself — a SvelteKit remote
`query`, an SWR layer, an HTTP cache. Without it, a loader that answers from its
own cache after [`invalidate()`](#invalidatelocale-namespace) hands back the same
stale table, and the core stamps it fresh anyway.

```javascript
{
  locale: 'en',
  namespace: 'editor',
  cache: false,
  loader: ({ locale }) => messages({ locale, namespace: 'editor' }),
}
```

For such a loader the core keeps no freshness of its own:

- It **runs on every load trigger that selects it**, by locale and route, and
  [`loadNamespace()`](#loadnamespacenamespace-locale) runs it too — off its
  `routes` only until it has delivered, like any loader. Freshness and
  deduplication across triggers are its source's job; concurrent triggers from
  one route still share one load, and a trigger shares a fetch of it for the
  same params and route already in flight.
- A [`preload()`](#preloadlocale-route) runs it as such a trigger, and the call
  handed the preload's token shows that fetch rather than running the loader
  again, so a navigation runs it once. What the preload shared from a fetch
  already in flight is shown, then fetched again behind it, since that fetch
  started before the navigation was requested.
- Its data is applied each time it delivers, like any refetch.
- It starts no [`cache`](#cache) window, and the config's `cache` does not apply
  to it: an expiry neither runs it again nor discards what it is fetching.
- Refreshing the source is the app's business (`query.refresh()`); the next
  trigger picks the new data up.
  [`invalidate()`](#invalidatelocale-namespace) still covers it: the call ends
  the hand-off below, which would hold the loader back until its pass ends, and
  discards a fetch of it still in flight.
- The SSR hand-off still counts: data [`hydrate()`](#hydrateenvelope) applied
  serves the pass it arrived with — until an activating trigger asks for
  another locale or route than the envelope named, or than the first activating
  trigger after it where the envelope named none, or a
  [`preload()`](#preloadlocale-route) runs — so a server-rendered page does not
  refetch right after hydration.

Only `false` is accepted; any other value is reported and ignored.

**Loader descriptors are read once.** `locale`, `namespace`, `loader`, `routes`
and `cache` are captured when the config is applied, so a property implemented as a getter
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
        const res = await fetch(`${API_ORIGIN}/api/translations/en/dynamic`);
        return await res.json();
      },
    },
  ],
};
```

---

### `basePath`

**Type:** `string` (optional)

The path the app is served under — SvelteKit's `paths.base`, spelled as it
appears in `url.pathname`. The URL of every page carries it (`/repo/about` on
GitHub Pages), while loader [`routes`](#routes-optional) name the app's own
paths (`/about`), so without it a route-scoped loader never matches.

Every route handed in — to [`setRoute()`](#setrouteroute-options) and
[`loadTranslations()`](#loadtranslationslocale-route-options) — loses the base
path on the way in, on a segment boundary only: under `/repo`, `/repo/about` is
`/about` and `/repo` is `/`, while `/repository` and a route that does not start
with it pass through unchanged. The stored route, the `route` a loader receives
and the [snapshot](#snapshotoptions)'s route never carry it, and
[`hydrate()`](#hydrateenvelope) takes the snapshot's route as it is. A route
stored before the config that sets `basePath` keeps it, so after a
[`loadConfig()`](#loadconfigconfig) that adds one, hand the route in again.

Set both from one environment variable, defined where the build runs (the
shell or the CI job): the SvelteKit config reads `process.env`, which `.env`
does not reach. That config is the `sveltekit()` options in `vite.config.js` on
SvelteKit 3 and `svelte.config.js` on SvelteKit 2:

```javascript
// vite.config.js (SvelteKit 3)
import { sveltekit } from '@sveltejs/kit/vite';

export default {
  plugins: [sveltekit({ paths: { base: process.env.VITE_BASE_PATH ?? '' } })],
};

// svelte.config.js (SvelteKit 2)
export default {
  kit: { paths: { base: process.env.VITE_BASE_PATH ?? '' } },
};
```

```javascript
// src/lib/i18n.js
export const config = {
  basePath: import.meta.env.VITE_BASE_PATH,
  loaders: [/* ... */],
};
```

`import.meta.env.VITE_*` reads the same on both majors, while SvelteKit 3
exports from `$env/static/public` only what `src/env.ts` declares, and
deprecates it.

The [SvelteKit](#sveltekit) wiring warns once, on the server, when a prefix
it cannot account for stands in front of the route SvelteKit matched, and
names it. The check is a heuristic: it sees no param matchers, so an optional
param in the first segment hides a prefix, and it does not run in an app
without a server.

---

### `translations`

**Type:** `Translations.T` (optional)

Synchronous translations that are available immediately, before any loaders execute.

They **seed** the tables: they record nothing, so a loader of a namespace they
name still runs on its triggers — a route-scoped one once its route is reached —
and its data merges in; a leaf both declare takes the loader's value once it
delivers. They start no [`cache`](#cache) window either. To hand
server-rendered data over, use [`hydrate()`](#hydrateenvelope).

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

Should it throw, what brought the data keeps none of it: neither table
changes, and no loader counts as loaded, so the next trigger runs them.
`addTranslations()` and `hydrate()` throw the error, and a load rejects with it
— unless a loader of the load threw SvelteKit's control flow, which the load
rejects with instead, the error only logged. The calls that share a load
rejecting with it are undone, their route aside ([see `loader`](#loader-required)). A load that fetched part of itself
again after an [invalidation](#invalidatelocale-namespace) keeps the part that
landed first. [`loadConfig()`](#loadconfigconfig) rejects with it too, but keeps
the new config without starting its `initLocale` load.

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

The initial locale: the one an instance starts in when nothing else decides.

**Example:**

```javascript
const config = {
  initLocale: 'en',
  loaders: [/* ... */],
};
```

**With [`defineI18n()`](#sveltekit)** the visitor decides first. `initLocale`
is the locale a visitor gets when neither `preferredLocale` nor what the
visitor's browser asks for names a locale the config serves (see
[Which locale](#which-locale)), and it loads only when that
negotiation picks it: the wiring strips it from the instances it builds, so
nothing preloads it. Without it, or when it matches no locale the config
serves, [`fallbackLocale`](#fallbacklocale) takes that role, and then the first
locale the config serves.

**With `new I18n(config)`** nothing else decides, so the constructor loads it
right away. Leave it out of a config whose instance you
[`hydrate()`](#hydrateenvelope) by hand — its load starts in the constructor,
before the hand-off can be applied (see the
[SSR recipe](#3-build-the-instance-the-app-renders-with)).

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

A request for a locale no loader and no [`translations`](#translations) serve
activates `fallbackLocale` instead: `loadTranslations('de')` on a config serving
only `en` and `cs`, with `fallbackLocale: 'en'`, makes [`locale`](#locale)
`'en'`. Without a `fallbackLocale`, such a request changes nothing once the
instance knows a locale (see [`setLocale()`](#setlocalelocale)).

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
[`invalidate()`](#invalidatelocale-namespace).

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

Spell locales in their canonical form — `he` rather than `iw`, `fil` rather
than `tl`. `Intl` resolves an alias from the engine's own CLDR data, so two
runtimes can resolve it differently: a server on Node and a browser on Safari
would then key one locale two ways, and the [SSR hand-off](#hydrateenvelope)
between them would miss.

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

A map of each translation key to the payload its message expects. It types
[`t()`](#tkey-params) and [`l()`](#llocale-key-params): keys autocomplete, an
unknown key is a type error, and the payload argument is checked against the
key's entry.

**Register it once for the app.** A generated artifact registers the app's
schema in the global `SvelteKitI18n.Register` interface, and every instance
whose config states no `schema` is typed by it — `new I18n(config)` and the
[`/kit`](#sveltekit) wiring alike, with nothing to wire:

```typescript
// src/i18n-schema.d.ts — a global script: no top-level import or export
interface TranslationSchema {
  'common.greeting': { name: string };  // payload required
  'common.about': never;                // message takes no parameters
  'home.title': { title?: string };     // nothing required — payload optional
}

declare namespace SvelteKitI18n {
  interface Register {
    schema: TranslationSchema;
  }
}
```

```typescript
const i18n = new I18n(config); // typed by TranslationSchema
```

The core reads `schema` alone. Another member of `Register` is another
package's: [@sveltekit-i18n/typegen](https://github.com/sveltekit-i18n/typegen)
also registers `tree`, the same keys nested by segment, which
[`extension-typed-access`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-typed-access)
reads (see [TypeScript](#typescript)).

**Or state it per instance.** Only the type of the slot is read — nothing
reads the value at runtime — so a config may carry an empty value, as long as
it is typed. A schema stated this way is an explicit choice for that instance,
and it wins over the registry:

```typescript
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

**Precedence.** The slot the config states decides; only an absent one reads
the registry:

| The config's `schema` | Keys and payloads are typed by |
|---|---|
| absent, or typed `any` (a `Config.T` annotation that names no schema) | the registry — plain strings when nothing is registered |
| a closed schema (`{} as X`, `Config.T<Params, Output, X>`, `X \| undefined`) | `X`: a stated schema always wins |
| a schema whose keys are not a closed set (`{}`, `Record<string, …>`) | nothing — keys are plain strings |

**`schema: {}` opts out.** An open index signature (`Record<string, …>`), or a
schema with no keys at all, would reject every key or demand a payload for keys
it knows nothing about — so it types nothing: keys stay plain strings, as if no
schema were supplied, and since the slot is stated, the registry stays out too.
An instance with a catalogue of its own — a second instance in the app, a test,
a Storybook story — states its closed schema, or opts out:

```typescript
new I18n({ ...config, schema: {} });
new I18n({ ...config, schema: {} as Record<string, { value: string }> });
```

A registration with no keys — what a generator writes before its first run —
types nothing either.

**⚠️ The registry covers the whole program, so a library never registers.**
Only the app's generated artifact fills `SvelteKitI18n.Register`. A library's
own instances state their schema, or `schema: {}`, which also keeps an app's
registry away from a workspace library compiled inside the app's program. A
library's declarations are built without a registration and carry no schema,
so an app's registry does not reach them. Two registrations whose `schema`
differs are a type error (TS2717) with `skipLibCheck: false`, and silent with
SvelteKit's default `skipLibCheck: true`, where the first one wins.

**⚠️ The registry needs base 3.1** (`sveltekit-i18n` 3.1) or newer. An older
core ignores the registration without a diagnostic; there, state the schema per
instance.

**⚠️ Construction time only.** The type is read off the config the constructor
receives, and the registry with it: a later
[`loadConfig()`](#loadconfigconfig) cannot retype an existing instance, and an
[`extension`](#extensions) typed by a fixed return type erases the instance's
type parameters altogether — that surface is typed by the extension, not by the
schema. An extension typed by an `Extension.Operator`
keeps them (see [Extensions and the constructor's type](#extensions-and-the-constructors-type)).

No generator ships in this package — the slot and the registry do. The schema
is a type you hand-write for a small project, or a generated artifact for a
large one —
[@sveltekit-i18n/typegen](https://github.com/sveltekit-i18n/typegen), a separate
package, generates one (see
[Message parameter extraction](#message-parameter-extraction) for the
build-time contract a generator reads messages through). The types the slot is
resolved through are exported from the package root as the `Schema` namespace —
`Schema.Registered`, `Schema.FromConfig`, `Schema.FromInstance`, `Schema.Key`,
`Schema.Params` and `Schema.Payload` — for generators and wrapper packages;
application code only registers or supplies a schema. `Registered` reads the
registry, `FromConfig` the schema a config types its instance with (the
precedence above), and `FromInstance` the one a constructed instance carries —
what an extension has in hand when it types its own output.

---

### `cache`

**Type:** `number` (milliseconds)  
**Default:** `Number.POSITIVE_INFINITY` (never expires)

How long loaded translations stay fresh. Once a locale's translations are
older than this window, the **next activating load trigger**
(`loadTranslations`, `setLocale`, `setRoute`) or
[`preload()`](#preloadlocale-route) runs its loaders again; nothing
refetches on its own in the background. A warm load — a `loadTranslations()`
call with [`{ activate: false }`](#loadtranslationslocale-route-options) or
[`loadNamespace()`](#loadnamespacenamespace-locale) — fills the tables without
evaluating the window, and a call handed a preload's token leaves it to that
preload, which judged freshness when the navigation was requested.

**Default (never expires):**

```javascript
const config = {
  // cache: Number.POSITIVE_INFINITY — each loader (but one with `cache: false`) runs once per locale and route params
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
  cache: 0,  // Refetch on every activating load trigger
};
```

**How it works:**

```
Activating load trigger (loadTranslations / setLocale / setRoute) or preload()
   ↓
Locale's translations older than `cache`? → drop its loaded state
   ↓
Loaders not marked as loaded run again
   ↓
Each loader's fresh data replaces what it delivered before; freshness is stamped per locale
```

**Expiry refreshes, it never removes by itself.** What is displayed stays until
the refetch lands. Then each loader's fresh data replaces what that loader
delivered before, so a message its source dropped goes too, while seeded data
and the part of a loader that did not run again stay. The same holds for
[`invalidate()`](#invalidatelocale-namespace) — both drop the bookkeeping that would
prevent a refetch, neither clears the tables.

**💡 Tip:** For event-driven refreshes (a CMS webhook, a manual "reload
translations" action), keep the infinite default and call
[`invalidate()`](#invalidatelocale-namespace) instead — expiry and manual invalidation
compose.

A loader with [`cache: false`](#cache-optional) starts no window and is not
covered by one: its source does the caching.

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

**Official extensions** live in the
[extensions](https://github.com/sveltekit-i18n/extensions) repository:

- [`@sveltekit-i18n/extension-stores`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-stores)
  — replaces the instance with the Svelte-store surface of v2 (`$t`,
  `$locale`, `$loading`, …), the instance it received at `instance`.
- [`@sveltekit-i18n/extension-html`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-html)
  — adds a `T` component that renders the markup a message carries as
  elements and Svelte components, from an allowlist, with no `{@html}`.
- [`@sveltekit-i18n/extension-typed-access`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-typed-access)
  — keys as members of `t`: `i18n.t.home.title()` beside
  `i18n.t('home.title')`, typed from the [`schema`](#schema).

Their order matters. `stores` returns no instance, so it goes after the other
two: `[typedAccess, stores]` hands out the tree as `$t.home.title()`, and with
`[html({ onReport: null }), stores]` the component is at `instance.T`. `html`
after `typedAccess` adds `T` beside the tree, while before it `T` is typed at
`instance.T` only. Each package's README has the details, and
[lib's examples](https://github.com/sveltekit-i18n/lib/tree/master/examples#extensions)
run each one.

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

- `'error'`: Critical failures (loader errors, parser errors), and a
  `redirect()` or an `error()` below 500 that
  [rejects a load](#loader-required); control flow that is discarded is logged
  at `'debug'`
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
methods never print a trailing `undefined`. SvelteKit's `redirect()` and an
`error()` below 500 that reject a load arrive at the `error` level as they
were thrown — a `Redirect` or an `HttpError`, not an `Error`, with no stack —
under a message that contains `Rejecting the load`; control flow that is
[discarded](#loader-required) arrives at the `debug` level.

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
import { isRedirect } from '@sveltejs/kit';

const config = {
  log: {
    logger: {
      error: (message, error) => {
        console.error(message, error);
        // A loader's `redirect()` is navigation, not a fault. An `HttpError` is
        // kept: a remote function's 404 or 429 rejects a load as one too.
        if (isRedirect(error)) return;
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
concurrent duplicate triggers that select the same loaders for the same locale
and route join the load already in flight (and receive its promise) instead of
fetching twice. Triggers from the same route whose selections merely overlap —
a route load and a [`loadNamespace()`](#loadnamespacenamespace-locale) of one
of its namespaces, say — still share each loader they both run for the same
params, and each settles once everything it waits on has. A trigger from
another route loads for its own: a loader
receives the route, so what it delivers, or throws, for one need not fit
another. Those methods, [`preload()`](#preloadlocale-route),
[`loadConfig()`](#loadconfigconfig),
[`addTranslations()`](#addtranslationstranslations),
[`hydrate()`](#hydrateenvelope) and assigning [`locale`](#locale) track none
of the state they read, so an `$effect` that calls one runs again only for what
the effect itself reads.

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
  import { i18n } from '#lib/translations/index.js';

  const { loading, locale } = $derived(i18n);
</script>

{#if loading}Loading…{:else}{locale}{/if}
```

---

### `t(key, ...params)`

**Type:** `(key: string, ...params: ParserParams) => ParserOutput | string`

`ParserOutput` is inferred from the configured parser's `parse` return type and
defaults to `string` (see [TypeScript](#typescript)). The `| string` is the
miss: an empty key or no active locale returns `''`, and a missing translation
the key itself, without the parser ever being called, so a parser declaring a
rich output is handed both. Two paths hand back data unchecked: a configured
[`fallbackValue`](#fallbackvalue), and the stored value while the config
carries no parser yet. For a parser returning a string — every parser this
project ships — the union collapses and the type is `string`.

That is the un-narrowed signature: a [`schema`](#schema) narrows `key` to its
keys and `params` to the payload that key declares.

Translates `key` for the active locale.

```svelte
<script>
  import { i18n } from '#lib/translations/index.js';
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
new locale's translations resolved, not synchronously on assignment. It does
not advance when a loader throws SvelteKit's `redirect()` or an `error()` below
500, which an assignment only logs ([see `loader`](#loader-required)).

```svelte
<script>
  import { i18n } from '#lib/translations/index.js';
</script>

<p>Current language: {i18n.locale}</p>
<button onclick={() => { i18n.locale = 'en'; }}>English</button>
```

Await the change explicitly when you need to know it finished — or that it was
rejected:

```javascript
await i18n.setLocale('cs');
```

---

### `locales`

**Type:** `string[]` (reactive)

All known locales (from loaders and added translations). The
[SvelteKit](#sveltekit) wiring negotiates against the locales the config
serves — its loaders and `translations` — not against this list.

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
<script>
  let { children } = $props();
</script>

{#if i18n.initialized}
  {@render children()}
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

**Type:** `(locale: string, route?: string, options?: { activate?: boolean; preloaded?: Loader.Preloaded | undefined }) => Promise<void>`

Loads translations for a locale and route (without [`basePath`](#basepath)),
and activates the locale once they resolved. A locale nothing serves resolves without changing anything, the
route included, as it does for [`setLocale()`](#setlocalelocale).

```javascript
// +layout.js
import { i18n } from '#lib/translations/index.js';

export const load = async ({ url }) => {
  await i18n.loadTranslations('en', url.pathname);
  return {};
};
```

The instance above is a module-level singleton, which on the server is shared
by every request in the process, and this `load` activates it for a preload
too — a page a hovered link leads to. See [SvelteKit](#sveltekit) for the
wiring that does neither, or [Server-Side Rendering](#server-side-rendering)
to wire it by hand.

**`{ activate: false }`** only fills the tables. The requested locale, the
current route and [`locale`](#locale) stay as they were, and the load does not
count towards [`loading`](#loading), so nothing on screen changes. It uses the
same loader selection, bookkeeping and in-flight deduplication as an activating
call, and `invalidate()` severs it the same way — but it does not fetch the
severed part again, as an activating trigger does; the next trigger will. A loader whose
[route params](#route-params) differ from the ones the current route asks for
still runs, and its data is kept aside rather than replacing what is displayed
— so is data for other params than a loader no route asks for delivered last,
unless [`loadNamespace()`](#loadnamespacenamespace-locale) asks for none.
Only the latest is kept per loader. The activating trigger that asks for those
params applies it with its load, and at once when nothing else is left to
fetch, so a preloaded page shows its own data as it commits; a later preload
cannot replace it meanwhile, and should the call fail, it stays aside. A loader with [`cache: false`](#cache-optional)
runs again instead.
It does not evaluate the [`cache`](#cache) window; the next activating trigger
does. An activating trigger selecting the same loaders for the same locale
and route joins it: `loading` turns `true`, the locale activates when the shared load
settles, and both calls share its outcome — when a loader throws SvelteKit's
control flow, both reject with it. Once it has settled, the activating call
fetches nothing (a [`cache: false`](#cache-optional) loader aside) and
activates at once, unless the locale's `cache` window has elapsed in the
meantime.

```javascript
// Fetch what a link needs without switching to it.
await i18n.loadTranslations('de', '/about', { activate: false });
```

The option exists only here. On `setLocale()` and `setRoute()` activation is the
whole point of the call.

**`{ preloaded }`** hands an activating call the token of a
[`preload()`](#preloadlocale-route) of the same locale and route. The call
shows what that preload fetched instead of fetching it again — a loader with
[`cache: false`](#cache-optional) included — at once when nothing else is left
to fetch, and otherwise together with the rest, in one go. It evaluates no
[`cache`](#cache) window, since the preload did. It still fetches what the
preload did not deliver, and what it delivered to a loader that shows something
else since — a seed or another delivery replaced what it showed — wherever the
call has that loader to load anyway, such as one with `cache: false` or one
whose record an expiry dropped meanwhile. A token serves one call: the first
activating call that reads it spends it, whether or not it serves that call,
even with nothing left to fetch; a call left without a locale to show — handed
an empty one or one nothing serves, say — reads none. It is ignored — the call
loads as it would without one — when it comes from another instance, names
another locale or route, was spent already, predates a
[`loadConfig()`](#loadconfigconfig) or an
[`invalidate()`](#invalidatelocale-namespace), or is passed with
`{ activate: false }`, which leaves it unspent. A window a later request found
elapsed does not void it: the preload judged the window at its own request.

**Errors:** a loader that throws is caught and logged individually, so one
broken loader does not fail the batch; only SvelteKit's `redirect()` and an
`error()` below 500 reject the load ([see `loader`](#loader-required)).
Anything that throws afterwards — a custom `preprocess`, a malformed payload —
**rejects the returned promise**, even when the call had nothing to fetch, and
keeps none of what the load delivered, so the next trigger fetches it again — a
load that fetched part of itself again after an
[invalidation](#invalidatelocale-namespace) keeps the part that landed first.
The call is undone as control flow undoes it, except that its route stands
([see `loader`](#loader-required)), and `await` surfaces the error (in SvelteKit, to the
error page — the static `src/error.html` when it happens in the root layout);
when a loader's control flow rejects the load too, that failure is only logged
and the promise rejects with the control flow, whose undo takes the route back
too. A result you discard is safe:
the failure is logged through the configured logger and never becomes an
unhandled rejection — but it is then only visible in the log.

---

### `preload(locale, route?)`

**Type:** `(locale: string, route?: string) => Promise<Loader.Preloaded | undefined>`

The request of a navigation that may never commit — what a router's `load`
runs ahead of it, a hover's included. `route` (without
[`basePath`](#basepath)) defaults to the current route.

Like an activating call, it is a request: it evaluates the [`cache`](#cache)
window, ends the pass a [hand-off](#hydrateenvelope) serves, and runs a loader
with [`cache: false`](#cache-optional) — unless a fetch of that loader for the
same params and route is already in flight, which it shares. Like
[`{ activate: false }`](#loadtranslationslocale-route-options), it shows
nothing: it writes neither the requested locale nor the route, does not count
towards [`loading`](#loading), and lands what it fetched as a warm load does,
data for other [route params](#route-params) kept aside.

It resolves to a token, a frozen empty object, for the next activating call of
that locale and route, which takes it as
[`{ preloaded }`](#loadtranslationslocale-route-options) — on
`loadTranslations()` or [`setRoute()`](#setrouteroute-options) — and shows what the
preload fetched instead of fetching it again. What it shared from a
`cache: false` fetch already in flight predates the request, so that call
shows it, then fetches the loader again behind it while it still shows and
the route still wants it, which the call does not wait for.
It resolves to `undefined` when the instance was destroyed or nothing serves
the locale.

A loader's `redirect()` or `error()` below 500 rejects it, as it would the
navigation — unless it shares its load with an activating call, whose outcome
it then gets, as a [warm load](#loadtranslationslocale-route-options) does; a
result nobody awaits never becomes an unhandled rejection.

```javascript
// As the navigation is requested — a hover, say:
const preloaded = await i18n.preload('de', '/about');

// As it commits:
await i18n.loadTranslations('de', '/about', { preloaded });
```

[`/kit`](#sveltekit) does this for every navigation after the first.

---

### `loadNamespace(namespace, locale?)`

**Type:** `(namespace: string, locale?: string) => Promise<void>`

Loads one namespace on demand — for what an interaction needs rather than a
route: a modal, a rarely opened panel, an editor. `locale` defaults to the
active [`locale`](#locale); without one the call does nothing. Like the other
loading calls, it [tracks none of the state it reads](#instance-properties-and-methods),
so an `$effect` that should load the namespace again after a locale switch
passes the locale itself:
`$effect(() => { i18n.loadNamespace('panel', i18n.locale); })`.

```javascript
import { goto } from '$app/navigation';
import { isHttpError, isRedirect } from '@sveltejs/kit';

async function openEditor() {
  try {
    await i18n.loadNamespace('editor');
  } catch (thrown) {
    // In an event handler, nothing follows a loader's `redirect()` but this code.
    if (isRedirect(thrown)) {
      // `goto()` only reaches a page of this app, so anything else loads in full.
      const to = new URL(thrown.location, location.href);

      return to.origin === location.origin ? goto(to).catch(() => location.assign(to)) : location.assign(to);
    }
    // An `error()`, or a remote function's 4xx: logged already, and the editor
    // opens without these keys.
    if (!isHttpError(thrown)) throw thrown;
  }

  editorOpen = true;
}
```

- It selects the loaders of that namespace **whatever their `routes` say** —
  bypassing route matching is the point — for the locale and the
  [`fallbackLocale`](#fallbacklocale). A loader whose routes capture [route
  params](#route-params) receives the params of the current route when its
  routes match it. Off its routes it has none to ask for, so whatever it
  delivered last serves, and only a loader that has not delivered yet is
  called — with none.
- It honours the load records like every other trigger: calling it on every
  interaction fetches once (a [`cache: false`](#cache-optional) loader runs
  each time on its routes), and concurrent calls from one route share one
  fetch — with a route load that runs the same loader too. A call from
  another route fetches for its own, since a loader receives the route.
- What it loads **stays loaded across routes**, so a namespace can be present
  outside every route its loader declares, and it reaches
  [`snapshot()`](#snapshotoptions).
- It is warm, like `loadTranslations(…, { activate: false })`: the locale does
  not change, [`loading`](#loading) stays `false` — track the returned promise
  for a spinner of the component's own — and the [`cache`](#cache) window is
  evaluated by the next activating trigger, after which the next call refetches.
- [`invalidate()`](#invalidatelocale-namespace) severs it like any other
  load, and a loader that throws is logged and records nothing, so the next
  call retries; SvelteKit's control flow rejects the call
  ([see `loader`](#loader-required)).

---

### `setLocale(locale)`

**Type:** `(locale?: string) => Promise<void>`

Requests a locale. If a route is already set the load starts immediately;
otherwise it fires when the route arrives. A locale nothing serves (no loader,
no translations, no `fallbackLocale` match) resolves without changing anything;
until the instance knows a locale — before a config is loaded — every request
is kept, for the config to serve. A loader's `redirect()` or `error()` below
500 rejects the call and undoes it: the requested locale, the route and the
route params go back to what it replaced, unless a later call that has not
failed came in the meantime ([see `loader`](#loader-required)).

---

### `setRoute(route, options?)`

**Type:** `(route: string, options?: { preloaded?: Loader.Preloaded | undefined }) => Promise<void>`

Updates the current route, without [`basePath`](#basepath), and loads
route-scoped translations for the requested locale, if one is known. A loader's `redirect()` or `error()` below
500 rejects the call and undoes it, as it does
[`setLocale()`](#setlocalelocale)'s. `{ preloaded }` takes the token of a
[`preload()`](#preloadlocale-route) of the requested locale and this route, as
[`loadTranslations()`](#loadtranslationslocale-route-options) does.

---

### `loadConfig(config)`

**Type:** `(config: Config.T) => Promise<void>`

(Re)configures the instance — same as passing the config to the constructor.
With an [`initLocale`](#initlocale), the returned promise is that locale's
load, and it settles as the load does: an `initLocale` nothing serves resolves
without changing anything, and a load a later call or a reconfiguration
replaced resolves without activating. Safe to call fire-and-forget: a failure
is reported through the logger and the returned promise is marked handled,
while an awaiting caller still receives the rejection.

---

### `addTranslations(translations)`

**Type:** `(translations: Record<string, any>) => void`

Seeds translations synchronously (static tables known ahead of time), like
[`translations`](#translations). Payload is preprocessed per
`config.preprocess` and merged into the tables, and it records nothing: every
loader of a namespace it names still runs and merges into it, and a loader
that delivers again replaces only its own part. It
starts no [`cache`](#cache) window. Locale keys are normalized
([`sanitizeLocales`](#sanitizelocales)) before they are merged. To hand a
server's state over, use [`hydrate()`](#hydrateenvelope).

Merging goes branch by branch, so a payload for a namespace that already holds
data adds to it instead of replacing it; a leaf declared twice takes the
incoming value, and keeps it over what a loader delivered before: a sibling
loader delivering again leaves it in place, and only that loader's next
delivery replaces it. That holds across spellings where dot notation merges
them (every `preprocess` but `'none'` and a function): a seeded `'lang.en'`
stays over a delivered `{ lang: { en } }`, and the delivered leaf it shadows
goes from `rawTranslations` too. A seed nested as the loader nests it that
changes a key's shape (a string where a loader delivered a branch or a list,
or the reverse) replaces the delivered value whole, as it does in
`rawTranslations`; one spelled with dots takes out only the keys it names.

```javascript
i18n.addTranslations({
  en: { 'lang.en': 'English', 'lang.cs': 'Czech' },
  cs: { 'lang.en': 'Anglicky', 'lang.cs': 'Česky' },
});
```

---

### `snapshot(options?)`

**Type:**

```typescript
(options?: { records?: false }) => Record<string, any>
(options: { records: true }) => Snapshot.Envelope
(options?: { records?: boolean }) => Record<string, any> | Snapshot.Envelope
```

Serializes what the instance currently holds for the **active locale** and the
**`fallbackLocale`**, whichever routes loaded it — the server half of the
[SSR hand-off](#server-side-rendering). Two forms:

- **`snapshot({ records: true })`** returns an envelope for
  [`hydrate()`](#hydrateenvelope): the data, the loaders that delivered it, the
  active locale and the route. This is the form to hand to a client.
- **`snapshot()`** returns the data alone, shaped like
  [`translations`](#translations), for a plain hand-off:
  `hydrate({ translations })` keeps every loader without route params of every
  namespace it names from running, and holds a
  [`cache: false`](#cache-optional) one back for the pass it arrived with.
  Passed to [`addTranslations()`](#addtranslationstranslations) or assigned to
  `config.translations`, it only seeds, and every loader runs again.

```javascript
// +layout.server.js — one instance per request
import { I18n } from '@sveltekit-i18n/base';
import { config } from '#lib/translations/index.js';

export const load = async ({ url, locals }) => {
  const i18n = new I18n(config);

  await i18n.loadTranslations(locals.locale, url.pathname);

  return { i18n: i18n.snapshot({ records: true }) };
};
```

The envelope is plain data — strings, arrays and plain objects — so SvelteKit
serializes it like any other load data. Its locales are held sanitized and are
not sanitized again, and its `locale` and `route` are applied as they are, so
take it from the server: the whole envelope from `snapshot({ records: true })`,
or for a plain hand-off the data of `snapshot()` with the server's
[`locale`](#locale). `Snapshot.Envelope` is its type.

What the payload leaves out:

- **Other locales** — only the active locale and the fallback are serialized.
- **A namespace fed by several loaders when one of them can capture [route
  params](#route-params).** The client could not tell which part of the
  namespace each loader delivered, so the next params could not replace theirs.
  The client loads the namespace itself. The same goes for a namespace whose
  one loader can capture params but holds no record — after an
  [`invalidate()`](#invalidatelocale-namespace), say.
- **A loader that cannot be named off-process** — two loaders the config spells
  the same, or whose only difference is a `RouteMatcher` — stays out of the
  records. Its data is handed over, and the client runs the loader again.
- **A literal `__proto__` key**, at any depth — SvelteKit serializes load data
  with `devalue`, which refuses an object carrying one, so keeping it would fail
  the render. The key is dropped with a warning; the rest of its namespace is
  kept, and the loaders of that namespace stay out of the records, so the
  client loads it whole. A namespace whose loader can capture params is left
  out, since data no record names could not be replaced by the next params,
  and without records, so is a namespace a loader serves, for the same reason. A locale named `__proto__` is left out altogether.

Without records, plain data cannot say which loader delivered what, so
`snapshot()` also leaves out:

- **every** namespace fed by several loaders — the namespace record a plain
  `hydrate()` would leave on the client would keep a loader whose part is
  missing from running;
- every namespace of a loader whose `routes` can capture params, which a plain
  hand-off keeps as data no loader delivered, so new params could not replace
  it;
- every namespace none of whose loaders delivered on this instance and no
  hand-off named — one they never matched, whose loader threw, or that was
  invalidated since. Its seeded data would keep the client's loaders from ever
  running. Seeded data of such a namespace travels in the records form only.

The client loads those itself.

The data is **pre-preprocess** — the [`rawTranslations`](#translations--rawtranslations)
shape — so the receiving instance applies its own `config.preprocess`.
Freshness is not transferred either: the [`cache`](#cache) window of a hydrated
locale starts when the client receives the data, not when the server loaded it.
Data no caching loader feeds — seeded data, a namespace only
[`cache: false`](#cache-optional) loaders feed — starts none.

---

### `hydrate(envelope?)`

**Type:** `(envelope?: Snapshot.Envelope) => void`

Restores the state [`snapshot({ records: true })`](#snapshotoptions) captured
on another instance — the client half of the [SSR
hand-off](#server-side-rendering):

- the **data** is displayed at once;
- a loader named by the **records** does not run again for the same [route
  params](#route-params), while its siblings on other routes still run when
  their route matches; its next fetch — for new params, after
  [`invalidate()`](#invalidatelocale-namespace) or expiry — replaces its data
  as it would after a load.
  One with [`cache: false`](#cache-optional) is held back only for the pass the
  envelope arrived with;
- what the server seeded — with
  [`addTranslations()`](#addtranslationstranslations), say — into the
  namespace of a recorded loader, or of one whose routes capture params,
  travels apart as `seeds`: it is displayed even where the payload leaves the
  namespace out, and it outlives the data the loader's next fetch replaces.
  Like any seed, it lies under what a loader delivers into that namespace on
  the client;
- data no record names is displayed, but keeps no loader from running — a
  loader the records do not cover loads again rather than going missing;
- the **active locale** and the **route** are restored, so the instance is
  [`initialized`](#initialized) and `t()` renders the server's locale before any
  load has run.

```javascript
// Once, right after the instance is built
i18n.hydrate(data.i18n);
```

In a SvelteKit `load` that runs on every navigation, build the instance and
hydrate it once per tab — the
[SSR recipe](#3-build-the-instance-the-app-renders-with) shows the pattern.

The envelope is **applied on top of** the config: a config that carries its own
`translations` keeps them.

`hydrate(undefined)` does nothing, so a `load` whose server half sent nothing
can call it unconditionally. An envelope without `records` is a plain
hand-off, the one channel that marks a namespace loaded without naming a
loader: every namespace its data names — by the first segment of each key, so
a dotted `'extra.a'` names `extra` — keeps its loaders without route params
from running until [`invalidate()`](#invalidatelocale-namespace) or
[`cache`](#cache) expiry covers it, and a [`cache: false`](#cache-optional)
loader of such a namespace is held back for the pass it arrived with. Data
passed to [`addTranslations()`](#addtranslationstranslations) or
`config.translations` only seeds, and keeps no loader from running.
A record naming no loader of the client's config — one whose `routes` the two
sides spell differently, say — is dropped, and its loader runs again.

Call it before any load starts. With [`initLocale`](#initlocale) set, the
constructor starts one before `hydrate()` can be called, so the loaders run
regardless; `hydrate()` warns when that happens. The hand-off stands: a call
in flight when it came puts nothing back should a loader's control flow
[fail it](#loader-required).

---

### `invalidate(locale?, namespace?)`

**Type:** `(locale?: string, namespace?: string) => void`

Marks loaded translations stale — for one locale, or for all of them when
called without a locale, and for one namespace, or for all of them when called
without one. The call itself starts **no** load and the currently displayed
translations stay in place; loaders run again on the next load trigger and
each loader's fresh data replaces what it delivered before, so a key its source
has dropped goes once the refetch lands (see [`cache`](#cache)).

```javascript
// A CMS webhook / admin action told us the English content changed:
i18n.invalidate('en');

// Only the editor catalogue changed — the rest of English stays loaded:
i18n.invalidate('en', 'editor');

// The editor catalogue changed in every language:
i18n.invalidate(undefined, 'editor');

// Nothing happens yet — the next navigation (or explicit load) refetches:
await i18n.loadTranslations('en', location.pathname);
```

A loader already in flight for what was invalidated is severed: its load still
settles, but what that loader returns or throws is discarded — it predates the
invalidation — and the next load trigger starts a fresh fetch instead of
joining it. The rest of the load lands. An activating trigger still in flight
(`setLocale`, `setRoute`, `loadTranslations`) then fetches the severed part
again and only activates once it arrives, so awaiting it still means its locale
is loaded, with data from after the invalidation. That refetch settles the
trigger like any load: control flow it throws
[rejects the trigger](#loader-required), while the part that already landed
stays. The trigger refetches once: should the refetch be severed too — a loader
that invalidates what it loads each time it runs, say — it resolves without
activating, while a trigger that joined the refetch gets one refetch of its
own. It leaves the severed part to the next trigger, too, when another
loader of its load threw SvelteKit's control flow that still counts (the
trigger then rejects with it), or when the config was replaced. When a later
call asked for another locale or route meanwhile, the trigger waits for the
calls since its own: it resolves without activating should their request
stand — the later call loads what it asked for — and fetches its part again
should their control flow put its request back. When the later call wants
other [route params](#route-params) of a loader the trigger's load ran or
took from a preload — or none of one its route gave params to, because the
later route does not select it — the trigger resolves without activating at
once: should an undo put its request back, the undo loads it.
`invalidate()` itself still
starts nothing: only a trigger that was already running finishes its job.

A loader with [`cache: false`](#cache-optional) is covered too: the call ends
the hand-off that holds it back after [`hydrate()`](#hydrateenvelope), and a
fetch of it in flight is severed like any other.

A [`preload()`](#preloadlocale-route) token issued before the call no longer
serves: the call it is handed to loads as it would without one.

A namespace invalidation leaves the locale's [`cache`](#cache) window where it
was: the refetched namespace expires together with the rest of the locale, so
no table outlives the window.

Works independently of `config.cache`: with the default infinite cache it is
the way to pick up runtime content changes; with a finite cache it forces a
refresh before the window elapses.

---

### `destroy()`

**Type:** `() => void`

Detaches the instance from its loading lifecycle. Loads still in flight
settle, and whatever their loaders return or throw is discarded;
[`loading`](#loading) drops to `false`, and every further load or mutation call
(`loadTranslations`, `preload`, `loadNamespace`, `setLocale`, `setRoute`,
`loadConfig`, `addTranslations`, `hydrate`, `invalidate`) is ignored with a
warning.

Reads keep working — `t`, `l`, `locale`, `translations` and `snapshot()` still
return the instance's last state, so a component that is still tearing down
renders instead of breaking.

Call it when a per-request or per-component instance goes out of scope:

```svelte
<script>
  import { I18n } from '@sveltekit-i18n/base';
  import { config } from '#lib/translations/index.js';

  const i18n = new I18n(config);

  $effect(() => () => i18n.destroy());
</script>
```

A module-level singleton lives as long as the app and needs no call. The method
is idempotent — calling it twice is a no-op.

---

## SvelteKit

`@sveltekit-i18n/base/kit` wires an app to its config in four exports: the
server builds an instance per request, hands it to the browser, and the browser
keeps one instance per tab, following every navigation. What the server
loaded is not fetched again in the browser, and no visitor sees another
visitor's locale.

### Setup

```javascript
// src/lib/i18n.js
import { defineI18n } from '@sveltekit-i18n/base/kit';
import parser from '@sveltekit-i18n/parser-curly';

export const config = {
  parser: parser({ onReport: null }),
  loaders: [/* ... */],
};

export const { handle, load, use, get } = defineI18n(config, {
  preferredLocale: (event) => event.cookies?.get('lang'),
});
```

```javascript
// src/hooks.server.js
export { handle } from '#lib/i18n.js';
```

```javascript
// src/routes/+layout.server.js and src/routes/+layout.js — the same line in both
export { load } from '#lib/i18n.js';
```

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { use } from '#lib/i18n.js';

  let { data, children } = $props();

  use(() => data);
</script>

{@render children()}
```

```svelte
<!-- any component -->
<script>
  import { get } from '#lib/i18n.js';

  const i18n = get();
</script>

<p>{i18n.t('common.greeting')}</p>
```

```html
<!-- src/app.html -->
<html lang="%lang%" dir="%dir%">
```

- **`handle`** replaces `%lang%` with the negotiated locale, or with an empty
  string when the config serves no locale, and `%dir%` with its
  [direction](#textdirectionlocale), `ltr` without a locale – every one
  of them in the `<html>` start tag, and nowhere else: the rest of the page
  carries the app's content, `<svelte:head>` included, where a placeholder
  ships as it is written. Without the hook, both ship literally. Anything
  else the locale belongs in, an `og:locale` meta for one, goes in
  `<svelte:head>` from `i18n.locale`.
- **`load`** is one function for both layout files: it tells the server's
  event from the universal one. The server branch negotiates, loads the locale
  for the route into a fresh instance and returns its
  [snapshot](#snapshotoptions); on a client navigation, it returns only the
  negotiated locale and the route. On a page render, the universal branch
  takes over the instance the server branch loaded in the same request, so
  nothing is hydrated twice; in the browser, or when a loader has
  `cache: false`, it builds the instance and [hydrates](#hydrateenvelope) the
  snapshot. Without a snapshot (no server `load`, `ssr = false`) it loads the
  negotiated locale itself; when that load ran a
  [`cache: false`](#cache-optional) loader, the first commit takes it as its
  own, so that loader runs once, while the instance is not `loading`,
  nothing landed in it since (a load, `addTranslations()`, `hydrate()`),
  nothing invalidated what the page loads, and its
  [snapshot](#snapshotoptions) records every loader the page selects — a
  loader that failed soft, one without an `id`, one whose namespace holds a
  literal `__proto__` key and one whose namespace the snapshot leaves out each
  make the commit load again. On each later client navigation, it
  [preloads](#preloadlocale-route) the target locale for the route, so `use()`
  shows at commit what that request fetched. Either way it returns the instance as `data.i18n`, next to the
  other fields of the server's data. With
  [`extensions`](#extensions), `data.i18n` is what they make of the instance,
  while the wiring keeps driving the instance itself.
- **`use(() => data)`** belongs in the root layout's script, called once with a
  getter of `data`. It provides the instance to every component below, switches
  and follows the route as each navigation commits, keeps
  `document.documentElement.lang` and `dir` in sync, and returns the instance (what the
  extensions make of it, with extensions). Without the data of `load`, it
  throws.
- **`get()`** returns the instance `use()` provided, in any component below the
  root layout; anywhere else, it throws.

A re-export (`export { load } from '#lib/i18n.js'`) makes SvelteKit's static
analysis of page options give up on that file and, in the root layout, on every
route below it. Nothing changes at runtime; the build loses what it derives
from `ssr`/`csr` set to `false` on a page — a page with `ssr = false` still has
its server code bundled, and an app whose every page sets `csr = false` still
gets a client build. An app that relies on either keeps the analysis with
`import { load as i18nLoad } from '#lib/i18n.js'; export const load = i18nLoad;`.

### Which locale

Each pass negotiates against the locales the config serves — the loaders'
locales and the keys of [`translations`](#translations) — and takes the first
candidate that matches, [`en-GB` falling back to `en`](#matchlocalerequested-available):

1. `preferredLocale(event)`, the visitor's choice: a cookie, a route param, a
   profile in `locals`;
2. the `Accept-Language` header; in an app without a server `load`, the
   browser's `navigator.languages`;
3. [`initLocale`](#initlocale);
4. [`fallbackLocale`](#fallbacklocale);
5. the first locale the config serves: the loaders' locales in the order the
   config lists them, then the keys of `translations`.

`initLocale` and `fallbackLocale` are [sanitized](#sanitizelocales) as the
config's locales are, and so is what `preferredLocale` returns when
`sanitizeLocales` is a function; header ranges are matched as sent, apart from
case. The defaults (3–5) do not read the header, so a range the visitor
refused (`q=0`) does not keep one of them out. A config that serves at least
one locale therefore always settles on one; only a config that serves none
renders the page with no active locale. Set `initLocale` to choose the locale
a visitor gets when nothing they prefer is served, rather than leaving it to
the order of the loaders — whose first locale is taken whatever routes its
loaders cover. A `*` range in the header is a preference of its own: it takes
the first locale served before `initLocale` is tried.
`initLocale` is a candidate here, not a load: the instances `/kit` builds leave
it out, since the negotiated locale is loaded instead.

`preferredLocale` runs in `handle`, in the server `load` and, in an app without
a server `load`, in the universal one, whose event has no `cookies` (hence
`cookies?.`). It runs on every navigation and every preload, so it must only
read the event. A value it returns that no configured locale matches is
skipped, and one that throws is logged once and skipped. With a server `load`,
it runs in the browser only on a root error page SvelteKit renders without the
server's data, such as an unknown URL a static host answers with its fallback
page, and there too the event has no `cookies`. A navigation to a prerendered
page takes the locale `preferredLocale` gave that page at build time, and
otherwise keeps the tab's.

The server's answer rules. `i18n.setLocale('cs')` in the browser switches the
tab, and the switch stands across navigations until the server answers
differently; an answer given before the switch (a preload, say) is not a
different one. To make a switch outlive the session, persist it where
`preferredLocale` reads it:

```javascript
document.cookie = `lang=${locale}; path=/; max-age=31536000; samesite=lax`;
await i18n.setLocale(locale);
```

A locale in the URL is a route param:

```javascript
export const { handle, load, use, get } = defineI18n(config, {
  preferredLocale: (event) => event.params.lang,
});
```

Loader [`routes`](#routes-optional) then see the locale segment
(`/cs/about`), since they match `url.pathname`. With an optional segment
(`[[lang]]`), the unprefixed pages name the default locale themselves:

```javascript
preferredLocale: (event) => event.params.lang ?? 'en',
```

Without the `?? 'en'`, `/about` has no answer from the URL, and a navigation
from `/cs/x` to a prerendered `/about` keeps `cs`. A default returned from
`preferredLocale` says the URL names that locale; the default for a visitor
whose cookie or header names none belongs in [`initLocale`](#initlocale).

Under SvelteKit 3, a param matcher may parse a param, which then reaches
`preferredLocale` parsed — a number, say — while the event's default type
reads every param as a string. Annotate the event as
`Kit.Event<Partial<Record<string, Kit.ParamValue>>>`
(`import type { Kit } from '@sveltekit-i18n/base/kit'`) to see that, and
return a string: a number is no locale, so it is skipped.

### What `data.i18n` is

In `+layout.svelte`, `+page.svelte`, `page.data` and a universal `parent()`,
`data.i18n` is the instance. In a server `parent()` it is what the server
branch returned: plain data, of which only `.locale` is meant to be read.
SvelteKit's generated types call it the instance in both places.

`use()` finds its data under a registry-wide symbol, not under `i18n`, so a
layout that renames or overwrites `data.i18n` does not break it.

### Combining with your own code

```javascript
// src/hooks.server.js
import { sequence } from '@sveltejs/kit/hooks';
import { handle as i18nHandle } from '#lib/i18n.js';

export const handle = sequence(i18nHandle, auth);
```

```javascript
// src/routes/+layout.server.js
import { load as i18nLoad } from '#lib/i18n.js';

export const load = async (event) => ({ ...(await i18nLoad(event)), user: event.locals.user });
```

```javascript
// src/routes/+layout.js
import { load as i18nLoad } from '#lib/i18n.js';

export const load = async (event) => ({ ...(await i18nLoad(event)), theme: 'dark' });
```

In TypeScript, type a wrapper with SvelteKit's `$types` (`LayoutServerLoad`,
`LayoutLoad`). The `Kit` event types carry only what the wiring reads: no
`locals` a server wrapper can count on, no `parent` or `fetch`, and a `data`
that drops the server's fields from the layout's.

Keep the spread: the universal branch returns the server's data along with the
instance, and a wrapper that picks fields drops the rest. A server wrapper must
call the i18n `load` before it returns — it reads `url`, which is what makes
SvelteKit run the layout again on the next navigation. Pass `data.i18n` on as
the object it is: a wrapper that copies it costs the page render a second
instance.

### Where it runs

| Pass | Server `load` | Universal `load` | Effect |
|---|---|---|---|
| Page render (SSR) | negotiates, loads, returns the snapshot | the instance the server branch loaded (a fresh one from the snapshot when a loader has `cache: false`) | — |
| Hydration | — | the tab's instance, from the same snapshot, active before the first render | `use()` provides it |
| Navigation | negotiates, returns the locale and the route | preloads the target locale for the new route | `use()` switches and sets the route at commit, showing what the preload fetched |
| Preload | the same | the same | none: a preload shows nothing |
| Navigation to a prerendered page | — (the build's page render) | preloads the locale `preferredLocale` gave at build time, or else the tab's | `use()` switches to that locale at commit, or keeps the tab's |

Each preload runs `load`, which preloads the target locale's translations for
the link's route, and the navigation that commits it shows what that load
fetched. To keep hovering from fetching, turn preloading off where it costs too
much: `data-sveltekit-preload-data="false"`.

### Pitfalls

- **Translate in markup, not in `load`.** A string built in `load` is built
  once, in the locale of that pass; `i18n.t()` in the template follows a
  switch.
- **An app without a server `load` renders its SSR pass with no request
  headers**, in the locale `preferredLocale` gives or else the default, so the
  server and the browser can negotiate differently, and
  `handle` still fills `%lang%` and `%dir%` from `Accept-Language`, so
  `<html lang>` can name another locale than the page renders. Put the locale in the URL, or add
  the server `load`.
- **A prerendered page has no visitor.** It renders the locale
  `preferredLocale` finds in the URL, or else the default (`initLocale`,
  `fallbackLocale`, the first locale served). A
  client navigation to one takes the locale `preferredLocale` gave at build
  time, and otherwise keeps the tab's, so a cookie-first `preferredLocale` that
  falls back to the URL follows the URL there. A query string (`?lang=`) does
  not reach a prerendered page and the build's hostname is not the visitor's,
  so a locale read from either is not supported on one.
- **With a `reroute` hook,** loaders match the path the visitor requested, not
  the one SvelteKit rerouted to.
- **A negotiated response varies by visitor.** The page and its `__data.json`
  depend on `Accept-Language` and on whatever `preferredLocale` reads, and
  `/kit` sets no `Vary` header, since it cannot know what that is. Before
  caching such a response in a shared cache — `cache-control: public`, a CDN —
  add `Vary` for what it depends on (`Accept-Language`, `Cookie`), or cache
  only pages whose locale is in the URL.
- **The `browser` condition picks the half.** The server branch is resolved
  through the package's `imports` map under the `browser` condition to a stub
  that throws. An SSR target that resolves `browser` — a worker build, an
  adapter bundling for the browser platform, a test runner with
  `resolve.conditions: ['browser']` — therefore gets the stub.
- **Under a base path**, set [`basePath`](#basepath): the routes handed to the
  instance lose it on the way in.
- **The hash router is not supported.** Under `router.type: 'hash'`, the route
  lives in `url.hash`, while loaders are matched against `url.pathname`, so a
  route-scoped loader never matches.
- **A loader can still run at commit.** The commit fetches again what `load`
  did not deliver, such as a loader that failed soft, one an
  [invalidation](#invalidatelocale-namespace) covered between the two, one the
  commit has to load anyway (one with [`cache: false`](#cache-optional), say)
  once a seed or another delivery replaced what it showed between the two,
  or a `cache: false` loader whose fetch `load` only shared, which started
  before the navigation was requested (the commit shows that one, then
  refreshes it behind). A `redirect()` or an `error()` thrown there is not
  followed: SvelteKit follows control flow thrown in `load` only. The tab stays
  on its locale, and the next navigation with the same answer switches again —
  one preloaded while that switch was under way included.

---

## Server-Side Rendering

A module that creates an instance is evaluated **once per process** on the
server, not once per request. A module-level singleton is therefore shared by
every visitor being rendered concurrently: two requests for different locales
overwrite each other's `locale` and translation tables, one visitor's language
can end up in another visitor's HTML, and a `redirect()` or an `error()` a
loader throws for one visitor rejects every request that shares its load.

Create **one instance per request** instead, and hand its state to the client
with [`snapshot()`](#snapshotoptions) and [`hydrate()`](#hydrateenvelope).

In a SvelteKit app, [`@sveltekit-i18n/base/kit`](#sveltekit) does all of this
for you. The recipe below is the same wiring by hand, for an app that needs
something the wiring does not do.

### 1. Export the config, not the instance

```javascript
// src/lib/translations/index.js
import parser from '@sveltekit-i18n/parser-curly';

/** @type {import('@sveltekit-i18n/parser-curly').Config} */
export const config = {
  parser: parser({ onReport: null }),
  loaders: [/* ... */],
};
```

### 2. Load on the server, per request

```javascript
// src/routes/+layout.server.js
import { I18n } from '@sveltekit-i18n/base';
import { config } from '#lib/translations/index.js';

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
import { I18n } from '@sveltekit-i18n/base';
import { config } from '#lib/translations/index.js';

// Assigned in the browser only — on the server this module-level binding
// would be the shared state we are avoiding.
let client;

export const load = async ({ data, url }) => {
  if (client) {
    // A later pass may be a preload, which shows nothing: the layout hands
    // its token to the call that commits the navigation.
    const locale = data.i18n?.locale ?? client.locale;
    const preloaded = await client.preload(locale, url.pathname);

    return { i18n: client, commit: { locale, route: url.pathname, preloaded } };
  }

  const i18n = new I18n(config);

  i18n.hydrate(data.i18n);

  if (!import.meta.env.SSR) client = i18n;

  await i18n.loadTranslations(data.i18n?.locale ?? i18n.locale, url.pathname);

  return { i18n };
};
```

This `load` runs on the server for the SSR pass and again in the browser on
hydration, and each of those passes builds the instance. Both start from the
server's state: the loaders that delivered on the server do not run a second
time, and the locale is active before the first render. Only what the server
did not load — the few namespaces the snapshot cannot hand over, and a loader
that failed on the server — is fetched. A `redirect()` or an `error()` such a loader
throws on that pass makes SvelteKit leave the page it rendered
([see `loader`](#loader-required)). With `ssr = false` this `load` does not run
on the server — the server `load` of step 2 still does — and the first pass in
the browser builds the instance from that snapshot.

Every later pass runs in the browser and reuses the instance, so its cache
survives — but it may be a preload. SvelteKit runs `load` for a preload too,
and the `app.html` that `sv create` scaffolds preloads a link's page as the
pointer hovers it, a page the visitor may never open. So only the pass that
builds the instance activates, since no preload runs before it, and a later
pass calls [`preload()`](#preloadlocale-route) instead: it fetches what the
target needs without switching the locale or the route, and returns its token
for the commit ([step 4](#4-pass-it-down-and-commit-each-navigation)).

The hand-off is applied once, on the path that builds the instance —
replaying it on a later navigation would mark loaders loaded again after an
[`invalidate()`](#invalidatelocale-namespace). It is applied on top of the config, so
whatever the config declares stays where it is.

Leave [`initLocale`](#initlocale) out of a config used this way. It starts its
load inside the constructor, before the hand-off can be applied, so the loaders
run regardless (and [`hydrate()`](#hydrateenvelope) warns) — the locale belongs
in the `loadTranslations()` call above.

### 4. Pass it down, and commit each navigation

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { setContext, untrack } from 'svelte';

  let { data, children } = $props();

  // Read once: in the browser, every later pass returns the instance the
  // first one built.
  setContext('i18n', untrack(() => data.i18n));

  // The effect runs as a navigation commits; never for a preload.
  $effect.pre(() => {
    const { i18n, commit } = data;

    if (commit) i18n.loadTranslations(commit.locale, commit.route, { preloaded: commit.preloaded });
  });
</script>

{@render children()}
```

The effect switches to the locale and the route of the navigation that
commits, and [`{ preloaded }`](#loadtranslationslocale-route-options) shows
what the preload fetched instead of fetching it again, at once when nothing
else is left to fetch. `$effect.pre` makes the call before the page updates, so
the page then renders with it. The pass that built the instance returns no
`commit`: it activated already. What the call still fetches — a loader that
failed soft during the preload, say — cannot redirect: SvelteKit follows a
`redirect()` or an `error()` thrown in `load` only, so one a loader throws
during the call rejects it, and the call is [undone](#loader-required) and
logged.

The server's locale wins on every navigation and whenever the layout's `load`
runs again — `invalidateAll()`, `refreshAll()` (SvelteKit 2.27 and later) and
the refresh `use:enhance` makes after a successful form action — so persist a
client switch where your `handle` reads it (a cookie, say). A page
shown without a navigation — `preloadData()` and a shallow `goto()`
(`pushState()` on SvelteKit 2), shallow routing — is never committed: an app
that needs its translations calls `loadTranslations()` with the `commit` from
`result.data` and, once the shallow page closes, calls it again with the active
locale and the route of the page beneath.

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
- every request renders the same locale, no loader's `routes` capture params
  (concurrent requests would compete for whose params are shown), and no loader
  throws a `redirect()`
  or an `error()` that depends on the visitor (a remote `query` that reads the
  session, say): concurrent requests share a load, so every one of them
  rejects with what the loader threw for one visitor.

Then one module-level instance, imported wherever it is needed, is all you
need:

```javascript
// src/lib/i18n.js
import { I18n } from '@sveltekit-i18n/base';

export const i18n = new I18n(config);
```

In the browser, load it as steps 3 and 4 do: the first pass calls
`loadTranslations()`, and every later one [`preload()`](#preloadlocale-route)
in `load`, with the commit in the layout's `$effect.pre`, so a hovered link does
not switch it. On the server no effect runs, so every pass calls
`loadTranslations()`. The instance exists before the first pass, so
`+layout.js` keeps a module-level flag (`let started = false`) to tell that pass
apart, and sets it on that pass in the browser only, as step 3 sets `client`.

An instance with a shorter life than the app (a per-request one, or a
component-scoped one) should be released with [`destroy()`](#destroy) when its
owner goes away.

---

## Utilities

Five pure helpers are published separately: three the instance uses
internally, for the cases where consumer code has to match the library's own
behavior, and two the instance never calls, for deciding which locale to ask it
for and which direction that locale is written in:

```javascript
import { matchLocale, resolveLoaders, sanitizeLocales, textDirection, toDotNotation } from '@sveltekit-i18n/base/utils';
```

The rest of the internals stays private – the subpath exports these five, plus
the `DotNotation` type they are described with.

### `toDotNotation(input, preserveArrays?)`

**Type:** `<I>(input: I, preserveArrays?: boolean, parentKey?: string) => DotNotation.Output<I>`

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
[`'preserveArrays'`](#preprocess) behavior. A `parentKey` prefixes every key of
the top level: `toDotNotation({ a: 1 }, false, 'ns')` is `{ 'ns.a': 1 }`.

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

### `textDirection(locale)`

**Type:** `(locale: string | undefined) => 'ltr' | 'rtl'`

The direction a locale is written in, ready for a `dir` attribute:

```svelte
<div dir={textDirection(i18n.locale)}>
  <p>{i18n.t('content')}</p>
</div>
```

```javascript
import { textDirection } from '@sveltekit-i18n/base/utils';

textDirection('ar-EG');   // 'rtl'
textDirection('ckb');     // 'rtl'
textDirection('az-Arab'); // 'rtl'
textDirection('az-Latn'); // 'ltr'
textDirection('en');      // 'ltr'
```

It keeps no list of languages. The script decides: the one the tag spells
(`az-Arab` and `pa-Arab` are right-to-left, `az-Latn` and `pa-Guru` are not),
or else the likely one `Intl.Locale#maximize()` adds (`dv` is written in
Thaana, `ckb` in Arabic), checked against the scripts Unicode writes right to
left. The engines' own `getTextInfo()` is deliberately not read: JavaScriptCore
(measured on Bun; the engine behind Safari) reports `dv`, `rhg` and `az-Arab`
as left-to-right.

An extension changes nothing (`ar-EG-u-nu-latn` is `'rtl'` like `ar`), but a
region can pick the likely script: `pa` is written in Gurmukhi, `pa-PK` in
Arabic, so `pa-PK` is `'rtl'` (likewise `az-IR` and `uz-AF`).

**⚠️ The likely script is the engine's data.** Engines ship different CLDR
versions: Dari (`prs`) gets no script in JavaScriptCore and reads as
left-to-right there, and `ku-IQ` is Arabic on Node but Latin on Deno and Bun.
The server's `%dir%` and the browser's could then disagree. A locale whose
direction matters spells its script – `prs-Arab`, `ku-Arab` – which reads the
same on every engine.

A tag `Intl.Locale` rejects, and `undefined` before a locale is active,
are `'ltr'` rather than a throw.

With [`/kit`](#sveltekit), `<html dir>` takes none of this: `handle` fills a
`%dir%` placeholder and `use()` keeps the attribute in sync.

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
- ❌ Generating that schema from your translation files — the slot ships, not the generator ([@sveltekit-i18n/typegen](https://github.com/sveltekit-i18n/typegen) is a separate package)

Keys as members of `t` — `i18n.t.home.title()` beside `i18n.t('home.title')`
— come from
[`@sveltekit-i18n/extension-typed-access`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-typed-access),
an official [extension](#extensions) typed from the same schema. It reads the
keys nested by segment that
[@sveltekit-i18n/typegen](https://github.com/sveltekit-i18n/typegen) registers
beside the schema, as `tree`, and groups the keys itself without them; the core
reads none of it.

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
output has to narrow before using it. Two paths hand back data unchecked: a
configured `fallbackValue` (one of the right shape covers the miss), and the
stored value while the config carries no parser yet.

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
  loaders: [{ locale: 'sk', namespace: 'common', loader: async () => ({}) }],
});

i18n.locale;  // 'en' | 'de' | 'cs' | 'sk' | (string & {}) | undefined
```

The union narrows **inputs** — `setLocale()`, `loadTranslations()`,
`loadNamespace()`, `preload()`, `invalidate()`, the first argument of `l()`,
and assignment to [`locale`](#locale) — and the **reads** [`locale`](#locale)
and [`locales`](#locales). The
[translation tables](#translations--rawtranslations) are not narrowed: they
stay plain `string`-keyed records.

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
  loaders: locales.map((locale) => ({ locale, namespace: 'common', loader: async () => ({}) })),
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

**The pipe folds a tuple.** A config kept in a variable widens its
`extensions` to an array, whose order and length the type no longer knows,
and the result is then typed as the bare instance while the call still returns
the last extension's output. Hand the extensions over in the call, as above,
or keep the config `as const`:

```typescript
export const config = { ...base, extensions: [withGreeting] } as const;

new I18n(config).greet('World'); // typed
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

## Upgrading from 3.2

A 3.2 config loads in 3.3 as it is. What behaves differently:

**A call whose data cannot be applied is undone.** In 3.2, when a custom
[`preprocess`](#preprocess) threw on what a call's load brought, the call
rejected but the locale it asked for stayed requested, so the next
`setRoute()` loaded that locale again; and a call with nothing left to fetch
threw synchronously. In 3.3 such a call is undone as one whose loader threw
SvelteKit's control flow, except that its route stands: the locale goes back
to what it replaced and is loaded for that route. It never throws
synchronously: it returns the rejected promise, and the failure is logged
once. See [`loader`](#loader-required).

**A `/kit` navigation shows its data at commit.** In 3.2, every navigation
after the first loaded its target warm, and the commit then judged the
[`cache`](#cache) window and ran a [`cache: false`](#cache-optional) loader
again, so the page showed the previous page's text, or raw keys, until that
fetch landed. In 3.3 `load` [preloads](#preloadlocale-route) the target and
`use()` hands the commit the token, which shows what the preload fetched in
the commit's own flush: a `cache: false` loader the preload ran is not run
again at commit, and one whose fetch the preload only shared is refreshed
behind what it shows. A
preload is a request, a hover's included, so it ends the pass a
[`hydrate()`](#hydrateenvelope) hand-off held a `cache: false` loader back
for. On the first page without a snapshot to hydrate — no server `load`,
`ssr = false` — the first commit ran a `cache: false` loader again, after
`load` had run it; in 3.3 that commit takes the load of `load` as its own,
unless the instance is `loading`, something landed in it or invalidated what
the page loads in between, or its [snapshot](#snapshotoptions) cannot record every loader
the page selects: one failed soft, has no `id`, or feeds a namespace that
holds a literal `__proto__` key or that the snapshot leaves out.

**A hand-wired app should stop activating a preload.** SvelteKit runs the
universal `load` for a preload too, and the `app.html` that `sv create`
scaffolds preloads a link's page on hover. In 3.2, the
[SSR recipe](#server-side-rendering) called `loadTranslations()` on every pass
of that `load`, and 3.3.0 kept it, so hovering a link switched the instance to
the route of a page the visitor may never open, and to the locale the server
answered for it. In 3.3, [`preload()`](#preloadlocale-route) fetches a target
without switching to it, and the recipe now uses it: only the pass that builds
the instance calls `loadTranslations()`, every later one calls `preload()` and
returns its token, and the layout hands that to `loadTranslations()` as the
navigation commits
([step 3](#3-build-the-instance-the-app-renders-with) and
[step 4](#4-pass-it-down-and-commit-each-navigation)). An app wired from the
earlier recipe, or a [singleton](#when-a-singleton-is-enough) whose `load`
calls `loadTranslations()`, should make the same change; [`/kit`](#sveltekit)
needs none. An instance piped through
[`extension-stores`](https://github.com/sveltekit-i18n/extensions/tree/master/extension-stores)
carries `preload()` from extension-stores 3.2.

**A page render builds one instance.** In 3.2, the universal `load` of a page
render hydrated the server `load`'s snapshot into a second instance, so every
table was preprocessed twice per request. In 3.3 it takes over the instance the
server `load` loaded, unless a loader has `cache: false`. A wrapper that copies
`data.i18n` builds the second instance as before (see
[Combining with your own code](#combining-with-your-own-code)).

**A schema-typed `t` or `l` call costs the checker the same at any schema
size.** In 3.2, a call on a key of the [`schema`](#schema) read every key of
it; in 3.3 it costs about a hundred instantiations, at a thousand keys as at
ten thousand. A key outside the schema, or one typed as a union of many of its
keys, folds the payloads of all of them: in 3.2 that took time about cubic in
the number of keys, which could stall an editor or `svelte-check` for seconds
to minutes and, at a few thousand keys with a payload each, failed as too
complex (TS2859). In 3.3 it costs instantiations linear in the keys: at a
thousand keys with a payload each, under a second where 3.2 took about fifty.
A function typed
`<K extends Schema.Key<S>>(key: K, ...rest: Schema.Params<S, K, Parser.Params>) => …`,
as a wrapper spells `t` (or `l`, with the locale first), and the instance's
`t` or `l` are now assignable both ways; in 3.2 neither assignment compiled
once the schema had two keys. Which calls typecheck is otherwise unchanged.

**Large catalogues load in linear time.** In 3.2, merging a load into a
locale's table copied every key merged so far, so a locale of 16,000 keys took
tens of seconds to load; in 3.3 it takes milliseconds. A seed over a wide
namespace and a [snapshot](#snapshotoptions) of a wide level holding a
`__proto__` key are linear too. The tables are built differently for it: on
Node and Deno, a table of up to about a thousand keys (a wider one was built
so in 3.2 already) takes many times as long to list (`Object.keys`,
`for...in`) and two to five times as long to serialize, and each instance
holding the same keys, as a server builds one per request, retains two to four
times the memory. Bun shows none of this.

**A custom [`preprocess`](#preprocess) is called once per rebuilt locale.**
In 3.2, a loader that delivered again also had `preprocess` called on its
namespace's seeds, if any, and on the new delivery before the whole table,
results it then discarded. In 3.3 it is called once per locale the delivery
rebuilds, with the whole table.

**A namespace holding `NaN` travels in the [snapshot](#snapshotoptions)** with
its record. In 3.2 the snapshot took it for one that had lost a `__proto__`
key: it warned, left it out of the plain `snapshot()` and dropped its loader's
record, so a client hydrating it loaded the namespace again.

**`/kit` takes the params a SvelteKit 3 matcher parsed.** Up to 3.3.1, `handle`
and `load` typed every param as a string, so under SvelteKit 3 one matcher
that parses a param made `handle: Handle = i18n.handle`,
`sequence(i18n.handle)` and a typed wrapper calling `load` fail to compile. In
3.3.2 they take events of any params, so a member an app implements against
`Kit.T` reads its event's params as `any` unless it annotates the event
(for `handle`, `Kit.RequestEvent`). For `preferredLocale`, see
[Which locale](#which-locale).

### New

- [`preload(locale, route?)`](#preloadlocale-route) — the request of a navigation that may never commit; it resolves to a token for the call that commits it.
- [`{ preloaded }`](#loadtranslationslocale-route-options) on `loadTranslations()` and [`setRoute()`](#setrouteroute-options) — the commit shows what the preload fetched instead of fetching it again.
- `Loader.Preloaded` — the type of that token.
- `Kit.ParamValue`, and a params type parameter on `Kit.Event` and the event types built on it — for the params a SvelteKit 3 matcher parsed.

---

## Upgrading from 3.1

A 3.1 config loads in 3.2 as it is. One behaviour of `/kit` changes:

**A pass always has a locale when the config serves one.** In 3.1, when neither
`preferredLocale`, what the visitor's browser asks for, `initLocale` nor
`fallbackLocale` named a locale the config serves, the pass had none: nothing
loaded, every `t()` returned `''` and `%lang%` was empty. In 3.2 negotiation
ends with the first locale the config serves — the loaders' locales in config
order, then the `translations` keys (see [Which locale](#which-locale)). Set
[`initLocale`](#initlocale) to choose the locale such a visitor gets, rather
than leave it to the order of the loaders. Only a config that serves no locale
still renders without one.

---

## Upgrading from 3.0

A 3.0 config loads in 3.1 as it is, and nothing public was removed. What
changes is how some loads behave — and one change affects every app that hands
server-rendered data to the client through `addTranslations()`, so read
**Behaviour changes** first.

### Behaviour changes

**Seeds no longer count as loaded.** In 3.0, data passed to
[`translations`](#translations) or
[`addTranslations()`](#addtranslationstranslations) marked its namespaces
loaded, so their loaders never ran. In 3.1 it only seeds the tables: the
loaders of those namespaces still run, and their data merges over the seed. A
client that took the server's [`snapshot()`](#snapshotoptions) through
`addTranslations()` therefore fetches everything again after hydration —
switch it to [`hydrate()`](#hydrateenvelope):

```javascript
// 3.0
i18n.addTranslations(data.translations);

// 3.1 — the server returns { i18n: i18n.snapshot({ records: true }) }
i18n.hydrate(data.i18n);
await i18n.loadTranslations(data.i18n?.locale ?? i18n.locale, url.pathname);

// 3.1 — or, with the server returning { locale: i18n.locale, translations: i18n.snapshot() }
i18n.hydrate({ translations: data.translations, locale: data.locale });
await i18n.loadTranslations(data.locale ?? i18n.locale, url.pathname);
```

The locale handed over is the server instance's `locale`, not the raw value
your `handle` negotiated: `hydrate()` writes it as it is.

The [SSR recipe](#3-build-the-instance-the-app-renders-with) shows the whole
wiring, and [SvelteKit](#sveltekit) does it for you.

**`snapshot()` serializes what the instance holds, not what the route
claims.** 3.0 left out a namespace owned only by loaders of other routes; 3.1
keeps it, so the payload can grow. The plain form leaves out instead what
plain data cannot hand over — a namespace fed by several loaders, a namespace
of a loader whose `routes` capture params, and a namespace none of whose
loaders delivered — and the client loads those itself. The records form,
`snapshot({ records: true })`, hands them over too — except a namespace of a
loader that captures params when several loaders feed it or one of them holds
no record, which the client still loads itself. See
[`snapshot()`](#snapshotoptions).

**Each loader is recorded on its own.** In 3.0, a namespace counted as loaded
once any of its loaders had delivered, so a sibling scoped to another route
never ran. In 3.1 each loader runs on its own routes and merges into what the
others delivered, so a namespace can be split into
[`routes`-scoped chunks](#namespace-required).

**Named capture groups are route params.** 3.0 reserved them. In 3.1 a named
group in a route `RegExp` reaches the loader as `params`, the loader runs
again when they change, and its new data replaces what it delivered for the
previous params. Turn a group you only use for grouping into a non-capturing
one, `(?:...)`. See [Route params](#route-params).

**SvelteKit's `redirect()` and `error()` below 500 reject the load.** In 3.0
every throw failed soft. In 3.1 a loader that throws that control flow rejects
the load once its other loaders have settled, the locale does not advance, and
the call is undone. Any other throw, an `error()` of 500 or more included,
still fails soft. A loader that redirects must not run on the page it
redirects to. See [`loader`](#loader-required).

**A loader that returns nothing counts as loaded.** In 3.0 a loader resolving
`undefined` or `null` ran again on every trigger; in 3.1 it has answered, as
one returning `{}` has. Throw when you want it retried. See
[`loader`](#loader-required).

**A request for a locale nothing serves changes nothing.** In 3.0,
`setLocale()` with a locale no loader, no translations and no
[`fallbackLocale`](#fallbacklocale) serve still became the requested locale,
and `loadTranslations()` still moved the route. In 3.1, once the instance
knows a locale, such a request writes neither. See
[`setLocale()`](#setlocalelocale).

**An invalidation no longer drops a whole load in flight.** In 3.0,
`invalidate()` discarded all of a load in flight for the locale, and its
trigger resolved without activating. In 3.1 only the invalidated loaders are
discarded, the rest lands, and an activating trigger fetches the discarded
part again before it activates. See
[`invalidate()`](#invalidatelocale-namespace).

**A custom `preprocess` that throws keeps nothing.** In 3.0 `rawTranslations`
kept the data even though `translations` did not. In 3.1 neither table
changes. In both, the loaders run again on the next trigger. See [Custom Function](#custom-function).

**The tables are replaced whole.** [`translations` and
`rawTranslations`](#translations--rawtranslations) are held as raw state: in
the browser they are the objects themselves, not proxies, and changing them in
place re-renders nothing. Write with
[`addTranslations()`](#addtranslationstranslations), as before.

**The loading calls read what they write untracked.**
[`setLocale()`](#setlocalelocale), [`setRoute()`](#setrouteroute-options),
[`loadTranslations()`](#loadtranslationslocale-route-options),
[`loadNamespace()`](#loadnamespacenamespace-locale),
[`loadConfig()`](#loadconfigconfig),
[`addTranslations()`](#addtranslationstranslations) and
[`hydrate()`](#hydrateenvelope) read the state they write untracked, so an
`$effect` may call them without re-running whenever a later call, a load or an
undo changes that state. An effect that relied on re-running because such a
call read the requested locale, the route or the config no longer does — read
what it follows in the effect itself.

### Type changes

- **`Loader.Props` gains `namespace` and `params`**, both required. A loader
  that reads only `locale` and `route` still type-checks; code that calls a
  loader by hand passes them. See [`loader`](#loader-required).
- **`Loader.LoaderModule`**: `locale` and `namespace` may be arrays, and `key`
  is optional. Code that reads a descriptor's `locale` or `key` as a string
  runs it through [`resolveLoaders`](#resolveloadersloaders-sanitizelocales)
  first and reads the resolved `locale` and `namespace`. Naming both `key` and
  `namespace` is a type error. It is now a union, so an `interface` can no
  longer extend it — use a type alias with `&`.
- **`Loader.LoaderModule` gains `cache`**, typed `false` — see
  [`cache`](#cache-optional).
- **The instance type gains members and parameters:**
  [`loadTranslations()`](#loadtranslationslocale-route-options) takes an
  `options` parameter (`{ activate?: boolean }`),
  [`invalidate()`](#invalidatelocale-namespace) a second parameter
  (`namespace`), and [`loadNamespace()`](#loadnamespacenamespace-locale) and
  [`hydrate()`](#hydrateenvelope) are new members.
  [`snapshot()`](#snapshotoptions) is overloaded: `{ records: true }` returns
  `Snapshot.Envelope`, no argument the data alone. A hand-written object typed
  as the instance implements them.
- New types: `Loader.Params`, `Loader.Resolved`, the `Snapshot` namespace,
  `Config.T['basePath']`, `Schema.FromInstance`, `Schema.Registered`, the global
  `SvelteKitI18n.Register` interface, and the `Kit` namespace from
  `@sveltekit-i18n/base/kit`.

### Deprecations

- **The loader `key` is now `namespace`.** `key` is still honored and warned
  about through the logger once per loader descriptor; it is removed in the
  next major. See [`namespace`](#namespace-required).

### New

- [`@sveltekit-i18n/base/kit`](#sveltekit) — `defineI18n()` wires a SvelteKit app: `handle`, `load`, `use()` and `get()`.
- [`basePath`](#basepath) — strips SvelteKit's `paths.base` from every route handed in.
- [Several locales and namespaces](#several-locales-and-namespaces) — one loader descriptor for many pairs.
- [Route params](#route-params) — named capture groups reach the loader as `params`.
- [`cache: false`](#cache-optional) on a loader — for a source that does its own caching.
- [`loadTranslations(…, { activate: false })`](#loadtranslationslocale-route-options) — fills the tables without switching; it does not count towards `loading`.
- [`loadNamespace(namespace, locale?)`](#loadnamespacenamespace-locale) — loads one namespace on demand, whatever the route.
- [`invalidate(locale?, namespace?)`](#invalidatelocale-namespace) — invalidates one namespace.
- [`snapshot({ records: true })`](#snapshotoptions) and [`hydrate(envelope?)`](#hydrateenvelope) — the SSR hand-off with load records.
- [`matchLocale()`](#matchlocalerequested-available), [`textDirection()`](#textdirectionlocale) and [`resolveLoaders()`](#resolveloadersloaders-sanitizelocales) from `@sveltekit-i18n/base/utils`.
- [`Schema.FromInstance`](#schema) — reads the key schema off a constructed instance.
- [`SvelteKitI18n.Register`](#schema) — the app registers its key schema once, and every instance whose config states no `schema` is typed by it; `Schema.Registered` reads it. With nothing registered, every config types as in 3.0.

---

## See Also

- [Getting Started Guide](https://github.com/sveltekit-i18n/lib/tree/master/docs/GETTING_STARTED.md) – Step-by-step tutorial
- [Architecture Overview](https://github.com/sveltekit-i18n/lib/tree/master/docs/ARCHITECTURE.md) – How it works
- [Parsers](https://github.com/sveltekit-i18n/parsers) – Available parsers
- [Extensions](https://github.com/sveltekit-i18n/extensions) – Official extensions for the `config.extensions` pipe
- [@sveltekit-i18n/typegen](https://github.com/sveltekit-i18n/typegen) – Generates the [`schema`](#schema) type from your translation files
- [Examples](https://github.com/sveltekit-i18n/lib/tree/master/examples) – Working code examples
- [Best Practices](https://github.com/sveltekit-i18n/lib/tree/master/docs/BEST_PRACTICES.md) – Recommended patterns
