<!--
  SectionLabel — small uppercase letterspaced section header (e.g. `LEAGUES`,
  `CROSS-LEAGUE NEXT`, `ACTIVE NOW`, `PAST SEASONS`).
  Example:
    <SectionLabel>Leagues</SectionLabel>
    <SectionLabel>Cross-league next</SectionLabel>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="text-fg-faint font-mono text-xs tracking-widest font-bold uppercase">
  {@render children()}
</div>
