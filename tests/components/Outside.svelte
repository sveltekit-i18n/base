<script lang="ts">
  import type { Kit } from '../../src/kit/types.js';

  let { get }: Pick<Kit.T, 'get'> = $props();

  // svelte-ignore state_referenced_locally
  get();
</script>
