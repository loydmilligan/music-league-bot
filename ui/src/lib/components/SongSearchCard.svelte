<script lang="ts" module>
  // The shape returned by GET /api/spotify/search (see
  // src/routes/api/spotify/search/+server.ts). Shared with SongSearchTab.
  export type SpotifyResult = {
    uri: string;
    name: string;
    artists: string;
    album: string;
    year: string;
    imageUrl: string | null;
  };

  // ── VIZ / WAVE-2 INTEGRATION CONTRACT (frozen — sprint-23) ──────────────
  // This card is a presentational shell. Every feature layer plugs in through
  // the props below WITHOUT editing this file, so the frontend (promote /
  // corpus-history) and viz (coloring / badges) lanes never collide here.
  //
  //  history-coloring (viz, D3): style off the data-attributes this card emits
  //    on BOTH the collapsed button and the expanded <article>:
  //      data-history-status="submitted-mine|submitted-others|artist-mine|chat-mention|none"
  //          ^ strongest single signal, for the border treatment
  //      data-submitted-by-me / data-submitted-by-others
  //      data-artist-mine / data-chat-mention      (present="true" when active)
  //          ^ the full set, for the secondary pills. Write global CSS keyed on
  //            these selectors (no card edit needed).
  //
  //  badge-system (viz, D6/D7): pass the badge snippets — they receive the
  //    relevant BadgeSet so the viz component just renders glyphs+counts:
  //      {artistBadgeHint}  — subtle collapsed-row "artist carries badges" hint
  //      {songBadges} {artistBadges} — full sets in the expanded card
  //    Badge DATA arrives via the `badges` prop (SongBadges from badges-api).
  //
  //  promote-actions (frontend): {promoteActions} snippet → expanded footer.
  //  corpus-history-panel (frontend): {corpusHistory} snippet → expanded body,
  //    receives the SongStatus (appearances + chat mentions) from song-status.
  // ────────────────────────────────────────────────────────────────────────
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SongStatus } from '$lib/db/songHistory.js';
  import type { SongBadges, BadgeSet } from '$lib/db/badges.js';

  const {
    result,
    open = false,
    ontoggle,
    historyStatus = null,
    badges = null,
    songBadges,
    artistBadges,
    artistBadgeHint,
    promoteActions,
    corpusHistory,
  }: {
    result: SpotifyResult;
    open?: boolean;
    ontoggle: () => void;
    historyStatus?: SongStatus | null;
    badges?: SongBadges | null;
    songBadges?: Snippet<[BadgeSet]>;
    artistBadges?: Snippet<[BadgeSet]>;
    artistBadgeHint?: Snippet<[BadgeSet]>;
    promoteActions?: Snippet;
    corpusHistory?: Snippet<[SongStatus]>;
  } = $props();

  const trackId = $derived(result.uri.replace('spotify:track:', ''));
  const sub = $derived(
    [result.artists, result.album].filter(Boolean).join(' · ') +
      (result.year ? ` (${result.year})` : ''),
  );

  // ── D3 history flags (frozen contract for the coloring layer) ──
  const submittedByMe = $derived(historyStatus?.submittedByMe ?? false);
  const submittedByOthers = $derived((historyStatus?.submittedByOthers?.length ?? 0) > 0);
  const artistMine = $derived(historyStatus?.artistSubmittedByMe ?? false);
  const chatMention = $derived((historyStatus?.chatMentions?.length ?? 0) > 0);
  // Strongest single signal drives the border; precedence is documented here so
  // viz can rely on it: mine-submitted > others-submitted > artist-mine > chat.
  const status = $derived(
    submittedByMe ? 'submitted-mine'
    : submittedByOthers ? 'submitted-others'
    : artistMine ? 'artist-mine'
    : chatMention ? 'chat-mention'
    : 'none',
  );
</script>

{#if open}
  <article
    class="bg-bg-elevated border border-accent-deep rounded-xl p-4"
    data-history-status={status}
    data-submitted-by-me={submittedByMe || undefined}
    data-submitted-by-others={submittedByOthers || undefined}
    data-artist-mine={artistMine || undefined}
    data-chat-mention={chatMention || undefined}
  >
    <header class="flex items-start gap-4">
      {#if result.imageUrl}
        <img src={result.imageUrl} alt="" width="72" height="72" class="rounded-lg flex-shrink-0" />
      {:else}
        <div class="w-[72px] h-[72px] rounded-lg bg-surface flex-shrink-0"></div>
      {/if}
      <div class="flex-1 min-w-0">
        <div class="font-bold text-fg text-base leading-snug">{result.name}</div>
        <div class="font-mono text-[11px] text-fg-dim mt-0.5">{sub}</div>
        <!-- badge-system (viz): full song + artist badge sets render here -->
        {#if songBadges && badges}
          <div class="mt-2">{@render songBadges(badges.song)}</div>
        {/if}
        {#if artistBadges && badges}
          <div class="mt-1.5">{@render artistBadges(badges.artist)}</div>
        {/if}
      </div>
      <button
        type="button"
        onclick={ontoggle}
        aria-label="Collapse card"
        class="flex-shrink-0 font-mono text-fg-faint hover:text-fg text-lg leading-none transition-colors"
      >×</button>
    </header>

    <!-- corpus-history-panel (frontend): appearances + chat mentions -->
    {#if corpusHistory && historyStatus}
      <div class="mt-4">{@render corpusHistory(historyStatus)}</div>
    {/if}

    <!-- promote-actions (frontend): + Shortlist / + Round / + H2H / ▶ Play -->
    <footer class="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-border-muted text-xs">
      {#if promoteActions}
        {@render promoteActions()}
      {:else}
        <a
          href={`https://open.spotify.com/track/${trackId}`}
          target="_blank"
          rel="noreferrer"
          class="text-health hover:text-health/80 font-mono transition-colors"
        >Spotify ↗</a>
      {/if}
      <span class="ml-auto font-mono text-[10px] tracking-widest uppercase text-fg-faint">Esc to collapse</span>
    </footer>
  </article>
{:else}
  <button
    type="button"
    onclick={ontoggle}
    class="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-bg-elevated border border-border-muted hover:border-border text-left transition-colors"
    data-history-status={status}
    data-submitted-by-me={submittedByMe || undefined}
    data-submitted-by-others={submittedByOthers || undefined}
    data-artist-mine={artistMine || undefined}
    data-chat-mention={chatMention || undefined}
  >
    {#if result.imageUrl}
      <img src={result.imageUrl} alt="" width="44" height="44" class="rounded flex-shrink-0" />
    {:else}
      <span class="w-11 h-11 rounded bg-surface flex-shrink-0"></span>
    {/if}
    <span class="flex-1 min-w-0">
      <span class="block font-bold text-fg text-sm truncate">{result.name}</span>
      <span class="block font-mono text-[11px] text-fg-dim truncate">{sub}</span>
    </span>
    <!-- badge-system (viz): subtle "this artist carries badges" hint -->
    {#if artistBadgeHint && badges}
      <span class="flex-shrink-0">{@render artistBadgeHint(badges.artist)}</span>
    {/if}
    <!-- history-coloring (viz): secondary status pills can render off data-attrs -->
  </button>
{/if}
