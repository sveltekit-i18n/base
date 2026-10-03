import type { Loader, Translations } from '@sveltekit-i18n/base';

/**
 * How a set of keys is laid out:
 * - `flat`: every key at the top, one namespace each.
 * - `namespaces`: namespaces of 20 keys.
 * - `single`: one namespace holding them all.
 * - `nested`: one namespace, each key a path of one segment per digit of its
 *   index (`n.1.2.k3`), so 10,000 keys nest four levels deep.
 */
export type Shape = 'flat' | 'namespaces' | 'single' | 'nested';

export const SHAPES: readonly Shape[] = ['flat', 'namespaces', 'single', 'nested'];

/** Returns the loaded value, so a call costs the core's lookup and nothing more. */
export const parser = { parse: (value: unknown) => value };

export const log = { level: 'error' } as const;

/** A number as a row's name spells it. */
export const n = (value: number) => value.toLocaleString('en-US');

/** `keys` leaves laid out by `shape`, each value naming its key. */
export const table = (keys: number, shape: Shape): Translations.Input => {
  const leaves = Array.from({ length: keys }, (_, i) => i);

  if (shape === 'flat') return Object.fromEntries(leaves.map((i) => [`k${i}`, `v${i}`]));

  if (shape === 'namespaces') {
    return Object.fromEntries(Array.from({ length: Math.ceil(keys / 20) }, (_, n) => [
      `ns${n}`,
      Object.fromEntries(leaves.slice(n * 20, n * 20 + 20).map((i) => [`k${i}`, `v${i}`])),
    ]));
  }

  if (shape === 'single') return { ns0: Object.fromEntries(leaves.map((i) => [`k${i}`, `v${i}`])) };

  const digits = `${keys - 1}`.length;

  // Built level by level rather than spread per key, which would be quadratic.
  const tree: Record<string, any> = Object.create(null);

  for (const i of leaves) {
    const path = `${i}`.padStart(digits, '0').split('');
    const last = path.pop() as string;
    let node = tree;

    for (const segment of path) node = node[`d${segment}`] ??= Object.create(null);

    node[`k${last}`] = `v${i}`;
  }

  return { n: JSON.parse(JSON.stringify(tree)) };
};

/** A key of `table(keys, shape)`, as `t` reads it. */
export const key = (index: number, keys: number, shape: Shape): string => {
  if (shape === 'flat') return `k${index}`;

  if (shape === 'namespaces') return `ns${Math.floor(index / 20)}.k${index}`;

  if (shape === 'single') return `ns0.k${index}`;

  const path = `${index}`.padStart(`${keys - 1}`.length, '0').split('');
  const last = path.pop() as string;

  return ['n', ...path.map((segment) => `d${segment}`), `k${last}`].join('.');
};

/** One loader per top-level namespace of `data`, in each of `locales`. */
export const loaders = (data: Translations.Input, locales: readonly string[] = ['en']): Loader.LoaderModule[] => locales.flatMap((locale) => Object.keys(data).map((namespace) => ({
  locale,
  namespace,
  loader: async () => data[namespace],
})));
