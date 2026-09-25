import { logger } from '../logger.js';
import { matchLocale, routePrefix, withoutBasePath } from '../utils.js';
import type { ServerHalf, Shared } from './internal.js';
import type { Kit } from './types.js';

export const serverHalf = ({ create, negotiate, locales, basePath }: Shared): ServerHalf => {
  const answer = (event: Kit.RequestEvent): string | undefined => negotiate(event, event.request.headers.get('accept-language'));

  let warned = false;

  // A base path SvelteKit strips and `basePath` does not keeps every
  // route-scoped loader from matching, silently. Here, on the server only, so
  // the matcher stays out of the browser bundle.
  const check = (event: Kit.Event): void => {
    if (warned) return;

    const available = locales();
    const found = routePrefix(event.url.pathname, event.route.id);

    if (!found) return;

    const segments = found.split('/');
    const last = segments[segments.length - 1].toLowerCase();

    // A locale segment in front of the route is a `reroute` that strips it,
    // spelled in the URL as a language (`en`) or a region (`en-gb`) of one.
    const isLocale = matchLocale(last, available) !== undefined;
    const prefix = isLocale ? segments.slice(0, -1).join('/') : found;

    if (!prefix || withoutBasePath(prefix, basePath) === '/') return;

    warned = true;
    logger.warn(`'${prefix}' precedes the route SvelteKit matched. If it is kit.paths.base, set basePath: '${prefix}'.`);
  };

  return {
    handle: ({ event, resolve }) => {
      let lang: string | undefined;

      // Negotiated only for a chunk that asks for it, so a data request never
      // negotiates here; a function replacement is inserted as it is.
      return Promise.resolve(resolve(event, {
        transformPageChunk: ({ html }) => html.replace('%lang%', () => {
          if (lang === undefined) {
            check(event);
            lang = answer(event) ?? '';
          }

          return lang;
        }),
      }));
    },

    load: async (event) => {
      // Read before anything returns: SvelteKit re-runs a load on a
      // navigation only for what it read.
      const route = event.url.pathname;

      check(event);

      const locale = answer(event);

      if (event.isDataRequest) return { i18n: { locale, route: withoutBasePath(route, basePath) } };

      const i18n = create();

      await (locale ? i18n.loadTranslations(locale, route) : i18n.setRoute(route));

      return { i18n: i18n.snapshot({ records: true }) };
    },
  };
};
