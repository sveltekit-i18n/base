import { getContext, setContext, untrack } from 'svelte';

import { BROWSER } from '#kit-env';
import { serverHalf } from '#kit-server';

import { I18n } from '../I18n.svelte.js';
import { logError, loggerFactory, setLogger } from '../logger.js';
import type { Config } from '../types.js';
import { configLocales, matchLocale, textDirection } from '../utils.js';
import type { Kit } from './types.js';

// Registry-wide, so two copies of this package meet: the context key, and the
// key of the pass the universal branch hands `use()` in `data`.
const KEY = Symbol.for('@sveltekit-i18n/base/kit');

/**
 * What one run of the universal branch saw: the instance, what its extensions
 * made of it, the server's answer, the route, and the locale active as it
 * started.
 */
type Pass = { i18n: I18n; surface: unknown; locale: string | undefined; route: string; seen: string | undefined };

const passOf = (data: unknown): Pass | undefined => (data as Record<PropertyKey, Pass | undefined> | null | undefined)?.[KEY];

const isServerEvent = (event: Kit.ServerLoadEvent | Kit.UniversalLoadEvent): event is Kit.ServerLoadEvent => 'cookies' in event;

/**
 * Wires SvelteKit to an instance of `config`: a `handle` hook, the root
 * layout's `load`, and `use()` / `get()` for components. The server builds an
 * instance per request; the browser keeps one per tab.
 */
export const defineI18n = <const C extends Config.T<any, any> = Config.T<any, any>>(
  config: C,
  options: Kit.Options = {},
): Kit.T<InstanceType<typeof I18n<C>>> => {
  // The constructor would start an `initLocale` load of its own, next to the
  // negotiated one; here `initLocale` is a negotiation candidate instead. The
  // wiring drives the core itself, whatever the extensions make of it.
  const create = (): I18n => new I18n({ ...config, initLocale: undefined, extensions: undefined }) as unknown as I18n;

  const pipe = (i18n: I18n): unknown => (config.extensions ?? []).reduce<unknown>((acc, extension) => extension(acc), i18n);

  let configured: string[] | undefined;

  // Resolved on first use, never at import, and once: resolving the loaders
  // reports what is wrong with them.
  const locales = (): string[] => {
    if (configured) return configured;

    if (config.log) setLogger(loggerFactory(config.log));

    try {
      configured = configLocales(config);
    } catch {
      // The instance reports a malformed config itself.
      configured = [];
    }

    return configured;
  };

  let reported = false;

  const preferred = (event: Kit.Event): string | null | undefined => {
    try {
      return options.preferredLocale?.(event);
    } catch (error) {
      if (!reported) logError('`preferredLocale` failed. Negotiating without it.', error);

      reported = true;

      return undefined;
    }
  };

  const negotiate = (event: Kit.Event, ranges: string | readonly string[] | null | undefined): string | undefined => {
    // First: it sets the config's logger, which `preferred` reports through.
    const available = locales();

    return [preferred(event), ranges, config.initLocale, config.fallbackLocale].reduce<string | undefined>(
      (found, candidate) => found ?? matchLocale(candidate, available),
      undefined,
    );
  };

  const server = serverHalf({ create, negotiate, locales, basePath: config.basePath });

  // Browser only: the tab's instance, the server's answer at the last commit,
  // and the locale that commit is switching to with the one it switches from,
  // which only `use()` writes. A server keeps nothing between requests.
  const tab: { i18n?: I18n; surface?: unknown; answer?: string; switching?: { from?: string; to: string }; committed: boolean } = { committed: false };

  // The locale the tab shows once the wiring's own switch lands: that switch
  // is no client change, while a locale that moved from where it started is.
  const heading = (i18n: I18n): string | undefined => {
    const active = untrack(() => i18n.locale);

    return tab.switching && tab.switching.from === active ? tab.switching.to : active;
  };

  const universalLoad = async (event: Kit.UniversalLoadEvent): Promise<Record<string, any>> => {
    const route = event.url.pathname;
    const payload = event.data?.i18n as Kit.Payload | undefined;
    const fresh = !BROWSER || !tab.i18n;
    const i18n = fresh ? create() : tab.i18n!;
    const surface = fresh ? pipe(i18n) : tab.surface;
    const seen = heading(i18n);

    // A live server sends the tables on a page render only, so a later pass
    // that carries them read a prerendered file, whose locale was negotiated
    // at build time, without the visitor. Node and Deno define
    // `navigator.languages` too, from the server's own environment.
    const answer = !fresh && payload?.translations
      ? tab.answer
      : payload ? payload.locale : negotiate(event, BROWSER ? navigator.languages : undefined);

    if (BROWSER) Object.assign(tab, { i18n, surface });

    if (fresh) {
      if (payload?.translations) i18n.hydrate({ ...payload, translations: payload.translations });

      // No preload runs before the first navigation completes, so the pass
      // that builds the instance may activate it.
      await (answer ? i18n.loadTranslations(answer, route) : i18n.setRoute(route));
    } else {
      // Warm only: this pass may be a preload, which must not change what is
      // shown. The commit switches to a changed answer, or else stays.
      const target = (answer !== tab.answer ? answer : undefined) ?? heading(i18n);

      if (target) await i18n.loadTranslations(target, route, { activate: false });
    }

    const pass: Pass = { i18n, surface, locale: answer, route, seen };

    return { ...event.data, i18n: surface, [KEY]: pass };
  };

  const load = ((event: Kit.ServerLoadEvent | Kit.UniversalLoadEvent) => (
    isServerEvent(event) ? server.load(event) : universalLoad(event)
  )) as Kit.T['load'];

  const use = (data: () => object | null | undefined): unknown => {
    const first = passOf(data());

    if (!first) throw new Error('[i18n]: `use()` found no data from `load`. Export `load` from the root `+layout.js`.');

    const { i18n, surface } = first;

    setContext(KEY, surface);

    // `data` moves only when a navigation commits; a preload leaves it. The
    // answer is compared with the last commit's, so a client `setLocale()`
    // stands until the server answers differently, and an answer given before
    // the active locale changed is stale.
    $effect.pre(() => {
      const pass = passOf(data());

      if (!pass) return;

      if (!tab.committed || (pass.locale !== tab.answer && heading(pass.i18n) === pass.seen)) {
        const { locale } = pass;
        const previous = tab.answer;

        tab.committed = true;
        tab.answer = locale;

        if (locale !== undefined) {
          const switching = { from: untrack(() => pass.i18n.locale), to: locale };
          const done = () => {
            if (tab.switching === switching) tab.switching = undefined;
          };

          tab.switching = switching;
          // A switch that failed, and that no later call landed either, leaves
          // the answer to the next commit.
          pass.i18n.loadTranslations(locale, pass.route).then(done, () => {
            done();
            if (tab.answer === locale && untrack(() => pass.i18n.locale) !== locale) tab.answer = previous;
          });

          return;
        }
      }

      void pass.i18n.setRoute(pass.route);
    });

    $effect(() => {
      const { locale } = i18n;

      if (!locale) return;

      document.documentElement.lang = locale;
      document.documentElement.dir = textDirection(locale);
    });

    return surface;
  };

  const get = (): unknown => {
    const surface = getContext<unknown>(KEY);

    if (!surface) throw new Error('[i18n]: `get()` found no instance. Call `use(() => data)` in the root `+layout.svelte`.');

    return surface;
  };

  return { handle: server.handle, load, use, get } as unknown as Kit.T<InstanceType<typeof I18n<C>>>;
};
