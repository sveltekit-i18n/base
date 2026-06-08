# AGENTS.md

Behavioral guidelines for LLM coding assistants working on
**`@sveltekit-i18n/base`**. Applies to Claude Code, Cursor, Codex — anything
that drives commits, PRs, or file edits on this repo. Optimized for Claude
Opus 4.8.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

**Tradeoff:** These guidelines bias toward caution, correctness, and not
breaking a published library over speed. For trivial tasks, use judgment.

---

## The package

`@sveltekit-i18n/base` is the **core**, parser-agnostic engine of the
[sveltekit-i18n](https://github.com/sveltekit-i18n/lib) ecosystem. It owns
translation state, loading, caching, route matching, and preprocessing — but
**not** message interpolation, which a pluggable parser provides. Three repos:

- **`base`** (here) — core, parser-agnostic, zero runtime deps.
- **`lib`** (`sveltekit-i18n`) — `base` pre-wired with `parser-default`.
- **`parsers`** — `parser-default`, `parser-icu`.

## Tech stack (ground truth — do not assume otherwise)

| Aspect | Reality |
|--------|---------|
| Language | TypeScript, ESM (`"type": "module"`), `strict: true` |
| Package manager | **npm** with `package-lock.json` (no pnpm/yarn) |
| Build | `tsup` → `dist/` (CJS + ESM + `.d.ts`) |
| Tests | Jest + `ts-jest` ESM preset, `testEnvironment: node` |
| Lint | ESLint `airbnb-typescript/base` |
| Runtime peer | `svelte >=3.49.0` (uses `svelte/store` only) |
| CI | `.github/workflows/tests.yml` — Node 18, ubuntu/macOS/windows |

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` / `npm ci` | install (respects `package-lock.json`) |
| `npm run build` | tsup build to `dist/` |
| `npm test` | jest suite |
| `npm run lint` | eslint `--fix` over `.ts`/`.js` (also a pre-commit hook) |

## Repository map

| Path | Role |
|------|------|
| `src/index.ts` | `class I18n` — public stores & methods, orchestration |
| `src/utils.ts` | pure helpers (`translate`, `sanitizeLocales`, `toDotNotation`, `serialize`, `fetchTranslations`, `testRoute`, `checkProps`) |
| `src/logger.ts` | `loggerFactory` + module-level `logger` singleton + `setLogger` |
| `src/types.ts` | all public/internal types |
| `tests/specs/index.spec.ts` | the suite (one `describe`) |
| `tests/data/` | `CONFIG` + JSON fixtures + `getTranslations()` |
| `docs/README.md` | public API reference — keep in sync with code |
| `dist/` | generated build output — never hand-edit |

## Architecture you must respect

- **Store-centric.** The public surface is Svelte stores (`t`, `l`, `locale`,
  `locales`, `loading`, `initialized`, `translations`, `rawTranslations`) plus
  methods (`loadTranslations`, `loadConfig`, `setLocale`, `setRoute`,
  `addTranslations`, `getTranslationProps`). Each store is an `ExtendedStore` —
  a Svelte store **plus** a synchronous `.get()`, so it works both in `.svelte`
  (`$store`) and plain `.ts`/`.js` (`store.get()`). Preserve this dual shape on
  anything public.
- **Loaders are lazy and run once.** A loader fires only when its `locale`
  matches and its `routes` match the current route (or it has no `routes`).
  `loadedKeys` prevents refetching; the server-side `cache` window (default 24h)
  controls refresh. Don't break load-once semantics.
- **Parser is injected, never imported.** `translate()` calls
  `config.parser.parse(value, params, locale, key)`.
- **Preprocessing.** `addTranslations` applies `preprocess` (`'full'` default |
  `'preserveArrays'` | `'none'` | custom fn) via `toDotNotation`.
  `rawTranslations` is pre-preprocess; `translations` is post-preprocess. Keep
  both consistent.

## Invariants — do NOT break these without explicit user sign-off

1. **Zero runtime dependencies.** `dependencies` stays empty; `svelte` is a
   peer dep. Adding a runtime dep is a blocking change — stop and ask.
2. **No breaking changes** to public store/method shapes or `types.ts` exports.
   Consumers read `$translations['en']['key']`, etc.
3. **Parser-agnostic.** No imports from `@sveltekit-i18n/parser-*`.
4. **ESM-only, npm-only, Node 18-compatible.**
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
- **Branch from `master`, not from whatever HEAD happens to be:**
  `git fetch origin && git switch master && git pull --ff-only`, then create the
  branch. Use a descriptive prefix: `fix/<slug>`, `feat/<slug>`,
  `chore/<slug>`, `docs/<slug>`.
- Rebase on `master` before pushing a feature branch; on conflicts, **stop and
  ask** — resolution is judgment, not automation. Never merge `master` into a
  feature branch.

## 8. PRs

- **Open a PR only when explicitly asked.** Keep it narrowly scoped; list
  out-of-scope follow-ups under `## Notes` rather than expanding silently.
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

- Match airbnb-typescript: 2-space indent, single quotes, semicolons, trailing
  commas, no trailing whitespace, no multiple blank lines. Let `npm run lint
  --fix` handle it.
- Prefer the existing **functional, immutable** style in `utils.ts`
  (computed-key spread `{ ...acc, [k]: v }`, `reduce`, no mutation). That spread
  form has `DefineProperty` semantics — it can't pollute `Object.prototype`.
  Keep it that way.
- Keep `index.ts` for orchestration; put pure, testable logic in `utils.ts`.
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
- **Fail soft at the edges.** A single throwing loader must not wipe a whole
  batch; a missing config/parser must not throw on `t.get()`/`l.get()`.
- **`route` reaches `RegExp.test()` and is visitor-controlled** (`url.pathname`)
  — dev-supplied route regexes are a ReDoS surface. Don't add regex handling
  that worsens it; flag it if touched.

## 12. Comments & language

- Default to **no** comment; code says *what*, comments say *why* (a hidden
  constraint, an invariant, a non-obvious workaround). Never reference the
  current task, a fixed bug, or a PR number — that rots.
- A name that needs a comment to explain it is the wrong name — fix the name.
- **All committed/published artifacts in English** — code comments, commit
  messages, PR titles/bodies, doc files. Chat may stay in the user's preferred
  language; the moment it crosses into something on GitHub, switch to English.

## 13. Tests

- Tests live in `tests/specs/index.spec.ts`; fixtures in `tests/data/`.
- Drive behavior through the **public API** (`new i18n(CONFIG)`, stores,
  methods). Pure helpers may be imported directly from `src/` when that yields a
  more deterministic test (e.g. unit-testing `loggerFactory`).
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
