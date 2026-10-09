import type { I18n } from '../I18n.svelte.js';
import type { Kit } from './types.js';

/** The params of an event the wiring reads: SvelteKit 3 hands a param its matcher parsed as it parsed it. */
export type Params = Partial<Record<string, Kit.ParamValue>>;

/** The negotiated locale, and whether `preferredLocale` gave it. */
export type Negotiated = { locale: string | undefined; preferred: boolean };

/** What the server half needs from the factory. */
export type Shared = {
  create: () => I18n;
  negotiate: (event: Kit.Event<Params>, ranges: string | readonly string[] | null | undefined) => Negotiated;
  /** The locales the config serves. */
  locales: () => string[];
  basePath: string | undefined;
  /** The canonical pathname of a translated one, `basePath` kept. */
  canonical: (pathname: string) => string;
  /**
   * Whether the universal branch of a page render may take over the instance
   * the server branch loaded: not while a loader has `cache: false`, which only
   * a hand-off holds back for the rest of the render.
   */
  handOver: () => boolean;
};

export type ServerHalf = {
  handle: Kit.T['handle'];
  load: (event: Kit.ServerLoadEvent<Params>) => Promise<{ i18n: Kit.Payload }>;
  /** The instance a page render loaded for `payload`, handed out once. */
  take: (payload: Kit.Payload | undefined) => I18n | undefined;
};

/**
 * The key a `translatePathnames()` value holds its binding under:
 * registry-wide, so two copies of the package meet, and versioned, so a
 * binding of another shape is no binding. Bump it whenever `Setup` or
 * `Translation` changes.
 */
export const TRANSLATION = Symbol.for('@sveltekit-i18n/base/kit/translation@1');

/** A canonical pathname, the base path kept, and the locale its localized pattern pins. */
export type Canonical = { pathname: string; locale?: string };

/** What `defineI18n()` hands the binding of `options.pathnames`. */
export type Setup = {
  basePath: string | undefined;
  /** The config's sanitizer, which the table's locales go through. */
  sanitize: (locale: string) => string;
  /** A locale the app hands `localizePath` that the table does not name as it is spelled, sanitized silently. */
  normalize: (locale: string) => string;
  /** The locales the config serves. */
  served: () => string[];
  /** Reports what is wrong with the table, through the config's logger. */
  warn: (message: string) => void;
};

/** The translated pathnames one `defineI18n()` wires: the canonical pathname of a URL's, and `localizePath`. */
export type Translation = {
  canonical: (pathname: string) => Canonical;
  localizePath: Kit.T['localizePath'];
};
