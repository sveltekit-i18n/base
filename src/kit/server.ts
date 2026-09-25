import { withoutBasePath } from '../utils.js';
import type { ServerHalf, Shared } from './internal.js';
import type { Kit } from './types.js';

export const serverHalf = ({ create, negotiate, basePath }: Shared): ServerHalf => {
  const answer = (event: Kit.RequestEvent): string | undefined => negotiate(event, event.request.headers.get('accept-language'));

  return {
    handle: ({ event, resolve }) => {
      let lang: string | undefined;

      // Negotiated only for a chunk that asks for it, so a data request never
      // negotiates here; a function replacement is inserted as it is.
      return Promise.resolve(resolve(event, {
        transformPageChunk: ({ html }) => html.replace('%lang%', () => (lang ??= answer(event) ?? '')),
      }));
    },

    load: async (event) => {
      // Read before anything returns: SvelteKit re-runs a load on a
      // navigation only for what it read.
      const route = event.url.pathname;
      const locale = answer(event);

      if (event.isDataRequest) return { i18n: { locale, route: withoutBasePath(route, basePath) } };

      const i18n = create();

      await (locale ? i18n.loadTranslations(locale, route) : i18n.setRoute(route));

      return { i18n: i18n.snapshot({ records: true }) };
    },
  };
};
