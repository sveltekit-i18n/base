// Runs in the `async` project only: the components it mounts are compiled with
// Svelte's `experimental.async`, which SvelteKit's remote functions switch on,
// and importing one switches async mode on for this file's module graph, so
// `fork()` works here and the rest of the suite runs without it.
import { flushSync, fork, mount, tick, unmount, untrack, type Component } from 'svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import i18n from '../../src/index.js';
import Held from '../components/Held.async.svelte';
import Pair from '../components/Pair.async.svelte';
import Probe from '../components/Probe.async.svelte';
import Readback from '../components/Readback.async.svelte';
import Search from '../components/Search.async.svelte';
import Titled from '../components/Titled.async.svelte';
import { effect } from '../utils/effect.svelte.js';
import { cell } from '../utils/state.svelte.js';

const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : String(text)) };
const log = { level: 'error' as const };

const activated = async (translations: Record<string, Record<string, string>>, locale = 'en') => {
  const instance = new i18n({ parser: valueParser, log, translations });

  await instance.setRoute('/');
  await instance.setLocale(locale);

  return instance;
};

/**
 * What an awaited expression waits on: open, it resolves at once; held, it
 * waits until `release()` opens it again.
 */
const gate = () => {
  let held = false;
  const waiting: (() => void)[] = [];

  return {
    wait: () => (held ? new Promise<void>((resolve) => { waiting.push(resolve); }) : Promise.resolve()),
    hold: () => { held = true; },
    release: () => {
      held = false;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
};

/** Mounts `component` and returns a reader of the text of its elements. */
const mounted = <Props extends Record<string, any>>(component: Component<Props>, props: Props) => {
  const target = document.body.appendChild(document.createElement('div'));
  const app = mount(component, { target, props });

  onTestFinished(() => {
    void unmount(app);
    target.remove();
  });

  return () => [...target.querySelectorAll('p, i, b')].map(({ textContent }) => textContent);
};

/**
 * Records each distinct state `text` reads whenever the DOM changed, sampled at
 * the microtask checkpoint that delivers the mutation records: every state a
 * paint or an observer can see. A state that two flushes of one synchronous run
 * pass through is merged into the next one, though an effect of the first saw it.
 */
const painted = (text: () => (string | null)[]) => {
  const states = [text()];
  const observer = new MutationObserver(() => {
    const state = text();

    if (String(state) !== String(states.at(-1))) states.push(state);
  });

  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  onTestFinished(() => observer.disconnect());

  return states;
};

// A batch that waits on an `await` keeps its writes pending while later
// batches commit; each case pins what `t` shows once they have all settled,
// both where an `await` reads it and where nothing awaits it. Some also pin
// what is shown on the way: nothing ever mixes a batch's result or an awaited
// `t` with tables it does not go with.
describe('`t` under Svelte\'s async batching', () => {
  it.each([
    ['never shown', { en: { greeting: 'Hello' }, de: { other: 'x' } }, 'en', 'Hallo'],
    ['shown before', { en: { greeting: 'Hello' }, de: { greeting: 'Hallo' } }, 'de', 'Servus'],
  ])('shows what a waiting batch wrote to a locale (%s) that a switch made meanwhile went to', async (_, translations, first, expected) => {
    const instance = await activated(translations, first);
    const { wait, hold, release } = gate();
    const query = cell('a');
    const text = mounted(Search, { i18n: instance, wait, query });

    await instance.setLocale('en');
    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'Hello', 'en']));

    const states = painted(text);

    hold();
    // One handler: a search that waits, and the messages of a locale.
    query.current = 'b';
    instance.addTranslations({ de: { greeting: expected } });
    flushSync();
    // The switch to it commits while that batch waits.
    await instance.setLocale('de');
    flushSync();
    release();

    await vi.waitFor(() => expect(text()).toEqual(['results for b', expected, 'de']));
    expect(instance.t('greeting')).toBe(expected);
    // Never the batch's result without what it wrote.
    expect(states.filter(([result]) => result === 'results for b')).toEqual([['results for b', expected, 'de']]);
  });

  it('resolves an awaited `t` within a waiting batch, so a gate held after the switch holds back neither its result nor its table', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { other: 'x' } });
    const search = gate();
    const title = gate();
    const query = cell('a');
    const text = mounted(Titled, { i18n: instance, wait: search.wait, waitTitle: title.wait, query });

    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'Hello', 'Hello', 'en']));

    search.hold();
    query.current = 'b';
    instance.addTranslations({ de: { greeting: 'Hallo' } });
    flushSync();
    await instance.setLocale('de');
    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'greeting', 'greeting', 'de']));
    title.hold();
    search.release();

    await vi.waitFor(() => expect(text()[0]).toBe('results for b'));
    expect(text()).toEqual(['results for b', 'Hallo', 'Hallo', 'de']);
  });

  it('shows a waiting batch\'s result with the table it wrote while another batch that wrote the shown table waits', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { other: 'x' } });
    const [first, second] = [gate(), gate()];
    const [query, otherQuery] = [cell('a'), cell('x')];
    const results = mounted(Search, { i18n: instance, wait: first.wait, query });
    const other = mounted(Search, { i18n: instance, wait: second.wait, query: otherQuery });
    const text = () => [...results(), ...other()];

    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'Hello', 'en', 'results for x', 'Hello', 'en']));

    first.hold();
    second.hold();
    query.current = 'b';
    instance.addTranslations({ de: { greeting: 'Hallo' } });
    flushSync();
    otherQuery.current = 'y';
    instance.addTranslations({ en: { farewell: 'Bye' } });
    flushSync();
    await instance.setLocale('de');
    flushSync();
    first.release();

    await vi.waitFor(() => expect(results()[0]).toBe('results for b'));
    expect(text()).toEqual(['results for b', 'Hallo', 'de', 'results for x', 'Hallo', 'de']);

    second.release();

    await vi.waitFor(() => expect(text()).toEqual(['results for b', 'Hallo', 'de', 'results for y', 'Hallo', 'de']));
  });

  it('shows what a waiting batch wrote on an instance configured while a batch of another instance waits', async () => {
    const other = gate();
    const otherQuery = cell('a');
    const waiting = mounted(Search, { i18n: new i18n(), wait: other.wait, query: otherQuery });

    await vi.waitFor(() => expect(waiting()[0]).toBe('results for a'));

    other.hold();

    const instance = new i18n();

    otherQuery.current = 'b';
    // That batch waits by the time the instance is configured.
    await tick();
    await instance.loadConfig({ parser: valueParser, log, translations: { en: { greeting: 'Hello' }, de: { other: 'x' } } });
    await instance.setRoute('/');
    await instance.setLocale('en');

    const { wait, hold, release } = gate();
    const query = cell('a');
    const text = mounted(Search, { i18n: instance, wait, query });

    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'Hello', 'en']));

    hold();
    query.current = 'b';
    instance.addTranslations({ de: { greeting: 'Hallo' } });
    flushSync();
    await instance.setLocale('de');
    flushSync();
    release();
    other.release();

    await vi.waitFor(() => expect([...text(), waiting()[0]]).toEqual(['results for b', 'Hallo', 'de', 'results for b']));
  });

  it('shows a write to the shown table at once while a switch away from it waits', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { greeting: 'Hallo' } });
    const { wait, hold, release } = gate();
    const query = cell('a');
    const text = mounted(Search, { i18n: instance, wait, query });

    await vi.waitFor(() => expect(text()).toEqual(['results for a', 'Hello', 'en']));

    hold();
    // One handler: a search that waits, and a switch.
    query.current = 'b';
    void instance.setLocale('de');
    flushSync();
    instance.addTranslations({ en: { greeting: 'Hi' } });
    flushSync();

    expect(text()).toEqual(['results for a', 'Hi', 'en']);

    release();

    await vi.waitFor(() => expect(text()).toEqual(['results for b', 'Hallo', 'de']));
  });

  it('shows the first table of a locale that a batch waiting on `l` brings, once a switch waiting on `t` goes there', async () => {
    const instance = await activated({ en: { greeting: 'Hello' } });
    const { wait, hold, release } = gate();
    const text = mounted(Pair, { i18n: instance, wait });

    await vi.waitFor(() => expect(text()).toEqual(['Hello', 'greeting', 'Hello']));

    hold();
    instance.addTranslations({ de: { greeting: 'Hallo' } });
    flushSync();
    void instance.setLocale('de');
    flushSync();
    release();

    await vi.waitFor(() => expect(text()).toEqual(['Hallo', 'Hallo', 'Hallo']));
    expect([instance.locale, instance.t('greeting')]).toEqual(['de', 'Hallo']);
  });

  it('refreshes `t`\'s identity with the first table of a locale that a batch waiting on `l` brings, once a switch goes there', async () => {
    const instance = await activated({ en: { greeting: 'Hello' } });
    const { wait, hold, release } = gate();
    const seen: string[] = [];
    const text = mounted(Held, { i18n: instance, wait, seen });

    await vi.waitFor(() => expect(text()).toEqual(['greeting', 'Hello']));

    hold();
    instance.addTranslations({ de: { greeting: 'Hallo' } });
    flushSync();
    void instance.setLocale('de');
    flushSync();
    release();

    await vi.waitFor(() => expect(text()).toEqual(['Hallo', 'Hallo']));
    expect(seen.at(-1)).toBe('Hallo');
  });

  it('refreshes `t`\'s identity once a fork that wrote a locale\'s table commits after a switch to it', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { other: 'x' } });
    const seen: string[] = [];
    const read: string[] = [];
    const stops = [
      effect(() => {
        const { t } = instance;

        seen.push(untrack(() => t('greeting')));
      }),
      effect(() => { read.push(instance.t('greeting')); }),
    ];

    onTestFinished(() => stops.forEach((stop) => stop()));

    const forked = fork(() => { instance.addTranslations({ de: { greeting: 'Hallo' } }); });

    await instance.setLocale('de');
    flushSync();
    await forked.commit();
    flushSync();

    await vi.waitFor(() => expect([seen.at(-1), read.at(-1)]).toEqual(['Hallo', 'Hallo']));
  });

  it('lets the effects of a fork\'s commit read the table it wrote to a locale a switch went to meanwhile', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { other: 'x' } });
    const cue = cell(0);
    const read: (string | null)[] = [];

    mounted(Readback, { i18n: instance, cue, read });
    flushSync();

    const forked = fork(() => {
      instance.addTranslations({ de: { greeting: 'Hallo' } });
      cue.current = 1;
    });

    await instance.setLocale('de');
    flushSync();
    await forked.commit();
    flushSync();

    expect(read).toEqual(['Hallo']);
  });

  it.each([
    ['a locale\'s first table', { en: { greeting: 'Hello' } }, 'en', 'en,de'],
    ['an instance\'s first table', undefined, '', 'de'],
  ])('leaves no trace of %s a discarded fork wrote, and shows the write that follows', async (_, translations, before, after) => {
    const instance = new i18n({ parser: valueParser, log, translations });

    await instance.setRoute('/');
    await instance.setLocale('en');

    const keys: string[] = [];
    const read: string[] = [];
    const stops = [
      effect(() => { keys.push(Object.keys(instance.translations).join()); }),
      effect(() => { read.push(instance.l('de', 'greeting')); }),
    ];

    onTestFinished(() => stops.forEach((stop) => stop()));

    fork(() => { instance.addTranslations({ de: { greeting: 'Hallo' } }); }).discard();
    flushSync();

    expect([keys.at(-1), read.at(-1)]).toEqual([before, 'greeting']);

    instance.addTranslations({ de: { greeting: 'Servus' } });
    flushSync();

    expect([keys.at(-1), read.at(-1)]).toEqual([after, 'Servus']);
  });

  it('settles an awaited `t` on the locale a switch goes to after writes to other locales while it waits', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { greeting: 'Hallo' }, cs: { greeting: 'Ahoj' } });
    const { wait, hold, release } = gate();
    const cue = cell(0);
    const writes: (() => unknown)[] = [];
    const text = mounted(Probe, { i18n: instance, wait, writes, cue });

    await vi.waitFor(() => expect(text()).toEqual(['Hello', 'Hello']));

    hold();
    void instance.setLocale('de');
    flushSync();
    // A write from an effect, in a batch of its own, and a direct one.
    writes.push(() => instance.addTranslations({ fr: { greeting: 'Salut' } }));
    cue.current += 1;
    flushSync();
    instance.addTranslations({ cs: { greeting: 'Nazdar' } });
    flushSync();
    release();

    await vi.waitFor(() => expect(text()).toEqual(['Hallo', 'Hallo']));
    expect(instance.locale).toBe('de');
  });

  it('never shows an awaited `t` apart from `t` while an effect writes the table a waiting switch goes to', async () => {
    const instance = await activated({ en: { greeting: 'Hello' }, de: { other: 'x' } });
    const { wait, hold, release } = gate();
    const cue = cell(0);
    const writes = [() => instance.addTranslations({ de: { greeting: 'Hallo' } })];
    const text = mounted(Probe, { i18n: instance, wait, writes, cue });

    await vi.waitFor(() => expect(text()).toEqual(['Hello', 'Hello']));

    const states = painted(text);

    hold();
    void instance.setLocale('de');
    flushSync();
    cue.current = 1;
    flushSync();
    release();

    await vi.waitFor(() => expect(text()).toEqual(['Hallo', 'Hallo']));
    expect(states.filter(([awaited, shown]) => awaited !== shown)).toEqual([]);
  });

  it('shows what a fork wrote to the active table once it commits after a write to another locale', async () => {
    const instance = await activated({ en: { greeting: 'Hello' } });
    const { wait } = gate();
    const text = mounted(Probe, { i18n: instance, wait, writes: [], cue: cell(0) });

    await vi.waitFor(() => expect(text()).toEqual(['Hello', 'Hello']));

    const discarded = fork(() => { instance.addTranslations({ en: { greeting: 'Discarded' } }); });

    discarded.discard();
    flushSync();

    const committed = fork(() => { instance.addTranslations({ en: { greeting: 'Forked' } }); });

    instance.addTranslations({ fr: { greeting: 'Salut' } });
    flushSync();
    await committed.commit();
    flushSync();

    expect(instance.t('greeting')).toBe('Forked');
    await vi.waitFor(() => expect(text()).toEqual(['Forked', 'Forked']));
  });
});
