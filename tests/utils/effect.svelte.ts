import { flushSync } from 'svelte';

/**
 * Runs `fn` in an effect, as a component would, and returns its teardown.
 * Only the client compile runs effects; the server compile runs none.
 */
export const effect = (fn: () => void): (() => void) => {
  const stop = $effect.root(() => {
    $effect(fn);
  });

  flushSync();

  return stop;
};

/** Whether this compile runs effects at all. */
export const effectsRun = (() => {
  let ran = false;

  effect(() => {
    ran = true;
  })();

  return ran;
})();

export { flushSync };
