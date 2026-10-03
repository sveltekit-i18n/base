<script lang="ts">
  import type { I18n } from '../../src/index.js';

  // A pending `await` that reads no `t` (a search), one that reads `t` and
  // waits on a gate of its own, and `t` and the locale outside them.
  let { i18n, wait, waitTitle, query }: { i18n: I18n; wait: () => Promise<void>; waitTitle: () => Promise<void>; query: { current: string } } = $props();

  const search = async (text: string) => {
    await wait();

    return `results for ${text}`;
  };

  const title = async (text: string) => {
    await waitTitle();

    return text;
  };
</script>

<svelte:boundary>
  <p>{await search(query.current)}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>

<svelte:boundary>
  <p>{await title(i18n.t('greeting'))}</p>

  {#snippet pending()}<p>pending</p>{/snippet}
</svelte:boundary>
<i>{i18n.t('greeting')}</i>
<b>{i18n.locale}</b>
