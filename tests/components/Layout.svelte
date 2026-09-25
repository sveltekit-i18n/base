<script lang="ts">
  import type { Kit } from '../../src/kit/types.js';
  import Child from './Child.svelte';

  let { use, get, data, probe }: Pick<Kit.T, 'use' | 'get'> & { data: object; probe: (found: unknown[]) => void } = $props();

  // svelte-ignore state_referenced_locally
  const i18n = use(() => data);
</script>

<p>{i18n.t('common.greeting')}</p>
<Child {get} {probe} />
