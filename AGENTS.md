# AGENTS.md

Behavioral guidelines for LLM coding assistants working on
**`@sveltekit-i18n/base`**. Applies to Claude Code, Cursor, Codex — anything
that drives commits, PRs, or file edits on this repo.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

**Tradeoff:** These guidelines bias toward caution, correctness, and not
breaking a published library over speed. For trivial tasks, use judgment.

---

## The package

`@sveltekit-i18n/base` is the **core**, parser-agnostic engine of the
[sveltekit-i18n](https://github.com/sveltekit-i18n/lib) ecosystem. It owns
translation state, loading, caching, route matching, and preprocessing — but
**not** message interpolation, which a pluggable parser provides. Four repos:

- **`base`** (here) — core, parser-agnostic, zero runtime deps.
- **`lib`** (`sveltekit-i18n`) — `base` pre-wired with `parser-curly`.
- **`parsers`** — `parser-curly` (the [Curly Message
  Format](https://curlymessage.dev)), `parser-icu` (ICU), `parser-mf2`
  (Unicode MessageFormat 2), `parser-i18next` (i18next's syntax).
- **`extensions`** — official extensions for the `config.extensions` pipe
  (e.g. `extension-stores`).

## Tech stack (ground truth — do not assume otherwise)

| Aspect | Reality |
|--------|---------|
| Language | TypeScript, ESM (`"type": "module"`), `strict: true` |
| Package manager | **npm** with `package-lock.json` (no pnpm/yarn) |
| Build | `svelte-package` → `dist/` (per-file ESM + `.d.ts`; rune modules ship UNCOMPILED) |
| Tests | Vitest + `vite-plugin-svelte` (compiles `.svelte.ts`), environment `node` |
| Lint | ESLint 10 flat config (`eslint.config.js`): typescript-eslint 8 type-checked + `@stylistic` + `import-x/no-extraneous-dependencies` |
| Runtime peer | `svelte >=5` (runes; no `svelte/store`) |
| CI | `.github/workflows/tests.yml` — Node 22 + 24, ubuntu/macOS/windows, plus a Bun and a Deno leg |

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` / `npm ci` | install (respects `package-lock.json`) |
| `npm run dev` | `svelte-package` build in watch mode |
| `npm run build` | `svelte-package` build to `dist/` |
| `npm test` | vitest suite (runs `typecheck` first) |
| `npm run test:dist` | builds, then tests the SHIPPED artifact (`tests/specs/dist.spec.ts`) |
| `npm run typecheck` | `tsc --noEmit` over `src`, `tests` and the root `.ts` configs |
| `npm run lint` | `eslint --fix .` (also the pre-commit hook, via `simple-git-hooks`) |
| `npm run prepare` | installs the git hooks (`simple-git-hooks`); npm runs it automatically after `npm install` |

## Repository map

| Path | Role |
|------|------|
| `src/index.ts` | entry — re-exports the class and public types |
| `src/I18n.svelte.ts` | `class I18nCore` + the exported `I18n` facade — the runes-based core (state, loading, orchestration, extension pipe) |
| `src/utils.ts` | pure helpers (`translate`, `sanitizeLocales`, `toDotNotation`, `serialize`, `fetchTranslations`, `testRoute`) |
| `src/exports/utils.ts` | the published `/utils` subpath — a facade re-exporting the reusable helpers and the `DotNotation` type |
| `src/logger.ts` | `loggerFactory` + module-level `logger` singleton + `setLogger` |
| `src/types.ts` | all public/internal types |
| `tests/specs/index.spec.ts` | the suite |
| `tests/specs/dist.spec.ts` | shipped-artifact checks — runs only via `npm run test:dist` |
| `tests/data/` | `CONFIG` + JSON fixtures + `getTranslations()` |
| `docs/README.md` | public API reference — keep in sync with code |
| `dist/` | generated build output — never hand-edit |
| `vitest.config.ts` / `vitest.dist.config.ts` | test runner configs (see the rolldown filter workaround note inside) |

## Architecture you must respect

- **Runes-based core.** All state lives as `$state`/`$derived` class fields in
  `src/I18n.svelte.ts` — a `.svelte.ts` module compiled by the CONSUMER's
  bundler, not at publish time. The public surface is one reactive instance:
  properties (`locale`, `locales`, `loading`, `initialized`, `translations`,
  `rawTranslations`), reactive functions (`t`, `l`), promise-returning
  methods (`loadTranslations`, `loadNamespace`, `loadConfig`, `setLocale`,
  `setRoute`) and the synchronous `addTranslations`, `snapshot`, `hydrate`,
  `invalidate` and `destroy`.
  There are no stores and no `.get()` duals — reads are plain
  property/method access and are reactive wherever reads are tracked.
- **Loads are imperative, awaitable, and deduplicated.** `setLocale`/
  `setRoute`/`loadTranslations`/`loadNamespace` start loads directly and
  return the promise of the MATCHING load — the in-flight key is what a
  trigger SELECTED (locale, then each loader and params signature), not the
  route it came from, so concurrent duplicates join instead of fetching twice
  and a namespace load never joins an unrelated route load. A trigger joins a
  load under its key only while that load delivers everything the trigger has
  to fetch — nothing severed, nothing left out; `loading` is
  derived from the set of in-flight ACTIVATING loads. A warm load
  (`loadTranslations(…, { activate: false })`, and every `loadNamespace`,
  which selects by namespace and ignores `routes`) only fills the tables: it
  writes neither the requested locale nor the route, never activates on its
  own, counts towards `loading` only once an activating trigger joins it, and
  never evaluates `cache` expiry: it fills the tables and leaves their
  freshness to the activating triggers, which the `cache` docs promise.
  There is no loader-trigger store,
  no promise purge, no `toPromise()`. A failed load rejects the caller's
  promise; a discarded one is reported through the logger and never becomes an
  unhandled rejection.
- **`locale` advances after its load — last request wins.** Reading `locale`
  gives the ACTIVE locale; assigning it is a fire-and-forget `setLocale()`.
  Never surface a locale whose translations have not resolved, and never let a
  superseded load overwrite the most recently requested locale when loads
  resolve out of order.
- **Loaders are lazy and run once per freshness window and route params.** A
  loader fires only when its `locale` matches and its `routes` match the
  current route (or it has no `routes`). A load record names the loader that
  DELIVERED, never the namespace its data landed in: `#loaderRecords` maps the
  resolved descriptor to the signature of the params its routes captured, and
  a loader that threw records nothing. A plain hand-off (`hydrate()` without
  records) records the namespaces its data names instead (`#namespaceRecords`,
  null-prototype, keyed by user-supplied locales), which suppresses those
  namespaces' loaders without params. A seed (`config.translations`,
  `addTranslations()`) records nothing and starts no `cache` window: it lands
  in `#externalTranslations`, and its namespace's loaders still run and merge
  into it. When a loader's params change, its new data REPLACES what it
  delivered before — the namespace is rebuilt from `#externalTranslations` and
  each loader's last delivery (`#deliveries`), so no stale key survives and a
  sibling keeps its part. Last request wins for params too: every ACTIVATING
  trigger records the params it wants per matching loader (`#wanted`), even one
  that joins a load or fetches nothing, and a delivery for other params is
  discarded — a warm load wants nothing, so it never replaces what is shown. Per-locale expiry (`config.cache`, default
  `Infinity` — never expires) and `invalidate(locale?, namespace?)` drop that
  bookkeeping so the NEXT load trigger refetches; a namespace invalidation
  leaves `#loadedAt` alone, so no table outlives the window. Invalidation also
  severs the matching loaders of in-flight loads, per loader — a load that
  lost a loader discards that loader's data when it settles, while the rest of
  it lands, so pre-invalidation data cannot resurrect the dropped bookkeeping.
  A load stays in `#inflight` until it settles, so a later invalidation,
  reconfiguration or `destroy()` still reaches the rest of it. An ACTIVATING
  load then fetches its severed part again (`#resume`) and activates once it
  arrives, so a trigger's promise keeps meaning "loaded"; it stands down when
  the instance was destroyed, another locale was requested, the config was
  replaced or a later trigger wants other params, and a warm load never
  resumes. Neither expiry nor `invalidate` ever removes displayed translations
  or starts a load by itself. Don't break load-once semantics. The one opt-out
  is a loader with `cache: false`, whose source caches: it runs on every
  trigger that selects it, writes no `#loadedAt` stamp and is outside expiry.
  Its record only names what it delivered — for the snapshot, and for
  `loadNamespace` off its routes — and keeps no trigger that selects it from
  running it. Only a hand-off suppresses it, through `#handedOff`, for the
  pass the envelope arrived with — until an activating trigger asks for
  another locale or route, or `invalidate()` covers it.
- **The SSR hand-off is a pair.** `snapshot({ records: true })` serializes the
  data, the records of the loaders that delivered it (their `id` and params
  signature — never a reference), the active locale and the route;
  `hydrate()` resolves each id to a loader of its own config and stores the
  record under that reference, so the records keep one kind of key; the
  record of a `cache: false` loader also hands it off. A hydrated loader's
  namespace becomes its delivery, so new params replace it; data no record
  names is displayed but records no namespace, so whatever the envelope does
  not cover loads again instead of going missing. An envelope without
  `records` is a plain hand-off, the only writer of `#namespaceRecords`: it
  records every namespace its data names and hands off the `cache: false`
  loaders of those namespaces. The plain `snapshot()` therefore leaves out a
  namespace none of whose loaders delivered and no hand-off named — its
  seeded data would otherwise suppress the client's loaders.
- **A loader receives plain data.** `Loader.Props` holds strings and plain
  objects of strings: the locale, the route, and whatever else a loader is
  handed later. Never an `event`, a `fetch`, or any `@sveltejs/kit` type. That
  keeps a loader an ordinary async function the consumer can back with anything,
  a SvelteKit remote `query` included, with no code here. It also keeps
  SvelteKit's rule that a query may not read `event.url`, `params` or `route`
  away from this package. Anything that crosses the SSR boundary (the snapshot
  payload) is plain data for the same reason: SvelteKit serializes it with
  `devalue`, which rejects functions, class instances and an own `__proto__`
  key.
- **Parser is injected, never imported.** `translate()` calls
  `config.parser.parse(value, params, locale, key)`. `Parser.ExtractParams` is
  the build-time half of that contract and deliberately not a member of
  `Parser.T` — a message scanner on the runtime parser object could never be
  shaken out of a browser bundle — so a parser ships it as a separate export
  (which ESM and `sideEffects: false` let a bundle drop) and the core never
  calls it.
- **`config.extensions` is a construction-time pipe.** The constructor returns
  the instance folded through the extensions left to right, so
  `new I18n(config)` evaluates to the last extension's output; `loadConfig()`
  strips the property and never re-pipes. Because a class cannot annotate its
  constructor's return type, the exported `I18n` is a typed facade over the
  local `I18nCore` class (a construct signature folds the type through the
  tuple); the same exported name is also the instance TYPE. The raw class is
  deliberately not exported. Extensions run after the synchronous prefix of
  the config load — they receive a configured instance. An extension typed by a
  fixed return type ERASES the instance's type parameters: that surface is typed
  by the extension, so neither `config.schema` nor the locale union survives it.
  An extension whose output depends on its input declares that with an
  `Extension.Operator` — an interface expressing `output` through
  `this['input']`, applied by `Extension.Apply` and carried as a type-only brand
  by `Extension.Generic`. A generic FUNCTION signature cannot carry that
  dependency: reading one instantiates its type parameters at their constraints,
  so the pipe would fold `unknown` and erase the surface outright.
- **`config.schema` types `t`/`l`, at construction time and type-only.** It
  narrows keys and payloads from the config that reaches the constructor; only
  its TYPE is read, so the slot may hold an empty value
  (`{} as TranslationSchema`), and a schema whose keys are not a closed set
  degrades to plain `string` keys rather than rejecting every call. This package ships the
  slot, not the generator that fills it — never document a CLI or a plugin as
  if it shipped here.
- **Locales ride a fourth class type parameter**
  (`I18n<ParserParams, ParserOutput, TranslationSchema, LocaleUnion>`), not an
  intersection. The loader locales, `initLocale`, `fallbackLocale` and
  `translations` keys a config spells narrow the inputs (`setLocale`,
  `loadTranslations`, `invalidate`, `l`, assigning `locale`) and the reads
  (`locale`, `locales`) alike; the translation tables stay `string`-keyed. The
  union stays OPEN (`L | (string & {})`) — a completion hint, never a
  constraint, since a locale can arrive from a URL, a cookie or an
  `Accept-Language` header — and that openness is what keeps a narrowed
  instance assignable to and from a plain `I18n`. One dynamic source degrades
  the whole union to `string`: a half-known set would complete some locales
  while silently hiding the rest.
- **Preprocessing.** `addTranslations` applies `preprocess` (`'full'` default |
  `'preserveArrays'` | `'none'` | custom fn) via `toDotNotation`.
  `rawTranslations` is pre-preprocess; `translations` is post-preprocess. Keep
  both consistent.

## Invariants — do NOT break these without explicit user sign-off

1. **Zero runtime dependencies.** `dependencies` stays empty; `svelte` is a
   peer dep. Adding a runtime dep is a blocking change — stop and ask.
2. **No breaking changes** to the public instance surface or `types.ts`
   exports. Consumers read `i18n.translations['en']['key']`, call
   `i18n.t('key')` in templates, and await the load methods.
3. **Parser-agnostic.** No imports from `@sveltekit-i18n/parser-*`.
4. **ESM-only (single ESM artifact, no CJS), npm for development.** The
   package targets Node 22+, Bun 1.2+ and Deno 2+: the source imports no
   `node:` module and touches no platform API beyond `Intl` (the network is
   the consumer's loader), and the CI runtime legs exist to keep that true.
   Reaching for a runtime-specific API is a blocking change — stop and ask.
5. **`dist/` is generated** — never hand-edit; never commit unrelated `dist`
   churn.

---

## 1. Think before coding

**Don't guess. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly; if unsure, ask. Clarifying questions belong in
  chat **before** mistakes show up in the diff.
- If multiple interpretations exist, present them — don't pick silently.
- For non-trivial changes, propose the plan in chat **before** touching files.
- **Refetch before reasoning, don't recall.** In long sessions, fetch current
  state (PR/issue meta, branch state, file content, CI status) instead of
  trusting memory. The user may have merged a PR, a hook may have touched files.
  In-session recall is a cache; the system is the source of truth.

## 2. Simplicity first

Minimum code that solves the problem. No speculative features or abstractions.
Validate only at boundaries (consumer config, loader output) — internal
contracts are contracts. That said, this library deliberately **fails soft** at
its public edges (see §11): missing config/parser, a throwing loader, or a
prototype-named key must degrade gracefully, not crash.

## 3. Surgical changes

**Touch only what you must. Match existing style even if you'd write it
differently.**

- Don't "improve" adjacent code/formatting unrelated to the task.
- Don't refactor what isn't broken.
- Remove only the imports/vars/types **your** change orphaned.
- Notice unrelated dead code or a bug? **Mention it in chat** — don't fix
  silently in the same PR.

## 4. Verify before committing

**Every commit's tip is green.**

- Before each code commit: `npm run build` **and** `npm test` pass. Report real
  output — never claim done without running them.
- Type/lint/build errors never reach a commit, not even WIP.
- Doc-only changes skip the build but still verify links resolve and markdown
  renders.

## 5. Commit on approval

**Local changes are the default. Committing is the user's call.**

- Respond to requests by editing **locally**; show the diff; ask "ok?".
- Commit only after explicit approval ("ok", "commit it", "create the commit",
  or a fixup request).
- A modified working tree between turns is the **expected state**, not mess to
  clean up unprompted.
- **Approval is scoped to the named changes.** Approving X doesn't authorize
  bundling unrelated untracked files into the commit.

## 6. Incremental commits & fixup hygiene

- **One concern per commit.** Each commit is self-contained and lands code in
  its **final form**.
- **Never** add code in one commit and refactor it away in a later commit on
  the same branch. Refinement of something this branch already introduced →
  `git commit --fixup=<sha>` + `git rebase -i --autosquash`, not an "address
  review" commit. Standalone commits are reserved for genuinely new concerns.
- "Fix this"/"amend"/refinement language within an active branch means the
  **fixup workflow**, not a new commit.
- After an approved fixup, the local autosquash rebase **and** the
  `git push --force-with-lease` are part of the same approved step — no separate
  approval, but only for the presented changes.
- Commit messages: imperative mood, `type(scope): summary`
  (`fix(logger): …`, `chore(deps): …`, `docs: …`).

## 7. Branch & push discipline

- **Default branch is `master`** (verify via `git remote show origin` if
  unsure). Never commit straight to it; never force-push a shared branch.
- **`master` carries only finished product.** Nothing merges that is not
  complete and shippable as-is — no temporary bootstraps or workarounds for
  unpublished dependencies, no half-built surfaces. Branch-only scaffolding
  (e.g. a `file:` dev dependency standing in for an unpublished package) is
  removed before merge; until its precondition is met, the PR waits as a
  draft.
- **Branch from `master`, not from whatever HEAD happens to be:**
  `git fetch origin && git switch master && git pull --ff-only`, then create the
  branch. Use a descriptive prefix: `fix/<slug>`, `feat/<slug>`,
  `chore/<slug>`, `docs/<slug>`.
- Rebase on `master` before pushing a feature branch; on conflicts, **stop and
  ask** — resolution is judgment, not automation. Never merge `master` into a
  feature branch.

## 8. PRs

- **Every branch headed for `master` gets a PR.** Open it once the branch is
  pushed and green — that is the default, not something to ask about. Skip it
  only when the user says so, or when the branch is not ready to be reviewed.
  Keep it narrowly scoped; list out-of-scope follow-ups under `## Notes` rather
  than expanding silently.
- Title ≤ 70 chars, describes the overarching scope. Body: a short summary +
  what was tested (real results: build/test/audit), and the linked issue via
  closing keywords (`Closes #N` / `Fixes #N`) when one exists.
- **Keep PR meta in lockstep with the branch.** After every push, re-check that
  the title, summary, test results, and "in/out of scope" still match the diff.
  Drift is a defect, not a follow-up.

## 9. Docs track code

Update docs in the same PR that invalidates them. Scope: this file,
`README.md`, `docs/README.md`, JSDoc in `types.ts`. A code change that
contradicts a doc updates the doc (ideally the same commit/fixup). Remove a
feature → remove its docs. Discover stale docs unrelated to your task → flag in
chat (§3).

## 10. Coding conventions

- Formatting contract (the `@stylistic` block in `eslint.config.js`): 2-space
  indent, single quotes, semicolons, trailing commas, no trailing whitespace,
  no multiple blank lines. Let `npm run lint` handle it.
- Prefer the **functional, immutable** style for shared state (computed-key
  spread `{ ...acc, [k]: v }`, `reduce`). That spread form has `DefineProperty`
  semantics — it can't pollute `Object.prototype`. On a **measured hot path** a
  function-local accumulator may be built by mutation instead, but only into a
  null-prototype object (`Object.create(null)`), and it must be finished with a
  single spread before it escapes to consumers — that restores a normal
  prototype while keeping the same pollution safety (see `toDotNotation`).
  Long-lived internal state may be written in place only when it is
  null-prototype and never exposed (see `#namespaceRecords` in §11) — never a plain
  object indexed by consumer input. The locale-indexed folds in `serialize` and
  `#applyDeliveries` keep the spread form deliberately, even though it is
  quadratic in the number of locales: the counts are small, and only a
  measurement showing otherwise justifies moving them to the accumulator form.
- Keep `I18n.svelte.ts` for orchestration; put pure, testable logic in
  `utils.ts`.
- Log through the module `logger` (`logger.error/warn/debug`), never raw
  `console`. Respect the configured level; a custom logger may omit a level —
  don't assume every method exists.
- **Reuse before reimplementing** — `sanitizeLocales`, `toDotNotation`,
  `checkProps`, `hasOwn`, etc. already exist. Grep before adding a helper; bend
  an existing one rather than forking.
- **Abstraction beats duplication.** When code repeats the same (or
  near-same) logical structure, that repetition is a candidate for
  abstraction — factor the shared shape into one named unit (helper, type,
  constant). This is distinct from §2's ban on *speculative* abstraction: §2
  forbids inventing indirection for a hypothetical future; this rule
  consolidates duplication that **already exists**. When a fix would add a
  second copy of an existing structure, prefer extracting the shared core over
  pasting the copy. If the consolidation is large or reshapes call sites,
  surface the trade-off (§1) and recommend rather than refactor silently (§3).

## 11. Security & robustness posture

This is a library with no eval/DOM/filesystem/network of its own (network is the
consumer's loader). Realistic risks are **DoS / robustness / prototype-chain**,
not RCE/XSS.

- **Prototype keys are missing translations.** Reads of a translation table by a
  user-controlled key must use an own-property check (`Object.prototype.
  hasOwnProperty.call`, or the `hasOwn` helper) so `toString`/`__proto__`/
  `constructor` are treated as missing, not inherited members.
- **Never bracket-assign a user-supplied locale or key onto a plain object.**
  `table[locale] = value` routes `'__proto__'` through the prototype setter, so
  no own key is recorded and the object's prototype is replaced. Write with a
  computed-key spread (`{ ...table, [locale]: value }`, which is
  `DefineProperty`) or target an `Object.create(null)` object — that is why
  `#namespaceRecords` has a null prototype. The locale-indexed accumulators in
  `serialize` and `#applyDeliveries` are plain objects and stay correct only
  while they follow this rule.
- **Fail soft at the edges.** A single throwing loader must not wipe a whole
  batch; a missing config/parser must not throw on `t()`/`l()`.
- **`route` reaches `RegExp.test()` and is visitor-controlled** (`url.pathname`)
  — dev-supplied route regexes are a ReDoS surface. Don't add regex handling
  that worsens it; flag it if touched.

## 12. Comments & language

- Default to **no** comment; code says *what*, comments say *why* (a hidden
  constraint, an invariant, a non-obvious workaround). Never reference the
  current task, a fixed bug, or a PR number — that rots.
- A name that needs a comment to explain it is the wrong name — fix the name.
- If you need a paragraph-long comment to justify why the workaround is OK,
  the code is wrong — fix the code.
- **All committed/published artifacts in English** — code comments, commit
  messages, PR titles/bodies, doc files. Chat may stay in the user's preferred
  language; the moment it crosses into something on GitHub, switch to English.

## 13. Tests

- Tests live in `tests/specs/index.spec.ts`; fixtures in `tests/data/`. The
  exception is `tests/specs/dist.spec.ts`, which exercises the SHIPPED artifact
  and runs separately via `npm run test:dist` (which builds first).
- Drive behavior through the **public API** (`new i18n(CONFIG)`, reactive
  properties, awaited method returns). Pure helpers may be imported directly
  from `src/` when that yields a more deterministic test (e.g. unit-testing
  `loggerFactory`).
- Wait on awaitable promises or observable state, never on wall-clock sleeps —
  the CI matrix has six legs and timing-based tests flake on the slow ones.
- **Bug fixes are test-driven (red → green).** Write a test that reproduces the
  bug, confirm it **fails** against the unfixed code, then fix, then watch it
  pass. State that you verified both directions. Commit the regression test
  **alongside** the fix — never a fix without it. Escape hatch (SSR hydration,
  infra, purely visual): say so explicitly in the PR with manual repro steps.
- Don't assert on the shared module-level `logger` singleton — it leaks across
  async tests; construct a logger/instance locally instead.
- `t`/`l` resolve via a no-op test parser (`parse: (...) => key`) — design
  assertions accordingly.

## 14. Output style

- Terse. Lead with results. No "I'll do X" preamble, no trailing recap of the
  diff.
- **One file = one visible operation** — create/modify files as discrete edits,
  not a shell loop that emits many at once, so each appears as its own diff.
- **No emojis** in code, commit messages, or PR descriptions unless requested.

---

**These guidelines are working if:** PRs review easily, commits read as a single
coherent story, the published API never breaks by accident, and clarifying
questions show up in chat before mistakes show up in the diff.
