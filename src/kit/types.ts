import type { I18n } from '../I18n.svelte.js';
import type { Snapshot } from '../types.js';

export namespace Kit {
  /**
   * The members of a SvelteKit load or request event the wiring reads.
   * SvelteKit's own event types are assignable to it. The server-only members
   * are optional, since an app without a server load hands the universal one,
   * which has none.
   */
  export type Event = {
    url: URL;
    params: Partial<Record<string, string>>;
    route: { id: string | null };
    cookies?: { get: (name: string) => string | undefined };
    request?: Request;
    locals?: Record<string, any>;
  };

  export type RequestEvent = Event & Required<Pick<Event, 'cookies' | 'request'>>;

  export type ServerLoadEvent = RequestEvent & { isDataRequest: boolean };

  export type UniversalLoadEvent = Event & { data: Record<string, any> | null };

  export type Resolve = (
    event: any,
    options?: { transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined },
  ) => Response | Promise<Response>;

  /**
   * What the server branch of `load` returns under `i18n`: the negotiated
   * locale and the route always, the tables and their records on a page
   * render only. Plain data, for `devalue`.
   */
  export type Payload = Omit<Snapshot.Envelope, 'translations'> & Partial<Pick<Snapshot.Envelope, 'translations'>>;

  export type Options = {
    /**
     * The visitor's choice, read from the event: a cookie, a route param, a
     * profile in `locals`. It is tried before `Accept-Language` (without a
     * server load, before `navigator.languages`), and a value no configured
     * locale matches is skipped. It runs on every navigation and every
     * preload, so it must be pure: it reads the event and writes nothing.
     *
     * @example
     * preferredLocale: (event) => event.cookies?.get('lang')
     */
    preferredLocale?: (event: Event) => string | null | undefined;
  };

  /** What `defineI18n()` returns. Each member is a plain function, so it can be exported on its own. */
  export type T<Instance = I18n> = {
    /** A `handle` hook: fills `%lang%` in `app.html` with the negotiated locale, and `%dir%` with its direction. */
    handle: (input: { event: RequestEvent; resolve: Resolve }) => Promise<Response>;
    /** The root layout's `load`, exported from `+layout.server.js` and `+layout.js` alike. */
    load: {
      (event: ServerLoadEvent): Promise<{ i18n: Payload }>;
      // A call keeps the server's data, which the universal branch returns.
      <E extends UniversalLoadEvent>(event: E): Promise<Omit<NonNullable<E['data']>, 'i18n'> & { i18n: Instance }>;
      // Last: SvelteKit types the layout's data from the last signature.
      // Without an index signature: SvelteKit types a child's data through
      // `Omit`, which would turn every member of one into `any`.
      (event: UniversalLoadEvent): Promise<{ i18n: Instance }>;
    };
    /**
     * Called once, in the root layout's script, with a getter of its `data`.
     * Provides the instance to every component below, and follows each
     * navigation as it commits. Returns the instance.
     */
    use: (data: () => object | null | undefined) => Instance;
    /** The instance `use()` provided, in any component below the root layout. */
    get: () => Instance;
  };
}
