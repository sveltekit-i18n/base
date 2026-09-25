<script lang="ts">
  import { getContext } from 'svelte';

  import type { Kit } from '../../src/kit/types.js';

  let { get, probe }: Pick<Kit.T, 'get'> & { probe: (found: unknown[]) => void } = $props();

  // Registry-wide: another copy of the package reads the same context.
  // svelte-ignore state_referenced_locally
  probe([get(), getContext(Symbol.for('@sveltekit-i18n/base/kit'))]);
</script>
