<script lang="ts">
  import type { Kit } from '@sveltekit-i18n/base/kit';

  let { use, data }: Pick<Kit.T, 'use'> & { data: object } = $props();

  // svelte-ignore state_referenced_locally
  const i18n = use(() => data);
</script>

<p>{i18n.t('ns0.k0')}</p>
