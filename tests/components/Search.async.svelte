<script lang="ts">
  import type { I18n } from '../../src/index.js';

  // A pending `await` that reads no `t` (a search), and `t` and the locale
  // outside it.
  let { i18n, wait, query }: { i18n: I18n; wait: () => Promise<void>; query: { current: string } } = $props();

  const search = async (text: string) => {
    await wait();

    return `results for ${text}`;
  };
</script>

<svelte:boundary>
  <p>{await search(query.current)}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>
<i>{i18n.t('greeting')}</i>
<b>{i18n.locale}</b>
