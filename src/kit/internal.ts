import type { I18n } from '../I18n.svelte.js';
import type { Kit } from './types.js';

/** The negotiated locale, and whether `preferredLocale` gave it. */
export type Negotiated = { locale: string | undefined; preferred: boolean };

/** What the server half needs from the factory. */
export type Shared = {
  create: () => I18n;
  negotiate: (event: Kit.Event, ranges: string | readonly string[] | null | undefined) => Negotiated;
  /** The locales the config serves. */
  locales: () => string[];
  basePath: string | undefined;
  /**
   * Whether the universal branch of a page render may take over the instance
   * the server branch loaded: not while a loader has `cache: false`, which only
   * a hand-off holds back for the rest of the render.
   */
  handOver: () => boolean;
};

export type ServerHalf = {
  handle: Kit.T['handle'];
  load: (event: Kit.ServerLoadEvent) => Promise<{ i18n: Kit.Payload }>;
  /** The instance a page render loaded for `payload`, handed out once. */
  take: (payload: Kit.Payload | undefined) => I18n | undefined;
};
