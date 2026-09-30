<script lang="ts">
  import type { I18n } from '../../src/index.js';

  // `t`, and an effect that reads its text back on a cue.
  let { i18n, cue, read }: { i18n: I18n; cue: { current: number }; read: (string | null)[] } = $props();
  let shown: HTMLElement;

  $effect(() => {
    if (cue.current) read.push(shown.textContent);
  });
</script>

<i bind:this={shown}>{i18n.t('greeting')}</i>
