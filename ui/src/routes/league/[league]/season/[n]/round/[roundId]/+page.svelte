<script lang="ts">
  import type { PageData } from './$types.js';
  import ResearchList from '$lib/components/ResearchList.svelte';
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import HeadToHeadCard from '$lib/components/HeadToHeadCard.svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import HistoryView from '$lib/chat/history/HistoryView.svelte';
  import GuessWorkspace from '$lib/components/GuessWorkspace.svelte';
  import type { H2HState, H2HCandidate } from '$lib/types.js';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  // --- Edit round modal -----------------------------------------------------
  let showEdit = $state(false);
  let editError = $state<string | null>(null);
  let editSaving = $state(false);

  type EditForm = {
    name: string;
    theme: string;
    submission_deadline: string;
    voting_deadline: string;
    playlist_url: string;
  };

  function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    // datetime-local wants yyyy-MM-ddTHH:mm (no seconds, no timezone).
    // The DB stores either 'YYYY-MM-DDTHH:MM' or full ISO; either way, slice
    // to the first 16 chars after normalizing through Date.
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function localInputToIso(local: string): string | null {
    if (!local) return null;
    const d = new Date(local);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }

  let editForm = $state<EditForm>({
    name: '', theme: '', submission_deadline: '', voting_deadline: '', playlist_url: ''
  });

  function openEdit() {
    editError = null;
    editForm = {
      name: data.round.name ?? '',
      theme: data.round.description ?? '',
      submission_deadline: isoToLocalInput(data.round.submissionDeadline),
      voting_deadline: isoToLocalInput(data.round.votingDeadline),
      playlist_url: data.round.spotifyPlaylistUrl ?? '',
    };
    showEdit = true;
  }

  function closeEdit() {
    showEdit = false;
    editError = null;
  }

  async function saveEdit(e?: SubmitEvent) {
    e?.preventDefault();
    if (editSaving) return;
    const diff: Record<string, unknown> = {};
    if (editForm.name !== (data.round.name ?? '')) diff.name = editForm.name;
    if (editForm.theme !== (data.round.description ?? '')) diff.theme = editForm.theme || null;
    const subOrig = isoToLocalInput(data.round.submissionDeadline);
    const voteOrig = isoToLocalInput(data.round.votingDeadline);
    if (editForm.submission_deadline !== subOrig) {
      diff.submission_deadline = localInputToIso(editForm.submission_deadline);
    }
    if (editForm.voting_deadline !== voteOrig) {
      diff.voting_deadline = localInputToIso(editForm.voting_deadline);
    }
    if (editForm.playlist_url !== (data.round.spotifyPlaylistUrl ?? '')) {
      diff.playlist_url = editForm.playlist_url || null;
    }
    if (Object.keys(diff).length === 0) {
      closeEdit();
      return;
    }
    editSaving = true;
    editError = null;
    try {
      const res = await fetch(`/api/rounds/${data.round.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Save failed (${res.status})`);
      }
      await invalidateAll();
      closeEdit();
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Save failed';
    } finally {
      editSaving = false;
    }
  }

  // --- Analyze audio -----------------------------------------------------------
  let analyzeState = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  let analyzeResult = $state<string | null>(null);

  async function analyzeAudio() {
    if (analyzeState === 'running') return;
    analyzeState = 'running';
    analyzeResult = null;
    try {
      const res = await fetch(`/api/rounds/${data.round.id}/analyze-audio`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Analysis failed (${res.status})`);
      }
      const body = await res.json() as { analyzed: number; total: number; message?: string };
      analyzeResult = body.message ?? `${body.analyzed} / ${body.total} tracks analyzed`;
      analyzeState = 'done';
    } catch (err) {
      analyzeResult = err instanceof Error ? err.message : 'Analysis failed';
      analyzeState = 'error';
    }
  }
  // --------------------------------------------------------------------------

  function onKeydown(ev: KeyboardEvent) {
    if (showEdit && ev.key === 'Escape') {
      ev.preventDefault();
      closeEdit();
    }
  }
  // --------------------------------------------------------------------------

  let tab = $state<'ml' | 'chat' | 'history' | 'research' | 'h2h' | 'guess'>('ml');
  let ytmMode = $state(false);

  // h2h state — fetched lazily when the tab is first activated, and
  // refreshed from the POST /api/h2h/match response after each pick.
  let h2hState = $state<H2HState | null>(null);
  let h2hLoading = $state(false);
  let h2hError = $state<string | null>(null);

  // --- ML-tab inline rating editor (sprint-5 rate-anonymous-ml) -------------
  // During voting phase the user can rate anonymous songs (blue dots);
  // during archive phase ratings are still editable but render in the
  // standard accent orange (submitters are revealed).
  let expandedMlSpotifyUri = $state<string | null>(null);
  let mlRatingDraft = $state<{
    themeFit: number | null;
    discoveryPotential: number | null;
    nostalgiaPotential: number | null;
    personalRating: number | null;
  }>({ themeFit: null, discoveryPotential: null, nostalgiaPotential: null, personalRating: null });
  let mlSaving = $state(false);
  let mlError = $state<string | null>(null);

  // Index existing research_songs by spotifyUri so the row reflects saved
  // ratings without an extra fetch — the page loader already returns them.
  const researchBySpotifyUri = $derived.by<Record<string, typeof data.research[number]>>(() => {
    const out: Record<string, typeof data.research[number]> = {};
    for (const r of data.research) out[r.spotifyUri] = r;
    return out;
  });

  const mlRatingsEnabled = $derived(
    data.round.phase === 'voting' || data.round.phase === 'archive'
  );
  const mlRatingDotColor = $derived(data.round.phase === 'voting' ? 'voting' : 'accent');

  function toggleMlRating(s: { spotifyUri: string; title: string; artists: string }) {
    if (expandedMlSpotifyUri === s.spotifyUri) {
      expandedMlSpotifyUri = null;
      mlError = null;
      return;
    }
    expandedMlSpotifyUri = s.spotifyUri;
    mlError = null;
    const existing = researchBySpotifyUri[s.spotifyUri];
    mlRatingDraft = {
      themeFit: existing?.themeFit ?? null,
      discoveryPotential: existing?.discoveryPotential ?? null,
      nostalgiaPotential: existing?.nostalgiaPotential ?? null,
      personalRating: existing?.personalRating ?? null,
    };
  }

  function setMlDot(key: keyof typeof mlRatingDraft, n: number) {
    const current = mlRatingDraft[key];
    mlRatingDraft = { ...mlRatingDraft, [key]: current === n ? null : n };
  }

  async function saveMlRating(s: { spotifyUri: string; title: string; artists: string }) {
    if (mlSaving) return;
    mlSaving = true;
    mlError = null;
    try {
      // (a) POST upserts via INSERT OR IGNORE keyed by (round_id, spotify_uri);
      // always returns the row id whether it was inserted or already existed.
      const postRes = await fetch(`/api/research/${data.round.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotifyUri: s.spotifyUri,
          title: s.title,
          artist: s.artists,
        }),
      });
      if (!postRes.ok) throw new Error(`Create failed (${postRes.status})`);
      const created = await postRes.json();
      // (b) PATCH the ratings onto the now-existing row by id.
      const patchRes = await fetch(`/api/research/${data.round.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: created.id, ...mlRatingDraft }),
      });
      if (!patchRes.ok) throw new Error(`Save failed (${patchRes.status})`);
      await invalidateAll();
      expandedMlSpotifyUri = null;
    } catch (err) {
      mlError = err instanceof Error ? err.message : 'Save failed';
    } finally {
      mlSaving = false;
    }
  }
  // --------------------------------------------------------------------------

  async function fetchH2HState() {
    h2hLoading = true;
    h2hError = null;
    try {
      const res = await fetch(`/api/h2h/state/${data.round.id}`);
      if (!res.ok) throw new Error(`Failed to load h2h state (${res.status})`);
      h2hState = await res.json();
    } catch (err) {
      h2hError = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      h2hLoading = false;
    }
  }

  async function resetH2H() {
    if (!confirm('Reset head-to-head and start over? All matches for this round will be cleared.')) return;
    h2hError = null;
    const prev = h2hState;
    try {
      const res = await fetch(`/api/h2h/state/${data.round.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      const body = await res.json() as { cleared: number; state: H2HState };
      h2hState = body.state;
    } catch (err) {
      h2hError = err instanceof Error ? err.message : 'Reset failed';
      h2hState = prev;
    }
  }

  async function pickWinner(winner: H2HCandidate, loser: H2HCandidate) {
    h2hError = null;
    const prev = h2hState;
    try {
      const res = await fetch('/api/h2h/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: data.round.id, winnerId: winner.id, loserId: loser.id }),
      });
      if (!res.ok) throw new Error(`Match failed (${res.status})`);
      const body = await res.json() as { match: unknown; state: H2HState };
      h2hState = body.state;
    } catch (err) {
      h2hError = err instanceof Error ? err.message : 'Match failed';
      h2hState = prev;
    }
  }

  // Lazy-load h2h state when the tab is first activated. Cache thereafter;
  // pickWinner refreshes state from the POST response so the cache stays
  // in sync without an extra GET round-trip.
  $effect(() => {
    if (tab === 'h2h' && h2hState === null && !h2hLoading && h2hError === null) {
      fetchH2HState();
    }
  });

  function durationUntil(iso: string | null): string | null {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    const ms = ts - Date.now();
    if (ms <= 0) return null;
    const totalH = Math.floor(ms / 3_600_000);
    if (totalH >= 24) return `${Math.floor(totalH / 24)}D ${totalH % 24}H`;
    if (totalH >= 1) return `${totalH}H`;
    return `${Math.max(1, Math.floor(ms / 60_000))}M`;
  }

  // Header chip pair sourced from the canonical phase derivation (lib/lifecycle.ts).
  // The duration string still reads the relevant deadline locally so the chip can
  // refresh during a long-open session.
  const phase = $derived(data.round.phase);
  const remaining = $derived.by(() => {
    if (phase === 'submission') return durationUntil(data.round.submissionDeadline);
    if (phase === 'voting') return durationUntil(data.round.votingDeadline);
    return null;
  });

  const maxPoints = $derived(
    data.mlSubmissions.reduce((m, s) => Math.max(m, s.totalPoints ?? 0), 0)
  );
  function dotsFor(points: number | undefined): number {
    if (!points || !maxPoints) return 0;
    return Math.max(1, Math.round((points / maxPoints) * 5));
  }

  const topSong = $derived(
    [...data.mlSubmissions].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0))[0]
  );

  const tabs: { key: 'ml' | 'chat' | 'history' | 'research' | 'h2h' | 'guess'; label: string; count: number }[] = $derived([
    { key: 'ml',      label: 'ML Playlist',   count: data.mlSubmissions.length },
    { key: 'chat',    label: 'Chat Songs',     count: data.chatMentions.length },
    { key: 'history', label: 'Chat History',   count: data.roundMessageCount },
    { key: 'research', label: 'Research',      count: data.research.length },
    { key: 'h2h',    label: 'Head-to-Head',   count: h2hState?.candidates.length ?? 0 },
    { key: 'guess',  label: 'Guess',          count: data.mlSubmissions.length },
  ]);

  // spec §4: the Guess tab is disabled until the round's playlist exists.
  const guessTabDisabled = $derived(data.mlSubmissions.length === 0);
