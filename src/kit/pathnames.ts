import { TRANSLATION, type Canonical, type Setup, type Translation } from './internal.js';
import type { Kit } from './types.js';

/** A segment of a pattern: a static one, decoded to compare and encoded to write, or a param. */
type Segment = { decoded: string; encoded: string } | { param: string };

/** A pattern of the table: its segments and its trailing rest param. */
type Pattern = { segments: Segment[]; rest?: string };

/** A pattern as the compile compares it: its shape, which a param's name leaves out, and its params, sorted and in order. */
type Parsed = { pattern: Pattern; shape: string; names: string; order: string };

/** An entry of the table: its canonical pattern, and the localized one of each locale, by its lowercased name. */
type Entry = { key: string; canonical: Pattern; targets: Map<string, Pattern> };

/** A localized pattern: the entry it maps to, as the table spells it, and the locales that spell it. */
type Claim = { entry: Entry; pattern: Pattern; locales: string[] };

/** A node of a trie: its static children by decoded segment, its param child, and what ends or rests on it. */
type Node<T> = { statics?: Map<string, Node<T>>; param?: Node<T>; rest?: T; end?: T };

type Found<T> = { value: T; params: string[]; rest: string };

/** A pathname, split into its segments, and whether it ends in a slash. */
type Split = { segments: string[]; trailing: boolean };

const PARAM = /^\[(\.\.\.)?(\w+)\]$/;

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

