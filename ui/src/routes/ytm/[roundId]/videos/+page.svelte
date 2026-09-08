<script lang="ts">
  import type { PageData } from './$types.js';
  import { invalidateAll } from '$app/navigation';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import type { VideoPick, PickDecision } from '$lib/ytm/videoReview.js';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let err = $state<string | null>(null);
  let done = $state<string | null>(null);

  const picks = $derived(data.review.picks);
  const byBand = (b: VideoPick['band']) => picks.filter((p) => p.band === b);
  const undecided = $derived(picks.filter((p) => p.band === 'review' && !p.decided));
  const included = $derived(picks.filter((p) => p.included && p.chosen.length));
  const videoCount = $derived(picks.reduce((n, p) => n + (p.included ? p.chosen.length : 0), 0));
  const isOpen = $derived(data.review.status === 'pending');

  async function patch(decisions: PickDecision[]) {
    busy = true; err = null;
    try {
      const res = await fetch(`/api/ytm/video-review/${data.review.roundId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      if (!res.ok) throw new Error((await res.text()) || `save failed (${res.status})`);
      await invalidateAll();
    } catch (e) {
      err = e instanceof Error ? e.message : 'Save failed';
    } finally {
      busy = false;
    }
  }

  /** Toggle one candidate in or out of this song's selection. */
  function toggleVideo(p: VideoPick, videoId: string, on: boolean) {
    const next = on ? [...p.chosen, videoId] : p.chosen.filter((id) => id !== videoId);
    return patch([{ spotifyUri: p.spotifyUri, chosen: next }]);
  }
  /** Answer a review pick with "nothing" — a real answer, not an absence. */
  const chooseNone = (p: VideoPick) => patch([{ spotifyUri: p.spotifyUri, chosen: [] }]);
  const setIncluded = (p: VideoPick, on: boolean) => patch([{ spotifyUri: p.spotifyUri, included: on }]);

  // ---- adding a video by hand -------------------------------------------
  let addUrl = $state<Record<string, string>>({});
  let addError = $state<Record<string, string | null>>({});

  async function addByUrl(p: VideoPick) {
    const raw = (addUrl[p.spotifyUri] ?? '').trim();
    if (!raw) return;
    addError = { ...addError, [p.spotifyUri]: null };
    const before = p.chosen.length;
    await patch([{ spotifyUri: p.spotifyUri, addVideo: raw }]);
    // The server is the only thing that can parse it, so "did it take?" is the
    // honest test — a link it could not read leaves the selection unchanged.
    const after = picks.find((x) => x.spotifyUri === p.spotifyUri)?.chosen.length ?? before;
    if (after === before) addError = { ...addError, [p.spotifyUri]: "Couldn't read a YouTube video id from that." };
    else addUrl = { ...addUrl, [p.spotifyUri]: '' };
  }

  // ---- searching youtube myself -----------------------------------------
  type Hit = { videoId: string; title: string; channel: string };
  let searchOpen = $state<Record<string, boolean>>({});
  let searchQ = $state<Record<string, string>>({});
  let searchHits = $state<Record<string, Hit[]>>({});
  let searchBusy = $state<Record<string, boolean>>({});
  let searchErr = $state<Record<string, string | null>>({});

  function openSearch(p: VideoPick) {
    searchOpen = { ...searchOpen, [p.spotifyUri]: !searchOpen[p.spotifyUri] };
    if (searchQ[p.spotifyUri] === undefined) {
      searchQ = { ...searchQ, [p.spotifyUri]: `${p.title} ${p.artists}` };
    }
  }

  async function runSearch(p: VideoPick) {
    const q = (searchQ[p.spotifyUri] ?? '').trim();
    if (!q) return;
    searchBusy = { ...searchBusy, [p.spotifyUri]: true };
    searchErr = { ...searchErr, [p.spotifyUri]: null };
    try {
      const res = await fetch(`/api/ytm/video-review/${data.review.roundId}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.reason ?? `search failed (${res.status})`);
      searchHits = { ...searchHits, [p.spotifyUri]: body.results as Hit[] };
    } catch (e) {
      searchErr = { ...searchErr, [p.spotifyUri]: e instanceof Error ? e.message : 'Search failed' };
    } finally {
      searchBusy = { ...searchBusy, [p.spotifyUri]: false };
    }
  }

  const addHit = (p: VideoPick, h: Hit) =>
    patch([{ spotifyUri: p.spotifyUri, addVideo: h.videoId, addVideoTitle: h.title, addVideoChannel: h.channel }]);

  async function post(action: 'approve' | 'deny' | 'snooze' | 'retry') {
    if (action === 'approve' && undecided.length) return;
    busy = true; err = null;
    try {
      // The in-app route, NOT /api/ytm/video-review/<action> — those are the
      // public ntfy callbacks and require the shared bearer the browser must
      // never hold. This one authorizes like the rest of the app.
      const res = await fetch(`/api/ytm/video-review/${data.review.roundId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.reason ?? `${action} failed (${res.status})`);
      done = action === 'approve' || action === 'retry'
        ? 'Building the playlist and posting it now.'
        : action === 'deny' ? 'Denied. No video playlist will be posted for this round.'
        : 'Snoozed. You will be nudged again in four hours.';
      await invalidateAll();
    } catch (e) {
      err = e instanceof Error ? e.message : `${action} failed`;
    } finally {
      busy = false;
    }
  }

  const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
  const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
</script>

<svelte:head><title>{data.roundName} — video playlist review</title></svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8 space-y-6">
  <header>
    <p class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">{data.leagueTitle}</p>
    <h1 class="text-2xl font-bold text-fg">{data.roundName}</h1>
    <p class="text-sm text-fg-dim mt-1">
      Music-video playlist review ·
      {#if data.review.status === 'pending'}
        <span class="text-amber">waiting on you</span>
      {:else}
        <span class="text-fg-muted">{data.review.status}</span>
      {/if}
    </p>
  </header>

  {#if done}
    <p class="bg-surface border border-accent rounded-lg px-4 py-3 text-sm text-fg">{done}</p>
  {/if}
  {#if err}
    <p class="bg-surface border border-ember rounded-lg px-4 py-3 text-sm text-ember">{err}</p>
  {/if}

  {#if data.review.status === 'failed'}
    <!-- The token is gone by now, so the page IS the only way back in. -->
    <div class="bg-surface border border-ember rounded-lg px-4 py-3 space-y-2">
      <p class="text-sm text-ember">Posting failed: {data.review.error}</p>
      <p class="text-xs text-fg-dim">
        Your choices are saved. Rate limits and dropped sessions are usually over in a minute or two.
      </p>
      <button
        type="button"
        onclick={() => post('retry')}
        disabled={busy}
        class="bg-accent hover:bg-accent-strong disabled:opacity-40 text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
      >
        {busy ? 'Working…' : 'Try again'}
      </button>
    </div>
  {/if}

  {#if data.review.status === 'sent' && data.review.videoUrl}
    <p class="text-sm text-fg-muted">
      Posted: <a class="text-accent underline" href={data.review.videoUrl}>{data.review.videoUrl}</a>
    </p>
  {/if}

  <!-- Summary bar: the two numbers that decide whether OK is pressable. -->
  <div class="flex flex-wrap items-center gap-3 bg-surface border border-border-muted rounded-xl px-4 py-3">
    <span class="font-mono text-xs text-fg-muted">{videoCount} video{videoCount === 1 ? '' : 's'} from {included.length} song{included.length === 1 ? '' : 's'}</span>
    {#if undecided.length}
      <StatusChip label="{undecided.length} NEED YOUR CALL" tone="warn" />
    {:else if isOpen}
      <StatusChip label="READY" tone="accent" />
    {/if}
    {#if data.review.audioSent}
      <span class="font-mono text-[10px] text-fg-faint">audio playlist already posted</span>
    {:else}
      <span class="font-mono text-[10px] text-fg-faint">audio playlist will post first</span>
    {/if}
  </div>

  {#snippet pickRow(p: VideoPick, opts: { alternatives: boolean })}
    <div class="border-t border-border-muted py-3">
      <div class="flex items-start gap-3">
        <input
          type="checkbox"
          class="mt-1 accent-accent"
          checked={p.included}
          disabled={busy || !isOpen || p.chosen.length === 0}
          onchange={(e) => setIncluded(p, e.currentTarget.checked)}
          aria-label="Include {p.title}"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm text-fg truncate">
            {p.title}
            {#if p.chosen.length > 1}
              <span class="font-mono text-[10px] text-accent">· {p.chosen.length} videos</span>
            {/if}
          </p>
          <p class="font-mono text-[10px] text-fg-faint truncate">{p.artists}</p>

          {#if p.candidates.length === 0 && !opts.alternatives}
            <p class="text-xs text-fg-dim mt-1">{p.reason ?? 'No video found.'}</p>
          {:else if !opts.alternatives}
            {@const c = p.candidates.find((x) => p.chosen.includes(x.videoId)) ?? p.candidates[0]}
            <a href={yt(c.videoId)} target="_blank" rel="noreferrer" class="mt-1 flex items-center gap-2 group">
              <img src={thumb(c.videoId)} alt="" class="w-20 rounded" loading="lazy" />
              <span class="min-w-0">
                <span class="block text-xs text-fg-muted group-hover:text-accent truncate">{c.title}</span>
                <span class="block font-mono text-[10px] text-fg-faint truncate">
                  {c.channel ?? 'submitter’s link'}{p.source === 'search' ? ` · ${c.score}%` : ''}
                </span>
              </span>
            </a>
          {:else}
            <!-- Checkboxes, not radios: a song can carry more than one video.
                 Search's second guess is also often the right one when the first
                 is a cover, so all the candidates stay on offer. -->
            <div class="mt-2 space-y-1">
              {#each p.candidates as c (c.videoId)}
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    class="accent-accent"
                    checked={p.chosen.includes(c.videoId)}
                    disabled={busy || !isOpen}
                    onchange={(e) => toggleVideo(p, c.videoId, e.currentTarget.checked)}
                  />
                  <img src={thumb(c.videoId)} alt="" class="w-16 rounded" loading="lazy" />
                  <span class="min-w-0 flex-1">
                    <a href={yt(c.videoId)} target="_blank" rel="noreferrer" class="block text-xs text-fg-muted hover:text-accent truncate">{c.title}</a>
                    <span class="block font-mono text-[10px] text-fg-faint truncate">
                      {c.channel}{c.manual ? ' · added by you' : ` · ${c.score}%`}
                    </span>
                  </span>
                </label>
              {/each}

              {#if p.band === 'review'}
                <button
                  type="button"
                  onclick={() => chooseNone(p)}
                  disabled={busy || !isOpen}
                  class="font-mono text-[10px] tracking-widest uppercase {p.decided && p.chosen.length === 0 ? 'text-accent' : 'text-fg-dim hover:text-fg'} transition-colors"
                >
                  {p.decided && p.chosen.length === 0 ? '✓ no video for this one' : 'No video for this one'}
                </button>
              {/if}

              {#if isOpen}
                <div class="pt-1 flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    placeholder="Paste a YouTube link…"
                    value={addUrl[p.spotifyUri] ?? ''}
                    oninput={(e) => (addUrl = { ...addUrl, [p.spotifyUri]: e.currentTarget.value })}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addByUrl(p); } }}
                    disabled={busy}
                    class="flex-1 min-w-[180px] bg-bg-elevated border border-border-muted rounded px-2 py-1 text-xs text-fg placeholder-fg-faint outline-none focus:border-accent"
                  />
                  <button type="button" onclick={() => addByUrl(p)} disabled={busy}
                    class="font-mono text-[10px] tracking-widest uppercase text-fg-dim hover:text-accent transition-colors">Add</button>
                  <button type="button" onclick={() => openSearch(p)} disabled={busy}
                    class="font-mono text-[10px] tracking-widest uppercase text-fg-dim hover:text-accent transition-colors">
                    {searchOpen[p.spotifyUri] ? 'Close search' : 'Search YouTube'}
                  </button>
                </div>
                {#if addError[p.spotifyUri]}
                  <p class="text-[11px] text-ember">{addError[p.spotifyUri]}</p>
                {/if}
              {/if}

              {#if searchOpen[p.spotifyUri]}
                <div class="mt-1 border border-border-muted rounded p-2 space-y-2">
                  <div class="flex gap-2">
                    <input
                      type="text"
                      value={searchQ[p.spotifyUri] ?? ''}
                      oninput={(e) => (searchQ = { ...searchQ, [p.spotifyUri]: e.currentTarget.value })}
                      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(p); } }}
                      class="flex-1 bg-bg-elevated border border-border-muted rounded px-2 py-1 text-xs text-fg outline-none focus:border-accent"
                    />
                    <button type="button" onclick={() => runSearch(p)} disabled={searchBusy[p.spotifyUri]}
                      class="font-mono text-[10px] tracking-widest uppercase text-fg-dim hover:text-accent transition-colors">
                      {searchBusy[p.spotifyUri] ? '…' : 'Go'}
                    </button>
                  </div>
                  {#if searchErr[p.spotifyUri]}
                    <p class="text-[11px] text-ember">{searchErr[p.spotifyUri]}</p>
                  {/if}
                  {#each searchHits[p.spotifyUri] ?? [] as h (h.videoId)}
                    <div class="flex items-center gap-2">
                      <img src={thumb(h.videoId)} alt="" class="w-16 rounded" loading="lazy" />
                      <span class="min-w-0 flex-1">
                        <a href={yt(h.videoId)} target="_blank" rel="noreferrer" class="block text-xs text-fg-muted hover:text-accent truncate">{h.title}</a>
                        <span class="block font-mono text-[10px] text-fg-faint truncate">{h.channel}</span>
                      </span>
                      <button type="button" onclick={() => addHit(p, h)} disabled={busy || p.chosen.includes(h.videoId)}
                        class="font-mono text-[10px] tracking-widest uppercase text-fg-dim hover:text-accent disabled:opacity-40 transition-colors">
                        {p.chosen.includes(h.videoId) ? 'added' : 'use'}
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}

  {#if undecided.length || byBand('review').length}
    <section class="bg-surface border border-amber/40 rounded-xl px-5 py-4">
      <h2 class="text-sm font-bold text-fg">Needs your call</h2>
      <p class="text-xs text-fg-dim mt-1 mb-2">
        Plausible but not certain — scored between {data.review.config.hilPct}% and {data.review.config.searchAutoAcceptPct}%.
        Every one of these has to be answered before the playlist can post. "No video for this one" counts as an answer.
      </p>
      {#each byBand('review') as p (p.spotifyUri)}{@render pickRow(p, { alternatives: true })}{/each}
    </section>
  {/if}

  {#if byBand('certain').length}
    <section class="bg-surface border border-border-muted rounded-xl px-5 py-4">
      <h2 class="text-sm font-bold text-fg">From submission comments</h2>
      <p class="text-xs text-fg-dim mt-1 mb-2">The link the submitter posted themselves. Untick to leave one out.</p>
      {#each byBand('certain') as p (p.spotifyUri)}{@render pickRow(p, { alternatives: true })}{/each}
    </section>
  {/if}

  {#if byBand('auto').length}
    <section class="bg-surface border border-border-muted rounded-xl px-5 py-4">
      <h2 class="text-sm font-bold text-fg">Found automatically</h2>
      <p class="text-xs text-fg-dim mt-1 mb-2">
        Scored {data.review.config.searchAutoAcceptPct}% or better, so they are in by default. Untick any that look wrong.
      </p>
      {#each byBand('auto') as p (p.spotifyUri)}{@render pickRow(p, { alternatives: true })}{/each}
    </section>
  {/if}

  {#if byBand('suggestion').length}
    <section class="bg-surface border border-border-muted rounded-xl px-5 py-4">
      <h2 class="text-sm font-bold text-fg">Long shots</h2>
      <p class="text-xs text-fg-dim mt-1 mb-2">
        Below {data.review.config.hilPct}% — usually covers, fan uploads, or songs with no real video.
        Left out unless you pick one. These don't block anything.
      </p>
      {#each byBand('suggestion') as p (p.spotifyUri)}{@render pickRow(p, { alternatives: true })}{/each}
    </section>
  {/if}

  {#if isOpen}
    <div class="sticky bottom-0 bg-bg/95 backdrop-blur border-t border-border-muted py-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onclick={() => post('approve')}
        disabled={busy || undecided.length > 0}
        title={undecided.length ? `${undecided.length} still need an answer` : 'Build the playlist and post it'}
        class="bg-accent hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-5 py-2 rounded-md transition-colors"
      >
        {busy ? 'Working…' : `OK — post ${videoCount} video${videoCount === 1 ? '' : 's'}`}
      </button>
      <button type="button" onclick={() => post('snooze')} disabled={busy}
        class="font-mono text-[11px] tracking-widest uppercase text-fg-dim hover:text-fg transition-colors">Snooze 4h</button>
      <button type="button" onclick={() => post('deny')} disabled={busy}
        class="ml-auto font-mono text-[11px] tracking-widest uppercase text-fg-dim hover:text-ember transition-colors">Deny</button>
      {#if undecided.length}
        <p class="w-full font-mono text-[10px] text-amber">
          {undecided.length} video{undecided.length === 1 ? '' : 's'} still need an answer above.
        </p>
      {/if}
    </div>
  {/if}
</div>
