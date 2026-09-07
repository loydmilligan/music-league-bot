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
    recommendedHilPct = 40,
    disabled = false,
    idPrefix = 'vp',
    onchange,
  }: {
    config: VideoPlaylistConfig;
    recommendedPct?: number;
    recommendedHilPct?: number;
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
  // Saved as two independent fields, so the pair is transiently inverted while
  // the auto-accept box is being edited downward. Clamped on save; explained
  // here rather than blocked, so the edit can be finished.
  const pairInverted = $derived(config.hilPct > config.searchAutoAcceptPct);

  const scoring =
    'Scoring: artist channel +45, "official video" in the title +25, track name in the title +20, top result +10.';

  const thresholdHint =
    `At or above this, a searched video goes straight in without asking you. ` +
    `${recommendedPct} is recommended: high enough to reject the covers and fan uploads search ` +
    `returns for songs that have no real music video, low enough to keep an upload on the ` +
    `artist's own or VEVO channel that isn't explicitly titled "official video". ${scoring}`;

  const hilHint =
    `The floor of the "ask me" band. A video scoring between this and the auto-accept level ` +
    `is plausible but not certain, so it waits for you on the review page and blocks posting ` +
    `until you answer it. Below this, videos are long shots: offered as suggestions, left out ` +
    `unless you pick one, and never blocking. ${recommendedHilPct} is recommended — in the ` +
    `real R141 round the two 55s genuinely needed a human, and everything at 30 or below was ` +
    `a cover or a fan upload. ${scoring}`;
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

    <div class="flex items-center gap-3" class:opacity-40={!config.useSearch}>
      <label class="text-sm text-fg-muted" for="{idPrefix}-hil">Ask me from</label>
      <input
        id="{idPrefix}-hil"
        type="number"
        min="0"
        max="100"
        step="5"
        value={config.hilPct}
        disabled={disabled || !config.enabled || !config.useSearch}
        onchange={(e) => onchange({ hilPct: Number(e.currentTarget.value) })}
        title={hilHint}
        class="w-20 bg-bg-elevated border border-border-muted rounded-md px-2 py-1 text-sm font-mono text-fg"
      />
      <span class="text-xs text-fg-dim" title={hilHint}>
        % · {recommendedHilPct} recommended
      </span>
    </div>

    {#if config.enabled && config.useSearch}
      <div class="text-xs text-fg-dim max-w-prose space-y-1">
        <p>
          <span class="text-fg-muted">{config.searchAutoAcceptPct}% and up</span> — added automatically.
          <span class="text-fg-muted">{config.hilPct}–{Math.max(config.hilPct, config.searchAutoAcceptPct - 1)}%</span> —
          waits for your call and blocks posting.
          <span class="text-fg-muted">Under {config.hilPct}%</span> — offered as a suggestion, left out unless you pick it.
        </p>
        <p>{scoring}</p>
      </div>
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
  {#if pairInverted}
    <p class="text-xs text-amber">
      "Ask me from" is above auto-accept, so nothing would ever be asked about — it will be
      saved as {config.searchAutoAcceptPct}%.
    </p>
  {/if}
</div>
