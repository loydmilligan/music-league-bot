<script lang="ts">
  import type { PageData } from './$types.js';
  import ResearchList from '$lib/components/ResearchList.svelte';
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import HeadToHeadCard from '$lib/components/HeadToHeadCard.svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import type { H2HState, H2HCandidate } from '$lib/types.js';

  let { data }: { data: PageData } = $props();

  let tab = $state<'ml' | 'chat' | 'research' | 'h2h'>('ml');
  let ytmMode = $state(false);

  // h2h state — fetched lazily when the tab is first activated, and
  // refreshed from the POST /api/h2h/match response after each pick.
  let h2hState = $state<H2HState | null>(null);
  let h2hLoading = $state(false);
  let h2hError = $state<string | null>(null);

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

  type Phase = 'submissions' | 'voting' | 'review' | 'archived';
  const phaseInfo = $derived.by<{ phase: Phase; duration: string } | null>(() => {
    const sub = durationUntil(data.round.submissionDeadline);
    if (sub) return { phase: 'submissions', duration: sub };
    const vote = durationUntil(data.round.votingDeadline);
    if (vote) return { phase: 'voting', duration: vote };
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

  const tabs: { key: 'ml' | 'chat' | 'research' | 'h2h'; label: string; count: number }[] = $derived([
    { key: 'ml', label: 'ML Playlist', count: data.mlSubmissions.length },
    { key: 'chat', label: 'Chat Mentions', count: data.chatMentions.length },
    { key: 'research', label: 'Research', count: data.research.length },
    { key: 'h2h', label: 'Head-to-Head', count: h2hState?.candidates.length ?? 0 },
  ]);
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
      <h1 class="text-4xl font-bold text-fg mb-3">{data.round.name}</h1>
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
        {#if !phaseInfo && topSong}
          <span aria-hidden="true"> · </span>winner: <span class="text-fg">{topSong.title}</span>
        {/if}
      </p>
    </div>
    <div class="flex-shrink-0 pt-1">
      {#if phaseInfo}
        <DeadlineChip phase={phaseInfo.phase} duration={phaseInfo.duration} />
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
        onclick={() => (tab = t.key)}
        class="font-mono text-sm uppercase tracking-wider py-3 -mb-px border-b-2 transition-colors flex items-center gap-2"
        class:border-accent={tab === t.key}
        class:text-accent={tab === t.key}
        class:font-bold={tab === t.key}
        class:border-transparent={tab !== t.key}
        class:text-fg-muted={tab !== t.key}
        class:hover:text-fg={tab !== t.key}
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
        <div class="flex items-center gap-3 pl-4 pr-4 py-3 bg-surface border-l-2 border-border-muted hover:border-accent transition-colors">
          <span class="font-mono text-xs text-fg-faint w-6 text-right flex-shrink-0">#{s.rank}</span>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-fg truncate">{s.title}</div>
            <div class="text-xs text-fg-muted truncate">
              {s.artists}{s.submitterName ? ` · ${s.submitterName}` : ''}
            </div>
          </div>
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
          />
        </div>
        <div class="flex-1 min-w-0">
          <HeadToHeadCard
            song={challenger}
            role="challenger"
            onPick={() => pickWinner(challenger, champion)}
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
