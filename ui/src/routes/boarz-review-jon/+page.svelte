<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import type { PageData } from './$types.js';

  const STORAGE_KEY = 'boarz-jon-review-v1';
  type Answer = { chosenImagePath: string; notes: string };

  let { data }: { data: PageData } = $props();
  let currentIndex = $state(0);
  let submitting = $state(false);
  let submitError = $state('');
  let submittedAt = $state('');
  let storageReady = $state(false);
  let storageMessage = $state('Preparing autosave…');
  let savedLocallyAt = $state('');
  let answers = $state<Record<string, Answer>>({});
  for (const player of data.players) answers[player.slug] = { chosenImagePath: '', notes: '' };

  const current = $derived(data.players[currentIndex]);
  const currentAnswer = $derived(current ? answers[current.slug] : undefined);
  const completeCount = $derived(data.players.filter(player => {
    const answer = answers[player.slug];
    return Boolean(answer?.chosenImagePath && answer.notes.trim());
  }).length);
  const allComplete = $derived(data.players.length === 10 && completeCount === data.players.length);
  const dataLoadedLabel = $derived(data.dataLoadedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, Partial<Answer>>;
        for (const player of data.players) {
          const prior = saved[player.slug];
          if (!prior || typeof prior !== 'object') continue;
          answers[player.slug].notes = typeof prior.notes === 'string' ? prior.notes.slice(0, 5000) : '';
          answers[player.slug].chosenImagePath = typeof prior.chosenImagePath === 'string'
            && player.images.some(image => image.path === prior.chosenImagePath)
            ? prior.chosenImagePath
            : '';
        }
        storageMessage = 'Progress restored';
      } else {
        storageMessage = 'Autosave ready';
      }
      storageReady = true;
    } catch {
      storageMessage = 'Autosave unavailable';
    }
  });

  $effect(() => {
    const snapshot = JSON.stringify(answers);
    if (!browser || !storageReady || submittedAt) return;
    try {
      localStorage.setItem(STORAGE_KEY, snapshot);
      savedLocallyAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      storageMessage = 'Saved locally';
    } catch {
      storageMessage = 'Autosave unavailable';
    }
  });

  function goTo(index: number) {
    currentIndex = Math.max(0, Math.min(data.players.length - 1, index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function chooseImage(path: string) {
    if (!current) return;
    answers[current.slug].chosenImagePath = path;
  }

  function resetProgress() {
    if (!window.confirm('Clear every saved image pick and note? This cannot be undone.')) return;
    for (const player of data.players) answers[player.slug] = { chosenImagePath: '', notes: '' };
    localStorage.removeItem(STORAGE_KEY);
    currentIndex = 0;
    storageMessage = 'Progress reset';
    savedLocallyAt = '';
  }

  async function submitReview() {
    if (!allComplete || submitting) return;
    submitting = true;
    submitError = '';
    try {
      const responses = data.players.map(player => ({ slug: player.slug, ...answers[player.slug] }));
      const response = await fetch('/boarz-review-jon/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses })
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Unable to submit review');
      localStorage.removeItem(STORAGE_KEY);
      submittedAt = payload.submittedAt;
    } catch (error) {
      submitError = error instanceof Error ? error.message : 'Unable to submit review';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Jon's Boarz card review</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

{#if submittedAt}
  <main class="review-shell thanks-shell">
    <section class="thanks-card" aria-live="polite">
      <div class="brand-mark" aria-hidden="true">B</div>
      <p class="eyebrow">Boarz · Season One</p>
      <h1>Thanks, Jon.</h1>
      <p>Your ten image picks and notes were saved. Matt has everything he needs for the next card pass.</p>
      <p class="timestamp">Submitted {new Date(submittedAt).toLocaleString()}</p>
    </section>
  </main>
{:else if current}
  <main class="review-shell">
    <header class="topbar">
      <div class="identity">
        <div class="brand-mark" aria-hidden="true">B</div>
        <div>
          <p class="eyebrow">Boarz · Season One</p>
          <p class="titleline">Jon's card review</p>
        </div>
      </div>
      <div class="progress-copy">
        <div class="save-state" aria-live="polite">
          <strong>{storageMessage}</strong>
          {#if savedLocallyAt}<span>{savedLocallyAt}</span>{/if}
          <button type="button" onclick={resetProgress}>Reset my progress</button>
        </div>
        <div class="progress-count">
          <strong>{currentIndex + 1} of {data.players.length}</strong>
          <span>{completeCount} complete</span>
        </div>
      </div>
    </header>

    <div class="progress-track" aria-label={`${currentIndex + 1} of ${data.players.length}`}>
      <span style={`width: ${((currentIndex + 1) / data.players.length) * 100}%`}></span>
    </div>

    <p class="live-note"><span aria-hidden="true">●</span> Data is live · refreshed from source {dataLoadedLabel}</p>

    <section class="hero">
      <p class="step-label">Player {String(currentIndex + 1).padStart(2, '0')}</p>
      <h1>{current.name}</h1>
      <p class="hero-name">{current.heroName}</p>
    </section>

    <div class="content-grid">
      <section class="brief-stack" aria-label="Character brief">
        <article class="brief-card power-card">
          <p class="card-kicker">Power</p>
          <p>{current.power}</p>
        </article>

        <article class="brief-card">
          <p class="card-kicker">Intro video plan</p>
          <p class="preserve-lines">{current.videoPlan}</p>
          {#if current.draftVideo}
            <!-- svelte-ignore a11y_media_has_caption (review drafts do not have caption files) -->
            <video controls preload="metadata" playsinline src={current.draftVideo.url} aria-label={`${current.name} draft hero video`}></video>
            <p class="media-caption">Draft · {current.draftVideo.name}</p>
          {:else}
            <p class="pending-badge">⚠ No human-reviewed video yet / draft pending.</p>
          {/if}
        </article>

        <article class="brief-card song-card">
          <p class="card-kicker">Chosen song</p>
          <p class="song-title">{current.song.title}</p>
          <p class="song-artist">{current.song.artist}</p>
        </article>
      </section>

      <section class="decision-panel" aria-label={`Review ${current.name}`}>
        <div class="section-heading">
          <div>
            <p class="card-kicker">Hero image</p>
            <h2>Pick one frame</h2>
          </div>
          <span>{current.images.length} candidate{current.images.length === 1 ? '' : 's'}</span>
        </div>

        {#if current.images.length}
          <div class="image-grid">
            {#each current.images as image, index (image.path)}
              <label class:selected={currentAnswer?.chosenImagePath === image.path} class="image-choice">
                <input
                  type="radio"
                  name={`hero-image-${current.slug}`}
                  value={image.path}
                  checked={currentAnswer?.chosenImagePath === image.path}
                  onchange={() => chooseImage(image.path)}
                />
                <span class="check" aria-hidden="true">{currentAnswer?.chosenImagePath === image.path ? '✓' : String(index + 1).padStart(2, '0')}</span>
                <img src={image.url} alt={`${current.name} hero candidate ${index + 1}`} loading="lazy" />
                <span class="image-name">{image.name}</span>
              </label>
            {/each}
          </div>
        {:else}
          <p class="empty-state">No generated PNG candidates are available for this player yet.</p>
        {/if}

        <label class="notes-block">
          <span class="notes-label">Your notes <em>required</em></span>
          <textarea
            bind:value={answers[current.slug].notes}
            maxlength="5000"
            rows="7"
            placeholder="What works? What should change? Be specific about the face, costume, pose, or video beat."
          ></textarea>
          <span class="notes-meta">{answers[current.slug].notes.trim().length} characters</span>
        </label>
      </section>
    </div>

    <footer class="wizard-footer">
      <button class="secondary" type="button" onclick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>← Back</button>
      <div class="step-dots" aria-label="Review progress">
        {#each data.players as player, index (player.slug)}
          <button
            type="button"
            class:active={index === currentIndex}
            class:done={Boolean(answers[player.slug].chosenImagePath && answers[player.slug].notes.trim())}
            onclick={() => goTo(index)}
            aria-label={`Go to ${player.name}, ${index + 1} of ${data.players.length}`}
          ></button>
        {/each}
      </div>
      {#if currentIndex < data.players.length - 1}
        <button class="primary" type="button" onclick={() => goTo(currentIndex + 1)}>Next →</button>
      {:else}
        <button class="primary submit" type="button" onclick={submitReview} disabled={!allComplete || submitting}>
          {submitting ? 'Submitting…' : allComplete ? 'Submit all 10' : `${completeCount} of 10 complete`}
        </button>
      {/if}
    </footer>

    {#if submitError}
      <p class="submit-error" role="alert">{submitError}</p>
    {/if}
  </main>
{:else}
  <main class="review-shell thanks-shell"><p class="empty-state">No review players were found.</p></main>
{/if}

<style>
  :global(body) { margin: 0; background: #0c0f13; color: #f3f0e9; }
  :global(.boarz-site) { min-height: 100vh; background: #0c0f13; }
  .review-shell { min-height: 100vh; max-width: 1480px; margin: 0 auto; padding: 0 34px 48px; font-family: Inter, system-ui, sans-serif; }
  .topbar { min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #343840; }
  .identity { display: flex; align-items: center; gap: 14px; }
  .brand-mark { width: 42px; height: 42px; display: grid; place-items: center; background: #f25b38; color: #11151a; border: 2px solid #8e321f; box-shadow: 4px 4px 0 #37150d; font: 900 italic 24px/1 Georgia, serif; }
  .eyebrow, .card-kicker, .step-label, .progress-copy, .media-caption, .pending-badge, .notes-label, .notes-meta, .image-name, .timestamp { font-family: 'JetBrains Mono', monospace; }
  .eyebrow { margin: 0 0 4px; color: #f25b38; font-size: 10px; line-height: 1.2; letter-spacing: .18em; text-transform: uppercase; }
  .titleline { margin: 0; color: #d8d3ca; font: 700 14px/1.2 'JetBrains Mono', monospace; }
  .progress-copy { display: flex; align-items: center; gap: 28px; color: #777f89; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; }
  .progress-copy strong { color: #f3f0e9; font-size: 14px; }
  .progress-count { display: flex; align-items: baseline; gap: 15px; white-space: nowrap; }
  .save-state { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: 2px 9px; text-align: right; text-transform: none; letter-spacing: .03em; }
  .save-state strong { color: #7fd1a8; font-size: 10px; }
  .save-state span { color: #66717b; font-size: 9px; }
  .save-state button { grid-column: 1 / -1; justify-self: end; padding: 0; color: #818a93; background: transparent; border: 0; border-bottom: 1px solid #4b545d; font: 600 9px/1.5 'JetBrains Mono', monospace; cursor: pointer; }
  .save-state button:hover { color: #f3f0e9; border-color: #f25b38; }
  .progress-track { height: 3px; background: #222831; }
  .progress-track span { display: block; height: 100%; background: #f25b38; transition: width 220ms ease; }
  .live-note { margin: 12px 0 -18px; color: #68727c; font: 600 9px/1.4 'JetBrains Mono', monospace; letter-spacing: .07em; text-align: right; text-transform: uppercase; }
  .live-note span { color: #7fd1a8; }
  .hero { padding: 56px 0 38px; border-bottom: 1px solid #272d35; }
  .step-label { margin: 0 0 10px; color: #7c8590; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; }
  .hero h1 { margin: 0; font: 900 clamp(42px, 7vw, 88px)/.94 Georgia, serif; letter-spacing: -.055em; }
  .hero-name { margin: 13px 0 0; color: #e8ae57; font: 800 clamp(17px, 2vw, 25px)/1.2 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; }
  .content-grid { display: grid; grid-template-columns: minmax(280px, .72fr) minmax(0, 1.5fr); gap: 26px; padding-top: 30px; }
  .brief-stack { display: flex; flex-direction: column; gap: 16px; }
  .brief-card, .decision-panel { background: #141920; border: 1px solid #343c46; }
  .brief-card { padding: 22px; }
  .brief-card p { margin: 0; color: #c4c8cc; line-height: 1.62; font-size: 14px; }
  .brief-card .card-kicker, .card-kicker { margin: 0 0 12px; color: #f25b38; font-size: 10px; line-height: 1.2; letter-spacing: .16em; text-transform: uppercase; }
  .power-card { border-left: 3px solid #e8ae57; }
  .preserve-lines { white-space: pre-line; }
  video { display: block; width: 100%; max-height: 440px; margin-top: 18px; background: #080a0d; border: 1px solid #343c46; }
  .brief-card .media-caption { margin-top: 8px; color: #767f88; font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
  .brief-card .pending-badge { margin-top: 18px; padding: 11px 12px; color: #e8ae57; background: #251f14; border: 1px solid #675437; font-size: 10px; line-height: 1.45; }
  .song-card .song-title { color: #f3f0e9; font: 800 19px/1.25 Georgia, serif; }
  .song-card .song-artist { margin-top: 5px; color: #8f98a2; font: 600 12px/1.4 'JetBrains Mono', monospace; }
  .decision-panel { padding: 26px; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
  .section-heading h2 { margin: 0; font: 800 29px/1.05 Georgia, serif; }
  .section-heading > span { color: #7c8590; font: 650 10px/1.3 'JetBrains Mono', monospace; letter-spacing: .1em; text-transform: uppercase; }
  .image-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .image-choice { position: relative; min-width: 0; background: #0d1116; border: 1px solid #343c46; cursor: pointer; transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease; }
  .image-choice:hover { border-color: #68727e; transform: translateY(-2px); }
  .image-choice.selected { border-color: #f25b38; box-shadow: 0 0 0 2px #f25b3840; }
  .image-choice input { position: absolute; opacity: 0; pointer-events: none; }
  .image-choice img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: contain; background: #080a0d; }
  .check { position: absolute; z-index: 1; top: 9px; left: 9px; min-width: 30px; height: 30px; padding: 0 6px; display: grid; place-items: center; color: #d6d9dc; background: #111820e8; border: 1px solid #59636f; font: 800 10px/1 'JetBrains Mono', monospace; }
  .selected .check { color: #11151a; background: #f25b38; border-color: #f25b38; font-size: 15px; }
  .image-name { display: block; padding: 10px; color: #8e969f; font-size: 9px; line-height: 1.35; overflow-wrap: anywhere; }
  .empty-state { margin: 0; padding: 28px; color: #e8ae57; background: #251f14; border: 1px solid #675437; font: 650 12px/1.5 'JetBrains Mono', monospace; }
  .notes-block { display: block; margin-top: 28px; }
  .notes-label { display: flex; justify-content: space-between; color: #d9dde0; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; }
  .notes-label em { color: #f25b38; font-style: normal; }
  textarea { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 15px; resize: vertical; color: #f3f0e9; background: #0d1116; border: 1px solid #46515d; border-radius: 0; font: 14px/1.55 Inter, system-ui, sans-serif; }
  textarea:focus { outline: 2px solid #f25b38; outline-offset: 1px; border-color: #f25b38; }
  .notes-meta { display: block; margin-top: 7px; color: #69727c; font-size: 9px; text-align: right; }
  .wizard-footer { position: sticky; bottom: 0; z-index: 5; display: grid; grid-template-columns: minmax(120px, 1fr) auto minmax(120px, 1fr); align-items: center; gap: 22px; margin-top: 28px; padding: 17px 0; background: linear-gradient(to bottom, #0c0f1300, #0c0f13 25%); }
  .wizard-footer > button { min-height: 46px; padding: 0 20px; border: 1px solid #4a545f; font: 800 11px/1 'JetBrains Mono', monospace; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
  .secondary { justify-self: start; color: #c7ccd0; background: #171c22; }
  .primary { justify-self: end; color: #11151a; background: #f25b38; border-color: #f25b38 !important; }
  .wizard-footer > button:disabled { opacity: .35; cursor: not-allowed; }
  .step-dots { display: flex; align-items: center; gap: 8px; }
  .step-dots button { width: 9px; height: 9px; padding: 0; border: 1px solid #59636f; border-radius: 50%; background: transparent; cursor: pointer; }
  .step-dots button.done { background: #e8ae57; border-color: #e8ae57; }
  .step-dots button.active { transform: scale(1.45); border-color: #f25b38; box-shadow: 0 0 0 2px #f25b3838; }
  .submit-error { margin: 0; padding: 12px; color: #ff9a80; background: #2d1713; border: 1px solid #873927; font: 650 11px/1.5 'JetBrains Mono', monospace; text-align: center; }
  .thanks-shell { display: grid; place-items: center; padding-top: 40px; padding-bottom: 40px; }
  .thanks-card { width: min(620px, 100%); box-sizing: border-box; padding: 54px; background: #141920; border: 1px solid #4a535d; box-shadow: 10px 10px 0 #1e242b; text-align: center; }
  .thanks-card .brand-mark { margin: 0 auto 25px; }
  .thanks-card h1 { margin: 8px 0 15px; font: 900 clamp(44px, 8vw, 76px)/.95 Georgia, serif; letter-spacing: -.05em; }
  .thanks-card > p:not(.eyebrow):not(.timestamp) { margin: 0 auto; max-width: 470px; color: #b8bec4; line-height: 1.65; }
  .thanks-card .timestamp { margin: 25px 0 0; color: #717b85; font-size: 9px; letter-spacing: .09em; text-transform: uppercase; }
  @media (max-width: 960px) {
    .content-grid { grid-template-columns: 1fr; }
    .brief-stack { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .power-card { grid-column: 1 / -1; }
  }
  @media (max-width: 700px) {
    .review-shell { padding: 0 18px 30px; }
    .topbar { min-height: 76px; }
    .progress-copy { gap: 12px; }
    .progress-count span, .save-state > span { display: none; }
    .save-state { grid-template-columns: 1fr; }
    .save-state button { grid-column: 1; }
    .live-note { margin-bottom: -9px; text-align: left; }
    .hero { padding: 40px 0 28px; }
    .brief-stack { display: flex; }
    .decision-panel { padding: 18px; }
    .image-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .wizard-footer { grid-template-columns: 1fr 1fr; gap: 10px; }
    .step-dots { grid-column: 1 / -1; grid-row: 1; justify-content: center; }
    .wizard-footer > button { grid-row: 2; width: 100%; }
    .secondary, .primary { justify-self: stretch; }
    .thanks-card { padding: 38px 24px; }
  }
</style>
