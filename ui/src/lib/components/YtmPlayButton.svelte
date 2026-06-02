<!--
  YtmPlayButton — reusable YouTube Music play control, sibling to the existing
  "▶ Play on Spotify" <a> in ShortlistRow.svelte (sprint-13 ytm-button).

  Three states (driven by props + click-time resolution):
    • resolved   — a direct <a> to the YTM URL (when `ytmUrl` is known, or once a
                   click-time resolve succeeds).
    • unresolved — a button that, on click, calls GET /api/ytm/:spotifyUri, shows
                   an inline spinner, then re-renders as the resolved link.
    • no-match   — a disabled control reading "No YTM match" (when `noMatch` is
                   passed, or a resolve comes back with no equivalent).

  The component self-manages the resolve call. It takes the song's `spotifyUri`
  (for forward resolution) and/or a known `ytmUrl` as props, plus an optional
  `class` passthrough so each song surface can match its local button styling
  when wired in (sprint-13 wire-song-rows, Wave 2).

  Resolve contract (GET /api/ytm/:spotifyUri): returns `{ ytmUrl: string | null }`
  today; also tolerates the hardened `{ noMatch: true }` shape backend is adding
  in parallel — either a null/empty `ytmUrl` or `noMatch:true` lands us in the
  no-match state.
-->
<script lang="ts">
  let {
    spotifyUri = null,
    ytmUrl = null,
    noMatch = false,
    label = 'Play on YTM',
    class: className = '',
  }: {
    spotifyUri?: string | null;
    ytmUrl?: string | null;
    noMatch?: boolean;
    label?: string;
    class?: string;
  } = $props();

  // Click-time resolution takes precedence over the initial props.
  let resolvedUrl = $state<string | null>(null);
  let resolving = $state(false);
  let resolvedNoMatch = $state(false);
  let errored = $state(false);

  const href = $derived(resolvedUrl ?? ytmUrl ?? null);
  const isNoMatch = $derived(noMatch || resolvedNoMatch);

  type View = 'resolved' | 'no-match' | 'unresolved';
  const view = $derived<View>(href ? 'resolved' : isNoMatch ? 'no-match' : 'unresolved');

  async function resolve() {
    if (resolving || !spotifyUri) return;
    resolving = true;
    errored = false;
    try {
      const res = await fetch(`/api/ytm/${encodeURIComponent(spotifyUri)}`);
      if (!res.ok) throw new Error(`resolve failed (${res.status})`);
      const body = (await res.json()) as { ytmUrl?: string | null; noMatch?: boolean };
      if (body.noMatch === true || body.ytmUrl == null || body.ytmUrl === '') {
        resolvedNoMatch = true;
      } else {
        resolvedUrl = body.ytmUrl;
      }
    } catch {
      // Stay in the unresolved state so the click can be retried.
      errored = true;
    } finally {
      resolving = false;
    }
  }
</script>

{#if view === 'resolved'}
  <a href={href} target="_blank" rel="noopener" class="ytm-btn {className}">
    <span class="ytm-ico" aria-hidden="true">▶</span>
    <span>{label}</span>
  </a>
{:else if view === 'no-match'}
  <button
    type="button"
    class="ytm-btn ytm-btn--disabled {className}"
    disabled
    title="No YouTube Music match for this track"
  >
    <span class="ytm-ico ytm-ico--muted" aria-hidden="true">∅</span>
    <span>No YTM match</span>
  </button>
{:else}
  <button
    type="button"
    class="ytm-btn {className}"
    onclick={resolve}
    disabled={resolving}
    aria-busy={resolving}
    title={errored ? 'Resolve failed — click to retry' : `Resolve ${label}`}
  >
    {#if resolving}
      <span class="ytm-spinner" aria-hidden="true"></span>
      <span>Resolving…</span>
    {:else}
      <span class="ytm-ico" aria-hidden="true">▶</span>
      <span>{errored ? 'Retry YTM' : label}</span>
    {/if}
  </button>
{/if}

<style>
  .ytm-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 600 12px/1 var(--font-mono, ui-monospace, SFMono-Regular, monospace);
    padding: 7px 12px;
    border-radius: var(--r-2, 8px);
    border: 1px solid var(--line, #2a2a2a);
    background: var(--surface, #161616);
    color: var(--fg, #e8e8e8);
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .ytm-btn:hover:not(:disabled) {
    border-color: #ff0033;
    color: var(--fg, #fff);
  }
  .ytm-ico {
    color: #ff0033;
    font-size: 11px;
    line-height: 1;
  }
  .ytm-ico--muted {
    color: var(--fg-quiet, #6a6a6a);
  }
  .ytm-btn:disabled,
  .ytm-btn--disabled {
    cursor: default;
    opacity: 0.5;
  }
  .ytm-spinner {
    width: 11px;
    height: 11px;
    border: 2px solid var(--line, #3a3a3a);
    border-top-color: #ff0033;
    border-radius: 50%;
    animation: ytm-spin 0.6s linear infinite;
  }
  @keyframes ytm-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
