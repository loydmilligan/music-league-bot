<!--
  Component showcase for the sprint-2 chip/badge atoms. Not linked from
  navigation — visit /_examples to eyeball them against the prototypes.
-->
<script lang="ts">
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import DotIndicator from '$lib/components/DotIndicator.svelte';
  import HeadToHeadCard, { type H2HCardSong } from '$lib/components/HeadToHeadCard.svelte';
  import Rating from '$lib/song/Rating.svelte';
  import SongCard from '$lib/song/SongCard.svelte';
  import SongList from '$lib/song/SongList.svelte';
  import type { Song, SongRatings } from '$lib/song/canonical.js';

  const holdingLane: H2HCardSong = {
    id: 1,
    artist: 'Tom Waits',
    title: 'Hold On',
    themeFit: 5,
    discoveryPotential: 3,
    nostalgiaPotential: 4,
    personalRating: 5,
    notes: 'Cuts straight to the bone — sparse arrangement, lyric does the work. Built for a round about resilience or perseverance; lands hard without ever overplaying its hand.',
    weightedScore: 4.35,
  };

  const challenger: H2HCardSong = {
    id: 2,
    artist: 'Big Thief',
    title: 'Sparrow',
    themeFit: 4,
    discoveryPotential: 5,
    nostalgiaPotential: 2,
    personalRating: 4,
    notes: 'Newer entry, leans on discovery. Adrianne Lenker doing what Adrianne Lenker does — feels like a contender on theme but I keep coming back to whether the production reads on a small speaker.',
    weightedScore: 3.95,
  };

  function pick(which: string) {
    return () => console.log('picked', which);
  }

  const demoRatings: SongRatings = { discovery: 4, themeFit: 3, quality: 5, replayability: 2 };
  const demoRatingsPartial: SongRatings = { discovery: 3, themeFit: null, quality: null, replayability: null };

  const demoSong: Song = {
    id: 'spotify:track:demo1',
    spotifyUri: 'spotify:track:demo1',
    ytmUrl: null,
    title: 'Hold On',
    artist: 'Tom Waits',
    album: 'Mule Variations',
    year: 1999,
    durationSec: 348,
    art: { url: 'https://i.scdn.co/image/ab67616d0000b27341a65d40ebcc80e60e6c14be' },
    ratings: demoRatings,
    metadata: { popularity: { proxy: 42, obscurity: 0.7, bucket: 'deepCut' }, tags: ['folk', 'grit'] },
    context: {},
  };

  const demoSong2: Song = {
    id: 'spotify:track:demo2',
    spotifyUri: 'spotify:track:demo2',
    ytmUrl: null,
    title: 'Sparrow',
    artist: 'Big Thief',
    album: 'Two Hands',
    year: 2019,
    durationSec: 192,
    art: null,
    ratings: demoRatingsPartial,
    metadata: { popularity: { proxy: 28, obscurity: 0.85, bucket: 'rabbitHole' }, tags: ['indie', 'folk'] },
    context: { historyStatus: 'song-mine' },
  };

  let ratingVal = $state({ ...demoRatings });
</script>

<svelte:head><title>Component examples</title></svelte:head>

