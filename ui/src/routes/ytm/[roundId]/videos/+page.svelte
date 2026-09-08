<script lang="ts">
  import type { PageData } from './$types.js';
  import { invalidateAll } from '$app/navigation';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import type { VideoPick } from '$lib/ytm/videoReview.js';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let err = $state<string | null>(null);
  let done = $state<string | null>(null);

  const picks = $derived(data.review.picks);
  const byBand = (b: VideoPick['band']) => picks.filter((p) => p.band === b);
  const undecided = $derived(picks.filter((p) => p.band === 'review' && !p.decided));
  const included = $derived(picks.filter((p) => p.included && p.chosen));
  const isOpen = $derived(data.review.status === 'pending');

  async function patch(decisions: Array<{ spotifyUri: string; chosen?: string | null; included?: boolean }>) {
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

  const choose = (p: VideoPick, videoId: string | null) =>
    patch([{ spotifyUri: p.spotifyUri, chosen: videoId, included: videoId !== null }]);
  const setIncluded = (p: VideoPick, on: boolean) => patch([{ spotifyUri: p.spotifyUri, included: on }]);

  async function post(action: 'approve' | 'deny' | 'snooze') {
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
      done = action === 'approve'
        ? 'Approved — building the playlist and posting it now.'
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

  {#if data.review.status === 'sent' && data.review.videoUrl}
    <p class="text-sm text-fg-muted">
      Posted: <a class="text-accent underline" href={data.review.videoUrl}>{data.review.videoUrl}</a>
    </p>
  {/if}

  <!-- Summary bar: the two numbers that decide whether OK is pressable. -->
  <div class="flex flex-wrap items-center gap-3 bg-surface border border-border-muted rounded-xl px-4 py-3">
    <span class="font-mono text-xs text-fg-muted">{included.length} in the playlist</span>
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
          disabled={busy || !isOpen || !p.chosen}
          onchange={(e) => setIncluded(p, e.currentTarget.checked)}
          aria-label="Include {p.title}"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm text-fg truncate">{p.title}</p>
          <p class="font-mono text-[10px] text-fg-faint truncate">{p.artists}</p>

          {#if p.candidates.length === 0}
            <p class="text-xs text-fg-dim mt-1">{p.reason ?? 'No video found.'}</p>
          {:else if !opts.alternatives}
            {@const c = p.candidates.find((x) => x.videoId === p.chosen) ?? p.candidates[0]}
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
            <!-- Alternatives: search's second guess is often the right one when
                 the first is a cover, so all three are offered rather than
                 forcing a yes/no on the top hit. -->
            <div class="mt-2 space-y-1">
              {#each p.candidates as c (c.videoId)}
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pick-{p.spotifyUri}"
                    class="accent-accent"
                    checked={p.chosen === c.videoId}
                    disabled={busy || !isOpen}
                    onchange={() => choose(p, c.videoId)}
                  />
                  <img src={thumb(c.videoId)} alt="" class="w-16 rounded" loading="lazy" />
                  <span class="min-w-0 flex-1">
                    <a href={yt(c.videoId)} target="_blank" rel="noreferrer" class="block text-xs text-fg-muted hover:text-accent truncate">{c.title}</a>
                    <span class="block font-mono text-[10px] text-fg-faint truncate">{c.channel} · {c.score}%</span>
                  </span>
                </label>
              {/each}
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pick-{p.spotifyUri}"
                  class="accent-accent"
                  checked={p.chosen === null}
                  disabled={busy || !isOpen}
                  onchange={() => choose(p, null)}
                />
                <span class="text-xs text-fg-dim">No video for this one</span>
              </label>
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
      {#each byBand('certain') as p (p.spotifyUri)}{@render pickRow(p, { alternatives: false })}{/each}
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
        {busy ? 'Working…' : `OK — post ${included.length} video${included.length === 1 ? '' : 's'}`}
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
