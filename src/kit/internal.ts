import type { I18n } from '../I18n.svelte.js';
import type { Kit } from './types.js';

/** What the server half needs from the factory. */
export type Shared = {
  create: () => I18n;
  negotiate: (event: Kit.Event, ranges: string | readonly string[] | null | undefined) => string | undefined;
  /** The locales the config serves. */
  locales: () => string[];
  basePath: string | undefined;
};

export type ServerHalf = {
  handle: Kit.T['handle'];
  load: (event: Kit.ServerLoadEvent) => Promise<{ i18n: Kit.Payload }>;
};