<div class="space-y-10 max-w-4xl">
  <section class="space-y-3">
    <SectionLabel>Head-to-head card</SectionLabel>
    <div class="grid gap-4 md:grid-cols-2">
      <HeadToHeadCard song={holdingLane} role="holding-lane" onPick={pick('holding-lane')} />
      <HeadToHeadCard song={challenger}  role="challenger"   onPick={pick('challenger')} />
    </div>
  </section>
  <section class="space-y-3">
    <SectionLabel>Deadline chip</SectionLabel>
    <div class="flex flex-wrap gap-2 bg-surface p-4 rounded-md border border-border-muted">
      <DeadlineChip phase="submissions" duration="3D 14H" />
      <DeadlineChip phase="voting" duration="1D 22H" />
      <DeadlineChip phase="review" duration="6H" />
      <DeadlineChip phase="archived" duration="—" />
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Status chip</SectionLabel>
    <div class="flex flex-wrap gap-2 bg-surface p-4 rounded-md border border-border-muted">
      <StatusChip label="2 OPEN" tone="accent" />
      <StatusChip label="WATCHER LIVE" tone="health" />
      <StatusChip label="IDLE" tone="muted" />
      <StatusChip label="STALE" tone="warn" />
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Section label</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-2">
      <SectionLabel>Leagues</SectionLabel>
      <SectionLabel>Cross-league next</SectionLabel>
      <SectionLabel>Active now</SectionLabel>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Dot indicator</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted flex flex-col gap-2 text-fg-muted text-sm">
      <div class="flex items-center gap-2"><DotIndicator status="active" /> hip-jammers — active round</div>
      <div class="flex items-center gap-2"><DotIndicator status="voting" /> second-best — voting</div>
      <div class="flex items-center gap-2"><DotIndicator status="open" /> open-submissions</div>
      <div class="flex items-center gap-2"><DotIndicator status="idle" /> idle league</div>
      <div class="flex items-center gap-2"><DotIndicator status="active" size="md" /> active (md)</div>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Composed: leagues list row</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-2 text-sm">
      <div class="flex items-center gap-3">
        <DotIndicator status="active" />
        <span class="text-fg flex-1">hip-jammers</span>
        <DeadlineChip phase="submissions" duration="3D 14H" />
        <StatusChip label="2 OPEN" tone="accent" />
      </div>
      <div class="flex items-center gap-3">
        <DotIndicator status="voting" />
        <span class="text-fg flex-1">second-best</span>
        <DeadlineChip phase="voting" duration="1D 22H" />
      </div>
      <div class="flex items-center gap-3">
        <DotIndicator status="idle" />
        <span class="text-fg-dim flex-1">archived-league</span>
        <StatusChip label="IDLE" tone="muted" />
      </div>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Rating — all 6 modes</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-6">
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">bars (editable)</p>
        <Rating value={ratingVal} mode="bars" editable onchange={(key, val) => { ratingVal = { ...ratingVal, [key]: val }; }} />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">dots (editable)</p>
        <Rating value={demoRatings} mode="dots" editable />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">fingerprint (editable)</p>
        <Rating value={demoRatings} mode="fingerprint" editable />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">mini (read-only)</p>
        <Rating value={demoRatings} mode="mini" />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">chip (read-only)</p>
        <Rating value={demoRatings} mode="chip" />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">strata (read-only)</p>
        <Rating value={demoRatings} mode="strata" />
      </div>
      <div class="space-y-1">
        <p class="text-fg-muted text-xs">partial ratings (some null)</p>
        <Rating value={demoRatingsPartial} mode="bars" />
      </div>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>SongCard — row + expanded density</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-4">
      <p class="text-fg-muted text-xs">row density (collapses/expands)</p>
      <SongCard song={demoSong} density="row" config={{ ratingMode: 'mini', ratingEditable: true, art: true, layers: ['state','rating','meta','tags'], actions: ['play','shortlist'], actionStyle: 'reveal' }} onAction={(id, s) => console.log('action', id, s.title)} onRate={(r) => console.log('rate', r)} />
      <SongCard song={demoSong2} density="row" config={{ ratingMode: 'mini', art: true, layers: ['state','rating','meta','tags'], actions: ['play','shortlist'], actionStyle: 'reveal' }} />
      <p class="text-fg-muted text-xs mt-4">expanded density</p>
      <SongCard song={demoSong} density="expanded" config={{ ratingMode: 'bars', ratingEditable: true, art: true, layers: ['rating','meta','tags','notes'], actions: ['play','ytm','analyze','remove'], actionStyle: 'inline' }} />
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>SongList — accordion</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted">
      <SongList songs={[demoSong, demoSong2]} density="row" config={{ ratingMode: 'mini', art: true, layers: ['state','rating','tags'], actions: ['play','shortlist'], actionStyle: 'reveal' }} accordion />
    </div>
  </section>
</div>
