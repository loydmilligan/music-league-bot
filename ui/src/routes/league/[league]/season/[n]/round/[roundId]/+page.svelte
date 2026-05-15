<script lang="ts">
  import type { PageData } from './$types.js';
  import ResearchList from '$lib/components/ResearchList.svelte';
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';

  let { data }: { data: PageData } = $props();

  let tab = $state<'ml' | 'chat' | 'research'>('ml');
  let ytmMode = $state(false);

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

  const tabs: { key: 'ml' | 'chat' | 'research'; label: string; count: number }[] = $derived([
    { key: 'ml', label: 'ML Playlist', count: data.mlSubmissions.length },
    { key: 'chat', label: 'Chat Mentions', count: data.chatMentions.length },
    { key: 'research', label: 'Research', count: data.research.length },
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
