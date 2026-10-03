<script lang="ts">
  import type { I18n } from '../../src/index.js';

  // Pending `await`s that read `t` and `l`, and `t` outside them.
  let { i18n, wait }: { i18n: I18n; wait: () => Promise<void> } = $props();

  const shown = async (text: string) => {
    await wait();

    return text;
  };
</script>

<svelte:boundary>
  <p>{await shown(i18n.t('greeting'))}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>

<svelte:boundary>
  <p>{await shown(i18n.l('de', 'greeting'))}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>
<i>{i18n.t('greeting')}</i>
