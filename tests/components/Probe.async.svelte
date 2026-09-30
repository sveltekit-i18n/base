<script lang="ts">
  import type { I18n } from '../../src/index.js';

  // A pending `await` that reads `t`, `t` outside it, and table writes made
  // by an effect, each in a batch of its own.
  let { i18n, wait, writes, cue }: { i18n: I18n; wait: () => Promise<void>; writes: (() => unknown)[]; cue: { current: number } } = $props();

  const shown = async (text: string) => {
    await wait();

    return text;
  };

  $effect(() => {
    const n = cue.current;

    if (n) writes[n - 1]();
  });
</script>

<svelte:boundary>
  <p>{await shown(i18n.t('greeting'))}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>
<i>{i18n.t('greeting')}</i>
