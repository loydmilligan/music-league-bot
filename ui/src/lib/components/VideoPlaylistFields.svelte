<script lang="ts">
  /**
   * The four video-playlist controls, shared by the three places a round's
   * config can be edited (settings round panel, round-detail modal) and by the
   * global-defaults panel. One copy so the enable/disable rules and the
   * threshold recommendation can't drift between them.
   *
   * Purely controlled: it never writes. The parent decides what a change means
   * — a per-field autosave in one surface, a staged diff in another.
   */
  import type { VideoPlaylistConfig } from '$lib/db/videoPlaylist.js';

  let {
    config,
    recommendedPct = 70,
    disabled = false,
    idPrefix = 'vp',
    onchange,
  }: {
    config: VideoPlaylistConfig;
    recommendedPct?: number;
    disabled?: boolean;
    idPrefix?: string;
    onchange: (patch: Partial<VideoPlaylistConfig>) => void;
  } = $props();

  // Both sources off is a real state the user can reach by unticking the second
  // box, and it silently produces nothing — so it gets said out loud.
  const noSource = $derived(config.enabled && !config.useComments && !config.useSearch);
  const pctInvalid = $derived(
    !Number.isInteger(config.searchAutoAcceptPct) ||
    config.searchAutoAcceptPct < 0 ||
    config.searchAutoAcceptPct > 100,
  );

  const thresholdHint =
    `Confidence at or above which a searched video is added without you reviewing it. ` +
    `${recommendedPct} is recommended: high enough to reject the covers and fan uploads search ` +
    `returns for songs that have no real music video, low enough to keep an upload on the ` +
    `artist's own or VEVO channel that isn't explicitly titled "official video". ` +
    `Scoring: artist channel +45, "official video" in the title +25, track name in the title +20, ` +
    `top result +10. Anything below the threshold is still found and reported — it just isn't ` +
    `added to the playlist automatically.`;
</script>

<div class="space-y-3">
  <label class="flex items-center gap-3 text-sm text-fg-muted">
    <input
      id="{idPrefix}-enabled"
      type="checkbox"
      checked={config.enabled}
      {disabled}
      onchange={(e) => onchange({ enabled: e.currentTarget.checked })}
      class="accent-accent"
    />
    <span>Build a music-video playlist for this round</span>
  </label>

  <div class="pl-7 space-y-3" class:opacity-40={!config.enabled}>
    <label class="flex items-center gap-3 text-sm text-fg-muted">
      <input
        id="{idPrefix}-comments"
        type="checkbox"
        checked={config.useComments}
        disabled={disabled || !config.enabled}
        onchange={(e) => onchange({ useComments: e.currentTarget.checked })}
        class="accent-accent"
      />
      <span>Use YouTube links from submission comments</span>
    </label>

    <label class="flex items-center gap-3 text-sm text-fg-muted">
      <input
        id="{idPrefix}-search"
        type="checkbox"
        checked={config.useSearch}
        disabled={disabled || !config.enabled}
        onchange={(e) => onchange({ useSearch: e.currentTarget.checked })}
        class="accent-accent"
      />
      <span>
        Search YouTube
        <span class="text-fg-dim text-xs">
          {config.useComments ? '— only for submissions with no link' : '— the only source'}
        </span>
      </span>
    </label>

    <div class="flex items-center gap-3" class:opacity-40={!config.useSearch}>
      <label class="text-sm text-fg-muted" for="{idPrefix}-pct">Auto-accept at</label>
      <input
        id="{idPrefix}-pct"
        type="number"
        min="0"
        max="100"
        step="5"
        value={config.searchAutoAcceptPct}
        disabled={disabled || !config.enabled || !config.useSearch}
        onchange={(e) => onchange({ searchAutoAcceptPct: Number(e.currentTarget.value) })}
        title={thresholdHint}
        class="w-20 bg-bg-elevated border border-border-muted rounded-md px-2 py-1 text-sm font-mono text-fg"
      />
      <span class="text-xs text-fg-dim" title={thresholdHint}>
        % confidence · {recommendedPct} recommended
      </span>
    </div>

    {#if config.enabled && config.useSearch}
      <p class="text-xs text-fg-dim pl-0 max-w-prose">{thresholdHint}</p>
    {/if}
  </div>

  {#if noSource}
    <p class="text-xs text-ember">
      Both sources are off, so no video playlist will be built. Turn on comments, search, or both.
    </p>
  {/if}
  {#if pctInvalid}
    <p class="text-xs text-ember">Auto-accept must be a whole number from 0 to 100.</p>
  {/if}
</div>
