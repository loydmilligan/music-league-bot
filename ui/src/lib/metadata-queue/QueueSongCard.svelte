<script lang="ts">
  import { coverageStatePill, runMissingCount } from './queueSongCard.js';
  import { LADDER } from './ladder.js';
  import type { CoverageState } from './queueSongCard.js';

  interface CoverageRow {
    spotify_uri: string;
    title: string | null;
    artist: string | null;
    jobs: Record<string, CoverageState>;
  }

  interface JobMeta {
    name: string;
    provider: string;
    speed: string;
  }

  interface Props {
    song: CoverageRow;
    jobOrder: readonly string[];
    jobMeta: Record<string, JobMeta>;
    onRunElement: (uri: string, jobType: string) => void;
    onRunMissing: (uri: string) => void;
    onEnrichAll: (uri: string) => void;
  }

  let { song, jobOrder, jobMeta, onRunElement, onRunMissing, onEnrichAll }: Props = $props();

  const missingCount = $derived(runMissingCount(song.jobs));

  function isActionable(state: CoverageState): boolean {
    return state !== 'done' && state !== 'processing';
  }
</script>

<div class="bg-bg-elevated border border-border-muted rounded-xl p-4">
  <!-- Song header -->
  <div class="mb-3">
    <div class="font-medium text-fg truncate" title={song.title ?? song.spotify_uri}>
      {song.title ?? song.spotify_uri.split(':').pop()}
    </div>
    {#if song.artist}
      <div class="text-fg-faint text-xs truncate mt-0.5">{song.artist}</div>
    {/if}
  </div>

  <!-- Per-element rows -->
  <div class="space-y-1.5 mb-4">
    {#each jobOrder as jt (jt)}
      {@const state = (song.jobs[jt] ?? 'missing') as CoverageState}
      {@const pill = coverageStatePill(state)}
      {@const meta = jobMeta[jt]}
      {@const actionable = isActionable(state)}
      <div class="flex items-center gap-2">
        <!-- Pill -->
        <span
          class="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded border
            {pill.toneClass} {LADDER[state === 'processing' ? 'running' : state === 'pending' ? 'queued' : state === 'failed' ? 'failedHard' : state].soft}
            {LADDER[state === 'processing' ? 'running' : state === 'pending' ? 'queued' : state === 'failed' ? 'failedHard' : state].border}
            {state === 'processing' ? 'animate-pulse' : ''}"
          title="{meta?.name ?? jt} · {pill.label}"
        >
          <span>{pill.glyph}</span>
        </span>

        <!-- Job name + provider -->
        <div class="flex-1 min-w-0">
          <span class="text-xs text-fg">{meta?.name ?? jt}</span>
          {#if meta?.provider}
            <span class="text-fg-faint text-[10px] ml-1">({meta.provider})</span>
          {/if}
        </div>

        <!-- run > button — accent only as action, softened/disabled when not actionable -->
        <button
          type="button"
          onclick={() => { if (actionable) onRunElement(song.spotify_uri, jt); }}
          disabled={!actionable}
          class="font-mono text-[10px] tracking-widest uppercase shrink-0 transition-colors px-2 py-0.5 rounded
            {actionable
              ? 'text-accent border border-accent/30 hover:border-accent hover:text-accent-strong cursor-pointer'
              : 'text-fg-faint border border-border-muted cursor-not-allowed opacity-40'}"
          title={actionable ? `Enqueue ${meta?.name ?? jt}` : pill.label}
        >
          run &#9658;
        </button>
      </div>
    {/each}
  </div>

  <!-- Card-level actions -->
  <div class="flex items-center gap-2 pt-3 border-t border-border-muted">
    <button
      type="button"
      onclick={() => onEnrichAll(song.spotify_uri)}
      class="font-mono text-[10px] tracking-widest uppercase text-accent border border-accent/30 hover:border-accent hover:text-accent-strong transition-colors px-2 py-1 rounded"
    >
      enrich all &#8635;
    </button>
    <button
      type="button"
      onclick={() => { if (missingCount > 0) onRunMissing(song.spotify_uri); }}
      disabled={missingCount === 0}
      class="font-mono text-[10px] tracking-widest uppercase transition-colors px-2 py-1 rounded
        {missingCount > 0
          ? 'text-accent border border-accent/30 hover:border-accent hover:text-accent-strong cursor-pointer'
          : 'text-fg-faint border border-border-muted cursor-not-allowed opacity-40'}"
    >
      run {missingCount} missing
    </button>
  </div>
</div>
