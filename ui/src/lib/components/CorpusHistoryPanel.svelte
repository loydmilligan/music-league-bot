<script lang="ts">
  import type { SongStatus } from '$lib/db/songHistory.js';

  let { status }: { status: SongStatus } = $props();

  const hasSubmissions = $derived(status.submittedByMe || status.submittedByOthers.length > 0);
  const hasHistory = $derived(hasSubmissions || status.chatMentions.length > 0);
</script>

<div class="space-y-3 text-xs font-mono">
  {#if !hasHistory}
    <p class="text-fg-faint italic">No corpus history — first time in our leagues.</p>
  {:else}
    {#if hasSubmissions}
      <div>
        <h4 class="text-[10px] tracking-widest uppercase text-fg-faint mb-1.5">Appearances</h4>
        <div class="flex flex-col gap-1">
          {#if status.submittedByMe}
            <div class="flex items-center gap-2 bg-surface rounded px-2 py-1">
              <span class="text-health font-bold">You</span>
              <span class="text-fg-faint">submitted this</span>
            </div>
          {/if}
          {#each status.submittedByOthers as s}
            <div class="flex items-center gap-2 bg-surface rounded px-2 py-1 min-w-0">
              <span class="text-fg truncate">{s.by}</span>
              <span class="text-fg-faint flex-shrink-0">·</span>
              <span class="text-fg-dim truncate flex-1 min-w-0">{s.league} S{s.season} · {s.round}</span>
              <span class="text-fg-faint flex-shrink-0 ml-auto">{s.points}pt</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if status.chatMentions.length > 0}
      <div>
        <h4 class="text-[10px] tracking-widest uppercase text-fg-faint mb-1.5">
          Chat mentions [{status.chatMentions.length}]
        </h4>
        <div class="flex flex-col gap-1">
          {#each status.chatMentions as m}
            <div class="bg-surface rounded px-2 py-1">
              <span class="text-fg-dim">{m.by}:</span>
              <span class="text-fg ml-1 italic break-words">"{m.quote}"</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
