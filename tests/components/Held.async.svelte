<script lang="ts">
  import { untrack } from 'svelte';
  import type { I18n } from '../../src/index.js';

  // A pending `await` that reads `l`, `t` outside it, and an effect that holds
  // only `t`'s identity.
  let { i18n, wait, seen }: { i18n: I18n; wait: () => Promise<void>; seen: string[] } = $props();

  const shown = async (text: string) => {
    await wait();

    return text;
  };

  $effect(() => {
    const { t } = i18n;

    seen.push(untrack(() => t('greeting')));
  });
</script>

<svelte:boundary>
  <p>{await shown(i18n.l('de', 'greeting'))}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>
<i>{i18n.t('greeting')}</i>
