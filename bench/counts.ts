import { I18n, type Translations } from '@sveltekit-i18n/base';
import { expect, it } from 'vitest';

import { effect, effectsRun, flushSync } from '../tests/utils/effect.svelte.js';

import { collect } from './collect.js';
import { key, loaders, log, n, table } from './data.js';

const record = collect(import.meta.filename);

const KEYS = 10_000;

/** The string leaves of `input`, however deep. */
const leaves = (input: unknown): number => (typeof input === 'string' ? 1 : Object.values(input ?? {}).reduce<number>((sum, value) => sum + leaves(value), 0));

/** A parser that counts its calls. */
const counting = () => {
  const counter = { calls: 0, parser: { parse: (value: unknown) => { counter.calls++; return value; } } };

  return counter;
};

it('the keys a delivery preprocesses again', async () => {
  for (const count of [1, 10, 50]) {
    let preprocessed = 0;
    const preprocess = (input: Translations.Input) => {
      preprocessed += leaves(input);
      return input;
    };
    const shared = Array.from({ length: count }, (_, n) => ({
      locale: 'en',
      namespace: 'shared',
      loader: async () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${n}_${i}`, 'v'])),
    }));
    const i18n = new I18n({ parser: counting().parser, log, preprocess, loaders: [...loaders(table(KEYS, 'single')), ...shared] });

    await i18n.loadTranslations('en', '/');
    i18n.invalidate('en', 'shared');
    preprocessed = 0;
    await i18n.loadTranslations('en', '/');

    record(`keys preprocessed, a namespace filled by ${count} loader${count === 1 ? '' : 's'} delivered again (beside ${n(KEYS)} keys)`, 'count', 'keys', preprocessed);
  }
});

it('loader calls', async () => {
  let calls = 0;
  const data = table(2_000, 'namespaces');
  const counted = Object.keys(data).map((namespace) => ({ locale: 'en', namespace, loader: async () => { calls++; return data[namespace]; } }));
  const i18n = new I18n({ parser: counting().parser, log, loaders: counted });

  await Promise.all(Array.from({ length: 10 }, () => i18n.loadTranslations('en')));
  record('loader calls, 10 concurrent loads of 100 namespaces', 'count', 'calls', calls);

  calls = 0;
  await i18n.loadTranslations('en');
  record('loader calls, loading 100 loaded namespaces again', 'count', 'calls', calls);
});

it('effect runs', async () => {
  if (!effectsRun) throw new Error('The effect rows need the client compile.');

  const counter = counting();
  const data = table(KEYS, 'namespaces');
  const i18n = new I18n({ parser: counter.parser, log, loaders: [...loaders(data, ['en', 'cs']), { locale: 'en', namespace: 'extra', routes: ['/extra'], loader: async () => ({ key: 'v' }) }] });
  const keys = Array.from({ length: 500 }, (_, i) => key(i * 20, KEYS, 'namespaces'));
  let runs = 0;

  await i18n.loadTranslations('en', '/', { activate: false });
  await i18n.loadTranslations('cs', '/');

  const stop = effect(() => {
    runs++;
    keys.forEach((k) => i18n.t(k));
  });

  expect([runs, counter.calls]).toEqual([1, keys.length]);

  const measure = async (id: string, act: () => Promise<unknown>) => {
    runs = 0;
    counter.calls = 0;
    await act();
    flushSync();
    record(`effect runs, ${id}`, 'count', 'runs', runs);
    record(`parser calls, ${id}`, 'count', 'calls', counter.calls);
  };

  await measure('an effect of 500 t calls, on setLocale to a loaded locale', () => i18n.setLocale('en'));
  await measure('an effect of 500 t calls, on a namespace landing', () => i18n.loadNamespace('extra'));
  await measure('an effect of 500 t calls, on another locale landing', () => {
    i18n.invalidate('cs');
    return i18n.loadTranslations('cs', '/', { activate: false });
  });

  stop();
});