</script>

<svelte:head><title>{data.round.name} · music-league-bot</title></svelte:head>

<!-- Page header / breadcrumb -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3 truncate">
    <a href="/" class="hover:text-accent transition-colors">music-league-bot</a>
    <span aria-hidden="true"> · </span>
    <span>{data.league.slug}</span>
    <span aria-hidden="true"> · </span>
    <a href="/league/{data.league.slug}/season/{data.season.seasonNumber}" class="hover:text-accent transition-colors">
      season {data.season.seasonNumber}
    </a>
    <span aria-hidden="true"> · </span>
    <span>round {data.round.id}</span>
  </div>

  <div class="flex items-start gap-4">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-3 mb-3">
        <h1 class="text-4xl font-bold text-fg">{data.round.name}</h1>
        <button
          type="button"
          onclick={openEdit}
          aria-label="Edit round"
          title="Edit round"
          class="text-fg-faint hover:text-accent transition-colors text-2xl leading-none flex-shrink-0"
        >✎</button>
      </div>
      {#if data.round.description}
        <p class="text-fg-muted max-w-2xl">{data.round.description}</p>
      {/if}
      <p class="text-fg-dim text-sm mt-2 font-mono">
        {data.mlSubmissions.length} submission{data.mlSubmissions.length === 1 ? '' : 's'}
        {#if data.chatMentions.length}
          <span aria-hidden="true"> · </span>{data.chatMentions.length} chat mention{data.chatMentions.length === 1 ? '' : 's'}
        {/if}
        {#if data.research.length}
          <span aria-hidden="true"> · </span>{data.research.length} in research
        {/if}
        {#if phase === 'archive' && topSong}
          <span aria-hidden="true"> · </span>winner: <span class="text-fg">{topSong.title}</span>
        {/if}
      </p>
    </div>
    <div class="flex-shrink-0 pt-1 flex flex-col items-end gap-2">
      {#if phase === 'submission'}
        <StatusChip label="SUBMITTING" tone="accent" />
        {#if remaining}<DeadlineChip phase="submissions" duration={remaining} />{/if}
      {:else if phase === 'voting'}
        <StatusChip label="VOTING" tone="warn" />
        {#if remaining}<DeadlineChip phase="voting" duration={remaining} />{/if}
      {:else if phase === 'upcoming'}
        <StatusChip label="UPCOMING" tone="muted" />
      {:else}
        <StatusChip label="ARCHIVED" tone="muted" />
      {/if}
    </div>
  </div>
</div>

<!-- Tab strip -->
<div class="border-b border-border-muted mb-6">
  <div class="flex gap-6">
    {#each tabs as t}
      <button
        type="button"
        disabled={t.key === 'guess' && guessTabDisabled}
        onclick={() => (tab = t.key)}
        class="font-mono text-sm uppercase tracking-wider py-3 -mb-px border-b-2 transition-colors flex items-center gap-2"
        class:border-accent={tab === t.key}
        class:text-accent={tab === t.key}
        class:font-bold={tab === t.key}
        class:border-transparent={tab !== t.key}
        class:text-fg-muted={tab !== t.key}
        class:hover:text-fg={tab !== t.key}
        class:opacity-50={t.key === 'guess' && guessTabDisabled}
        class:cursor-not-allowed={t.key === 'guess' && guessTabDisabled}
      >
        <span>{t.label}</span>
        {#if t.count > 0}
          <span class="font-mono text-[10px] text-fg-faint">[{t.count}]</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

{#if tab === 'ml'}
  <div class="flex items-center gap-4 mb-4">
    {#if data.round.spotifyPlaylistUrl}
      <a
        href={data.round.spotifyPlaylistUrl}
        target="_blank"
        rel="noreferrer"
        class="text-health hover:text-health/80 text-sm font-mono transition-colors"
      >Open in Spotify ↗</a>
    {/if}
    <div class="flex items-center gap-1 bg-bg-elevated border border-border-muted rounded-full px-1 py-1 text-xs ml-auto">
      <button
        type="button"
        onclick={() => (ytmMode = false)}
        class="px-3 py-0.5 rounded-full transition-colors font-mono tracking-wider uppercase"
        class:bg-health={!ytmMode}
        class:text-bg={!ytmMode}
        class:font-bold={!ytmMode}
        class:text-fg-dim={ytmMode}
      >Spotify</button>
      <button
        type="button"
        onclick={() => (ytmMode = true)}
        class="px-3 py-0.5 rounded-full transition-colors font-mono tracking-wider uppercase"
        class:bg-accent={ytmMode}
        class:text-white={ytmMode}
        class:font-bold={ytmMode}
        class:text-fg-dim={!ytmMode}
      >YT Music</button>
    </div>
  </div>

  {#if data.mlSubmissions.length === 0}
    <p class="text-fg-faint font-mono text-sm italic">No submissions imported yet.</p>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each data.mlSubmissions as s (s.id)}
        {@const dots = dotsFor(s.totalPoints)}
        {@const research = researchBySpotifyUri[s.spotifyUri]}
        {@const expanded = expandedMlSpotifyUri === s.spotifyUri}
        <div class="flex flex-col bg-surface border-l-2 border-border-muted hover:border-accent transition-colors">
        <div class="flex items-center gap-3 pl-4 pr-4 py-3">
          <span class="font-mono text-xs text-fg-faint w-6 text-right flex-shrink-0">#{s.rank}</span>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-fg truncate">{s.title}</div>
            <div class="text-xs text-fg-muted truncate">
              {s.artists}{s.submitterName ? ` · ${s.submitterName}` : ''}
            </div>
          </div>
          {#if mlRatingsEnabled}
            {@const hasRating = !!research && (research.themeFit != null || research.discoveryPotential != null || research.nostalgiaPotential != null || research.personalRating != null)}
            <button
              type="button"
              onclick={() => toggleMlRating(s)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide rating editor' : (hasRating ? 'Edit rating' : 'Rate this song')}
              class="font-mono text-[10px] tracking-widest uppercase px-2 py-1 rounded-sm border transition-colors flex-shrink-0"
              class:bg-accent-bg={hasRating && mlRatingDotColor === 'accent'}
              class:text-accent={hasRating && mlRatingDotColor === 'accent'}
              class:border-accent-deep={hasRating && mlRatingDotColor === 'accent'}
              class:text-blue-400={hasRating && mlRatingDotColor === 'voting'}
              class:border-blue-500={hasRating && mlRatingDotColor === 'voting'}
              class:text-fg-dim={!hasRating}
              class:border-border-muted={!hasRating}
              class:hover:text-fg={!hasRating}
            >{expanded ? '▾' : '▸'} {hasRating ? 'Rated' : 'Rate'}</button>
          {/if}
          <!-- Vote dots: 5-dot scale, filled proportional to (points / maxPoints). -->
          <div class="flex gap-0.5 flex-shrink-0" aria-label={`${s.totalPoints ?? 0} points`}>
            {#each [1,2,3,4,5] as n}
              <span
                class="w-1.5 h-1.5 rounded-full"
                class:bg-accent={n <= dots}
                class:bg-border-muted={n > dots}
              ></span>
            {/each}
          </div>
          <span class="font-mono text-xs text-fg-dim w-12 text-right flex-shrink-0">
            {s.totalPoints ?? 0} pts
          </span>
          {#if ytmMode}
            <a
              href="/api/ytm/{encodeURIComponent(s.spotifyUri)}?redirect=1"
              target="_blank"
              rel="noreferrer"
              class="text-xs text-accent hover:text-accent-strong font-mono flex-shrink-0 transition-colors"
            >YT Music ↗</a>
          {:else}
            <a
              href={`https://open.spotify.com/track/${s.spotifyUri.replace('spotify:track:', '')}`}
              target="_blank"
              rel="noreferrer"
              class="text-xs text-health hover:text-health/80 font-mono flex-shrink-0 transition-colors"
            >Spotify ↗</a>
          {/if}
        </div>
        {#if mlRatingsEnabled && expanded}
          <!-- Inline rating editor — blue dots during voting, accent orange during archive. -->
          <div class="px-4 pb-3 pt-1 border-t border-border-muted/40">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-3">
              {#each [
                { key: 'themeFit',           label: 'Theme'     },
                { key: 'discoveryPotential', label: 'Discovery' },
                { key: 'nostalgiaPotential', label: 'Nostalgia' },
                { key: 'personalRating',     label: 'Personal'  },
              ] as d}
                {@const v = mlRatingDraft[d.key as keyof typeof mlRatingDraft]}
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim w-20 flex-shrink-0">
                    {d.label}
                  </span>
                  <div class="flex gap-1 items-center" aria-label={`${d.label} ${v ?? 'unrated'}`}>
                    {#each [1, 2, 3, 4, 5] as n}
                      {@const active = v != null && v >= n}
                      <button
                        type="button"
                        onclick={() => setMlDot(d.key as keyof typeof mlRatingDraft, n)}
                        disabled={mlSaving}
                        aria-label={`Set ${d.label} to ${n}`}
                        class="w-2.5 h-2.5 rounded-full border transition-colors disabled:cursor-not-allowed"
                        class:bg-accent={active && mlRatingDotColor === 'accent'}
                        class:border-accent={active && mlRatingDotColor === 'accent'}
                        class:bg-blue-500={active && mlRatingDotColor === 'voting'}
                        class:border-blue-500={active && mlRatingDotColor === 'voting'}
                        class:bg-transparent={!active}
                        class:border-border={!active}
                        class:hover:border-accent-deep={!active && mlRatingDotColor === 'accent'}
                        class:hover:border-blue-500={!active && mlRatingDotColor === 'voting'}
                      ></button>
                    {/each}
                    {#if v != null}
                      <button
                        type="button"
                        onclick={() => setMlDot(d.key as keyof typeof mlRatingDraft, v)}
                        disabled={mlSaving}
                        class="font-mono text-[10px] text-fg-faint hover:text-fg-dim ml-1 transition-colors"
                        aria-label={`Clear ${d.label}`}
                      >clear</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#if mlError}
              <p class="font-mono text-xs text-warn mb-2">{mlError}</p>
            {/if}
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                onclick={() => { expandedMlSpotifyUri = null; mlError = null; }}
                disabled={mlSaving}
                class="font-mono text-[10px] tracking-widest uppercase text-fg-faint hover:text-fg-dim transition-colors"
              >Cancel</button>
              <button
                type="button"
                onclick={() => saveMlRating(s)}
                disabled={mlSaving}
                class="font-mono text-[10px] tracking-widest uppercase px-3 py-1 rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                class:bg-accent={mlRatingDotColor === 'accent'}
                class:hover:bg-accent-strong={mlRatingDotColor === 'accent'}
                class:text-bg-elevated={mlRatingDotColor === 'accent'}
                class:bg-blue-500={mlRatingDotColor === 'voting'}
                class:hover:bg-blue-400={mlRatingDotColor === 'voting'}
                class:text-white={mlRatingDotColor === 'voting'}
              >{mlSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if tab === 'chat'}
  {#if data.chatMentions.length === 0}
    <p class="text-fg-faint font-mono text-sm italic">No chat mentions found for this round's time window.</p>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each data.chatMentions as m}
        <div class="flex items-center gap-3 pl-4 pr-4 py-3 bg-surface border-l-2 border-border-muted">
          <div class="flex-1 min-w-0">
            <div class="font-bold text-fg truncate">{m.trackTitle ?? 'Unknown'}</div>
            <div class="text-xs text-fg-muted truncate">
              {m.trackArtist ?? ''} · {m.submitterName}
            </div>
          </div>
          <span class="font-mono text-[10px] tracking-widest uppercase text-health flex-shrink-0">
            {m.sourcePlatform ?? 'chat'}
          </span>
          <span class="font-mono text-xs text-fg-faint flex-shrink-0">
            {new Date(m.createdAt).toLocaleDateString()}
          </span>
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if tab === 'history'}
  {#if !data.roundGroupName}
    <div class="bg-surface border border-border-muted rounded-xl p-6 max-w-xl">
      <p class="text-fg-muted text-sm">
        Chat not linked for this league yet.
        <a href="/settings/chat" class="text-accent hover:text-accent-strong underline decoration-dotted underline-offset-4 transition-colors">Configure in Settings › Chat</a>.
      </p>
    </div>
  {:else}
    <HistoryView
      rounds={[]}
      groups={[]}
      senders={data.roundSenders}
      selfNames={data.selfNames}
      lockedRound={{
        id: data.round.id,
        name: data.round.name,
        seasonNumber: data.season.seasonNumber,
        fromIso: data.roundFromIso,
        toIso: data.roundToIso,
        platform: data.roundPlatform,
        groupName: data.roundGroupName,
      }}
      lockedMessages={data.roundMessages}
      lockedHasMore={data.roundHasMore}
    />
  {/if}
{/if}

{#if tab === 'research'}
  <ResearchList roundId={data.round.id} initial={data.research} weights={data.settings} />
{/if}

{#if tab === 'h2h'}
  {#if h2hLoading && h2hState === null}
    <p class="text-fg-faint font-mono text-sm italic">Loading head-to-head state…</p>
  {:else if h2hError && h2hState === null}
    <div class="bg-surface border border-warn/40 rounded-xl p-6">
      <StatusChip label="ERROR" tone="warn" />
      <p class="text-fg-muted text-sm mt-3">{h2hError}</p>
      <button
        type="button"
        onclick={fetchH2HState}
        class="mt-3 bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors"
      >Retry</button>
    </div>
  {:else if h2hState}
    {#if h2hState.candidates.length < 2}
      <div class="bg-surface border border-border-muted rounded-xl p-8 text-center max-w-2xl mx-auto">
        <div class="inline-block mb-4"><StatusChip label="NOT READY" tone="muted" /></div>
        <h2 class="text-xl font-bold text-fg mb-2">
          Need at least two research candidates to start head-to-head.
        </h2>
        <p class="text-fg-muted text-sm">
          Add candidates from the
          <button
            type="button"
            onclick={() => (tab = 'research')}
            class="text-accent hover:text-accent-strong underline transition-colors"
          >Research tab</button>
          — eligibility defaults to <code class="font-mono text-fg">status='reviewing'</code>.
        </p>
      </div>
    {:else if h2hState.champion && h2hState.challenger}
      {@const champion = h2hState.champion}
      {@const challenger = h2hState.challenger}
      {#if h2hError}
        <p class="font-mono text-xs text-warn mb-3">{h2hError}</p>
      {/if}
      <div class="flex flex-col md:flex-row gap-6">
        <div class="flex-1 min-w-0">
          <HeadToHeadCard
            song={champion}
            role="holding-lane"
            onPick={() => pickWinner(champion, challenger)}
            roundId={data.round.id}
            weights={data.settings}
          />
        </div>
        <div class="flex-1 min-w-0">
          <HeadToHeadCard
            song={challenger}
            role="challenger"
            onPick={() => pickWinner(challenger, champion)}
            roundId={data.round.id}
            weights={data.settings}
          />
        </div>
      </div>

      {#if h2hState.queue.length > 0}
        <section class="mt-8">
          <SectionLabel>Up next · {h2hState.queue.length} song{h2hState.queue.length === 1 ? '' : 's'}</SectionLabel>
          <ol class="mt-3 flex flex-col gap-1.5">
            {#each h2hState.queue as song, i (song.id)}
              {@const dots = song.weightedScore != null ? Math.max(1, Math.round(song.weightedScore)) : 0}
              <li class="flex items-center gap-3 pl-3 pr-4 py-2.5 bg-surface border-l-2 border-border-muted">
                <span class="font-mono text-xs text-fg-faint w-6 text-right flex-shrink-0">{i + 1}</span>
                <div class="flex-1 min-w-0">
                  <span class="font-bold text-fg truncate">{song.artist}</span>
                  <span class="text-fg-muted truncate"> — {song.title}</span>
                </div>
                <div class="flex gap-0.5 flex-shrink-0" aria-label={`weighted score ${song.weightedScore?.toFixed(2) ?? 'unrated'}`}>
                  {#each [1, 2, 3, 4, 5] as n}
                    <span
                      class="w-1.5 h-1.5 rounded-full"
                      class:bg-accent={n <= dots}
                      class:bg-border-muted={n > dots}
                    ></span>
                  {/each}
                </div>
                <span class="font-mono text-[11px] text-fg-dim w-12 text-right flex-shrink-0">
                  {song.weightedScore != null ? song.weightedScore.toFixed(2) : '—'}
                </span>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      {#if h2hState.retired.length > 0}
        <section class="mt-6">
          <SectionLabel>Retired</SectionLabel>
          <ul class="mt-3 flex flex-col gap-1">
            {#each h2hState.retired as song (song.id)}
              <li class="flex items-center gap-3 pl-3 pr-4 py-1.5 text-sm">
                <span class="text-fg-faint truncate">
                  <span class="font-mono">{song.artist}</span>
                  <span class="text-fg-faint/80"> — {song.title}</span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else if h2hState.isComplete && h2hState.champion}
      {@const champion = h2hState.champion}
      {#if h2hError}
        <p class="font-mono text-xs text-warn mb-3">{h2hError}</p>
      {/if}
      <section class="bg-accent-bg border border-accent-deep rounded-xl p-8 text-center">
        <div class="inline-block mb-4"><StatusChip label="WINNER" tone="accent" /></div>
        <h2 class="font-display font-bold text-fg text-5xl mb-2 leading-tight">
          {champion.artist}
        </h2>
        <p class="text-fg-muted text-2xl mb-4">{champion.title}</p>
        <p class="font-mono text-xs tracking-widest uppercase text-fg-dim mb-6">
          Survived {h2hState.matches.length} match{h2hState.matches.length === 1 ? '' : 'es'}
        </p>
        <button
          type="button"
          onclick={resetH2H}
          class="bg-surface text-fg border border-border-muted hover:bg-surface-hover px-4 py-2 rounded-md font-bold font-mono text-xs tracking-widest uppercase transition-colors"
        >
          Reset and pick again
        </button>
      </section>

      {#if h2hState.retired.length > 0}
        <section class="mt-6">
          <SectionLabel>Retired</SectionLabel>
          <ul class="mt-3 flex flex-col gap-1">
            {#each h2hState.retired as song (song.id)}
              <li class="flex items-center gap-3 pl-3 pr-4 py-1.5 text-sm">
                <span class="text-fg-faint truncate">
                  <span class="font-mono">{song.artist}</span>
                  <span class="text-fg-faint/80"> — {song.title}</span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  {/if}
{/if}

{#if tab === 'guess'}
  <GuessWorkspace roundId={data.round.id} />
{/if}

<svelte:window onkeydown={onKeydown} />

{#if showEdit}
  <!-- Backdrop -->
  <button
    type="button"
    aria-label="Close edit dialog"
    onclick={closeEdit}
    class="fixed inset-0 bg-bg/70 backdrop-blur-sm z-40"
  ></button>

  <!-- Panel -->
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="edit-round-title"
    class="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto pointer-events-none"
  >
    <form
      onsubmit={saveEdit}
      class="pointer-events-auto mt-16 w-full max-w-lg bg-surface border border-border-muted rounded-xl p-6 shadow-2xl"
    >
      <h2 id="edit-round-title" class="text-xl font-bold text-fg mb-1">Edit round</h2>
      <p class="font-mono text-xs text-fg-dim mb-5">r-{data.round.id} · {data.league.slug} season {data.season.seasonNumber}</p>

      <div class="space-y-4">
        <label class="block">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim">Name</span>
          <input
            type="text"
            bind:value={editForm.name}
            required
            class="mt-1 w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg outline-none transition-colors"
          />
        </label>

        <label class="block">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim">Theme</span>
          <input
            type="text"
            bind:value={editForm.theme}
            placeholder="A one-line description / theme prompt"
            class="mt-1 w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg placeholder-fg-faint outline-none transition-colors"
          />
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim">Submit by</span>
            <input
              type="datetime-local"
              bind:value={editForm.submission_deadline}
              class="mt-1 w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg outline-none transition-colors"
            />
          </label>
          <label class="block">
            <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim">Vote by</span>
            <input
              type="datetime-local"
              bind:value={editForm.voting_deadline}
              class="mt-1 w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg outline-none transition-colors"
            />
          </label>
        </div>

        <label class="block">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim">Playlist URL</span>
          <input
            type="url"
            bind:value={editForm.playlist_url}
            placeholder="https://open.spotify.com/playlist/..."
            pattern="https://open\.spotify\.com/playlist/.+"
            class="mt-1 w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg placeholder-fg-faint outline-none transition-colors"
          />
        </label>
      </div>

      {#if editError}
        <p class="font-mono text-xs text-warn mt-4">{editError}</p>
      {/if}

      <!-- Audio analysis row -->
      <div class="flex items-center gap-3 mt-5 pt-4 border-t border-border-muted">
        <button
          type="button"
          onclick={analyzeAudio}
          disabled={analyzeState === 'running'}
          class="bg-bg text-fg-muted border border-border-muted hover:text-fg hover:border-border disabled:opacity-60 disabled:cursor-not-allowed px-4 py-1.5 rounded-md font-mono text-xs tracking-widest uppercase transition-colors"
        >{analyzeState === 'running' ? 'Analyzing…' : '♫ Analyze Audio'}</button>
        {#if analyzeResult}
          <span class="font-mono text-xs {analyzeState === 'error' ? 'text-warn' : 'text-health'}">{analyzeResult}</span>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2 mt-4">
        <button
          type="button"
          onclick={closeEdit}
          disabled={editSaving}
          class="bg-bg text-fg-muted border border-border-muted hover:text-fg hover:border-border px-4 py-1.5 rounded-md font-mono text-xs tracking-widest uppercase transition-colors"
        >Cancel</button>
        <button
          type="submit"
          disabled={editSaving}
          class="bg-accent hover:bg-accent-strong disabled:opacity-60 disabled:cursor-not-allowed text-bg-elevated px-4 py-1.5 rounded-md font-bold font-mono text-xs tracking-widest uppercase transition-colors"
        >{editSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </div>
{/if}