// What a pathname holds raw: the unreserved characters, the sub-delimiters,
// `:` and `@`. A static segment is decoded, so its `%` is a character; a path
// the app hands `localizePath` keeps its escapes and its slashes.
// A lone surrogate has no encoding, so a segment holding one is no pattern.
const encodeStatic = (decoded: string): string | undefined => {
  try {
    return decoded.replace(/[^\w\-.~!$&'()*+,;=:@]/gu, encodeURIComponent);
  } catch {
    return undefined;
  }
};
const encodePath = (path: string): string => path.replace(/[^\w\-.~!$&'()*+,;=:@%/]/gu, encodeURIComponent);

/** `pathname` split into segments, or `undefined` when it holds an empty one: no pattern matches it. */
const split = (pathname: string): Split | undefined => {
  if (pathname === '/') return { segments: [], trailing: false };

  if (!pathname.startsWith('/')) return undefined;

  const segments = pathname.slice(1).split('/');
  const trailing = segments.length > 1 && segments[segments.length - 1] === '';

  if (trailing) segments.pop();

  return segments.includes('') ? undefined : { segments, trailing };
};

const parse = (input: unknown): Parsed | undefined => {
  if (typeof input !== 'string') return undefined;

  const parts = input.includes('?') || input.includes('#') ? undefined : split(input);

  if (!parts) return undefined;

  const { segments: raw } = parts;
  const segments: Segment[] = [];
  const names: string[] = [];
  let rest: string | undefined;

  for (const [index, part] of raw.entries()) {
    const param = PARAM.exec(part);

    if (param) {
      const [, spread, name] = param;

      if (names.includes(name) || (spread && index < raw.length - 1)) return undefined;

      names.push(name);

      if (spread) rest = name;
      else segments.push({ param: name });
    } else {
      const decoded = decodeSegment(part);
      const encoded = encodeStatic(decoded);

      if (encoded === undefined || part.includes('[') || part.includes(']') || decoded === '.' || decoded === '..') return undefined;

      segments.push({ decoded, encoded });
    }
  }

  const shape = JSON.stringify([...segments.map((segment) => ('param' in segment ? 0 : segment.decoded)), rest === undefined ? 1 : 2]);

  return { pattern: { segments, rest }, shape, names: JSON.stringify([[...names].sort(), rest]), order: JSON.stringify(names) };
};

const insert = <T>(root: Node<T>, { segments, rest }: Pattern): { node: Node<T>; slot: 'end' | 'rest' } => {
  const node = segments.reduce<Node<T>>((at, segment) => {
    if ('param' in segment) return (at.param ??= {});

    const statics = (at.statics ??= new Map());
    const next = statics.get(segment.decoded) ?? {};

    statics.set(segment.decoded, next);

    return next;
  }, root);

  return { node, slot: rest === undefined ? 'end' : 'rest' };
};

/**
 * The most specific match of the trie `accept` takes for `segments`, as
 * SvelteKit ranks its routes: a static segment before a param, a param before
 * a rest, the leftmost segment first. A node sits at the depth of its segment,
 * so a walk visits each node once at most.
 */
const walk = <T>(root: Node<T>, segments: readonly string[], accept: (found: Found<T>) => boolean): Found<T> | undefined => {
  const decoded: string[] = [];
  const params: string[] = [];

  const accepted = (value: T | undefined, rest: string): Found<T> | undefined => {
    const found = value === undefined ? undefined : { value, params: [...params], rest };

    return found && accept(found) ? found : undefined;
  };

  const visit = (node: Node<T>, at: number): Found<T> | undefined => {
    const end = at === segments.length ? accepted(node.end, '') : undefined;

    if (end) return end;

    if (at < segments.length) {
      const child = node.statics && node.statics.get(decoded[at] ??= decodeSegment(segments[at]));
      const found = child && visit(child, at + 1);

      if (found) return found;

      if (node.param) {
        params.push(segments[at]);

        const deeper = visit(node.param, at + 1);

        params.pop();

        if (deeper) return deeper;
      }
    }

    return node.rest === undefined ? undefined : accepted(node.rest, segments.slice(at).join('/'));
  };

  return visit(root, 0);
};

/** The values a match captured, by the names of the pattern it matched. */
const captured = ({ segments, rest }: Pattern, found: Found<unknown>): Map<string, string> => {
  const values = new Map<string, string>();

  segments.filter((segment) => 'param' in segment).forEach(({ param }, index) => values.set(param, found.params[index]));

  if (rest !== undefined) values.set(rest, found.rest);

  return values;
};

/** `pattern` filled with `values`, an empty rest left out as SvelteKit's `resolve` does. */
const fill = ({ segments, rest }: Pattern, values: Map<string, string>, trailing: boolean): string => {
  const parts = segments.map((segment) => ('param' in segment ? values.get(segment.param) ?? '' : segment.encoded));
  const tail = rest === undefined ? '' : values.get(rest) ?? '';
  const path = `/${(tail ? [...parts, tail] : parts).join('/')}`;

  return trailing && path !== '/' ? `${path}/` : path;
};

// `String()` of an object runs its own conversion, which can throw.
const quoted = (value: unknown): string => `'${value !== null && (typeof value === 'object' || typeof value === 'function') ? Object.prototype.toString.call(value) : String(value)}'`;

const compile = (table: unknown, { sanitize, served, warn }: Pick<Setup, 'sanitize' | 'served' | 'warn'>) => {
  // Each lookup keys the trie with a lowercased locale, so `en-us` meets `en-US`.
  const localized: Node<Claim> = {};
  const canonical: Node<Entry> = {};
  const locales = new Set<string>();
  const unserved = new Set<string>();
  // What only the compile reads stays out of the tries, which live as long as the wiring.
  const claims = new Map<string, { claim: Claim; spelled: string; order: string }>();
  const available = new Set(served().map((locale) => locale.toLowerCase()));
  const entries: { entry: Entry; shape: string }[] = [];

  if (!table || typeof table !== 'object') warn('is not an object. No pathname is translated');

  for (const [key, spelled] of table && typeof table === 'object' ? Object.entries(table) : []) {
    const parsed = parse(key);

    if (!parsed || !spelled || typeof spelled !== 'object') {
      warn(`skips ${quoted(key)}: ${parsed ? 'its locales are not an object' : 'it is no pathname pattern'}`);
      continue;
    }

    const at = insert(canonical, parsed.pattern);

    if (at.node[at.slot]) {
      warn(`skips ${quoted(key)}: ${quoted(at.node[at.slot]!.key)} names the same pathnames`);
      continue;
    }

    const entry: Entry = { key, canonical: parsed.pattern, targets: new Map() };

    at.node[at.slot] = entry;
    entries.push({ entry, shape: parsed.shape });

    for (const [locale, value] of Object.entries(spelled as Record<string, unknown>)) {
      const target = parse(value);
      const name = sanitize(locale);
      const lowered = name.toLowerCase();

      if (!target || target.names !== parsed.names) {
        warn(`skips ${quoted(key)} in ${quoted(locale)}: ${quoted(value)} ${target ? 'names other params' : 'is no pathname pattern'}`);
        continue;
      }

      const claimed = claims.get(target.shape);

      if (claimed && claimed.claim.entry !== entry) {
        warn(`skips ${quoted(key)} in ${quoted(locale)}: ${quoted(claimed.claim.entry.key)} translates to ${quoted(value)} too`);
        continue;
      }

      if (claimed && claimed.order !== target.order) {
        warn(`skips ${quoted(key)} in ${quoted(locale)}: ${quoted(value)} names the params of ${quoted(claimed.spelled)} in another order`);
        continue;
      }

      if (claimed) {
        claimed.claim.locales.push(name);
      } else {
        const slot = insert(localized, target.pattern);
        const claim: Claim = { entry, pattern: target.pattern, locales: [name] };

        slot.node[slot.slot] = claim;
        claims.set(target.shape, { claim, spelled: value as string, order: target.order });
      }

      entry.targets.set(lowered, target.pattern);
      locales.add(lowered);

      if (!available.has(lowered)) unserved.add(name);
    }
  }

  // A localized pattern that is another entry's canonical one takes that
  // entry's own pathnames, unless that entry translates to them itself.
  for (const { entry, shape } of entries) {
    const claim = claims.get(shape)?.claim;

    if (claim && claim.entry !== entry) warn(`serves ${quoted(claim.entry.key)} at ${quoted(entry.key)}, which is a pathname of its own`);
  }

  if (unserved.size) warn(`translates to ${[...unserved].map(quoted).join(', ')}, which the config serves no translations for`);

  return { localized, canonical, locales };
};

const translation = (table: unknown, { basePath, sanitize, normalize, served, warn }: Setup): Translation => {
  let compiled: ReturnType<typeof compile> | undefined;

  // Compiled once even when the table throws as it is read, so no call pays
  // for a compile again.
  const tries = (): ReturnType<typeof compile> => {
    if (!compiled) {
      try {
        compiled = compile(table, { sanitize, served, warn });
      } catch {
        warn('cannot be read. No pathname is translated');
        compiled = { localized: {}, canonical: {}, locales: new Set() };
      }
    }

    return compiled;
  };
  let last: { pathname: string; result: Canonical } | undefined;

  const trimmed = typeof basePath === 'string' ? basePath.replace(/\/+$/, '') : '';

  const delocalized = (path: string): { path: string; locale?: string } | undefined => {
    const parts = split(path);

    if (!parts) return undefined;

    const found = walk(tries().localized, parts.segments, () => true);

    if (!found) return undefined;

    const { entry, pattern, locales } = found.value;
    const result = fill(entry.canonical, captured(pattern, found), parts.trailing);

    return locales.length === 1 ? { path: result, locale: locales[0] } : { path: result };
  };

  return {
    canonical: (pathname) => {
      if (typeof pathname !== 'string') return { pathname };

      if (last?.pathname === pathname) return last.result;

      let result: Canonical = { pathname };

      try {
        const local = !trimmed ? pathname : pathname === trimmed ? '/' : pathname.startsWith(`${trimmed}/`) ? pathname.slice(trimmed.length) : undefined;
        const found = local === undefined ? undefined : delocalized(local);

        // The root under the base path is itself with or without its slash.
        if (found) result = { pathname: local === '/' && found.path === '/' ? pathname : `${trimmed}${found.path}`, ...(found.locale === undefined ? {} : { locale: found.locale }) };
      } catch { /* passed through */ }

      last = { pathname, result };

      return result;
    },

    localizePath: (path, locale) => {
      if (typeof path !== 'string' || typeof locale !== 'string') return path;

      try {
        const { canonical: root, locales } = tries();

        // A locale the table names is taken in any case; only another
        // spelling of one goes through the sanitizer.
        const named = locale.toLowerCase();
        const wanted = locales.has(named) ? named : normalize(locale).toLowerCase();

        if (!locales.has(wanted)) return path;

        const end = path.search(/[?#]/);
        const pathname = encodePath(end < 0 ? path : path.slice(0, end));
        const suffix = end < 0 ? '' : path.slice(end);
        const parts = split(pathname);

        if (!parts) return path;

        const from = delocalized(pathname)?.path ?? pathname;
        const source = split(from) ?? parts;
        let localized: string | undefined;

        // A more specific pattern can take the path a match fills for
        // another page, so a match is taken only where it leads back.
        const leadsBack = (found: Found<Entry>): boolean => {
          const target = found.value.targets.get(wanted);

          if (!target) return false;

          const values = captured(found.value.canonical, found);

          localized = fill(target, values, parts.trailing);

          // The root keeps no trailing slash, so neither does the way back from it.
          return delocalized(localized)?.path === fill(found.value.canonical, values, parts.trailing && localized !== '/');
        };

        return walk(root, source.segments, leadsBack) ? `${localized}${suffix}` : `${from}${suffix}`;
      } catch {
        return path;
      }
    },
  };
};

/**
 * The translated pathnames of `table`, for `defineI18n()`'s `pathnames`: per
 * canonical pathname, the pathname each locale serves it at. Both are
 * written without `basePath`, in SvelteKit's route syntax limited to static
 * segments, `[param]` and a trailing `[...rest]`; every pattern of an entry
 * names the same params. A localized pattern is the whole pathname, so it
 * carries the locale's prefix when it has one. A pathname matches its most
 * specific pattern, as SvelteKit ranks its routes, whatever the table's
 * order, and a locale an entry leaves out falls through to the next pattern
 * that matches. A pathname the table does not name passes through unchanged.
 *
 * The table is read when `defineI18n()`'s wiring first needs it, and
 * compiled then, once per `defineI18n()`. A pathname is visitor input: no
 * function of the wiring throws on one, `reroute` and `delocalize` run no
 * regex on it and walk one trie, and `localizePath` only regexes of one
 * character class, which are linear, and walks the localized trie once more
 * per match it tries.
 *
 * @example
 * defineI18n(config, {
 *   pathnames: translatePathnames({
 *     '/about': { de: '/de/ueber-uns', cs: '/cs/o-nas' },
 *     '/products/[id]': { de: '/de/produkte/[id]', cs: '/cs/produkty/[id]' },
 *     '/[...rest]': { en: '/[...rest]', de: '/de/[...rest]', cs: '/cs/[...rest]' },
 *   }),
 * });
 */
export const translatePathnames = (table: Record<string, Partial<Record<string, string>>>): Kit.Pathnames => Object.freeze({ [TRANSLATION]: (setup: Setup) => translation(table, setup) }) as unknown as Kit.Pathnames;
