<script lang="ts">
  import { loadPanelOpen, savePanelOpen } from './panelState.js';

  let { id, title, glyph = '', subtitle = '', defaultOpen = false, children } = $props<{
    id: string; title: string; glyph?: string; subtitle?: string; defaultOpen?: boolean;
    children?: import('svelte').Snippet;
  }>();

  let open = $state(defaultOpen);

  $effect(() => { open = loadPanelOpen(id, defaultOpen); });

  function toggle() { open = !open; savePanelOpen(id, open); }
</script>

<section class="bg-surface border border-border-muted rounded-xl mb-6 overflow-hidden">
  <button
    type="button"
    onclick={toggle}
    class="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
    aria-expanded={open}
  >
    <span class="flex items-center gap-3 min-w-0">
      {#if glyph}<span class="text-fg-faint text-lg leading-none">{glyph}</span>{/if}
      <span class="min-w-0">
        <span class="block text-lg font-bold text-fg truncate">{title}</span>
        {#if subtitle}<span class="block text-xs text-fg-faint truncate">{subtitle}</span>{/if}
      </span>
    </span>
    <span class="font-mono text-fg-faint text-lg leading-none flex-none">{open ? '−' : '+'}</span>
  </button>
  {#if open}
    <div class="px-6 pb-6 pt-1">
      {@render children?.()}
    </div>
  {/if}
</section>
