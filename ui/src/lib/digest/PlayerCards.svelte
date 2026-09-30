<script lang="ts">
  // Recap-only roster of Remotion baseball cards. File-backed from
  // digests/_media/boarz-s1-cards/. Export prints posters; web opens the
  // flip-to-stats mp4 in a lightbox (no loop — the back is the landing frame).
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import type { PlayerCardMedia } from './playerCardRoster.js';

  let { cards }: { cards: PlayerCardMedia[] } = $props();

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
  let selectedCard = $state<PlayerCardMedia | null>(null);

  /** Shareable still (front+back composite); falls back to deriving it from the clip URL. */
  function shareImageUrl(card: PlayerCardMedia): string {
    if (card.shareImage) return card.shareImage;
    return `${card.src.replace(/\/[^/]*$/, '')}/share/${card.slug}-front-back.jpg?v2`;
  }
  let modalVideo: HTMLVideoElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let triggerButton: HTMLButtonElement | null = null;

  async function openCard(card: PlayerCardMedia, button: HTMLButtonElement) {
    triggerButton = button;
    document.querySelectorAll<HTMLVideoElement>('.pcards-grid video').forEach((video) => {
      video.pause();
      video.muted = true;
    });
    selectedCard = card;
    await tick();
    closeButton?.focus();
    if (modalVideo) {
      try {
        await modalVideo.play();
      } catch {
        /* Browser media policy — the controls remain available. */
      }
    }
  }

  async function closeCard() {
    modalVideo?.pause();
    selectedCard = null;
    await tick();
    triggerButton?.focus();
    triggerButton = null;
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && selectedCard) {
      event.preventDefault();
      void closeCard();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if cards.length}
  <section class="pcards" data-component="player-cards">
    <div class="dgB-section-head">
      <h2>The cards</h2>
      <span class="deck">intro plays · flips to the season back</span>
    </div>
    <ul class="pcards-grid">
      {#each cards as card (card.slug)}
        <li>
          <figure class="pcards-card">
            {#if isExport}
              <img src={card.poster} alt="{card.name} — {card.hero}" />
            {:else}
              <!-- svelte-ignore a11y_media_has_caption: animated card has no caption track -->
              <video
                src={card.src}
                poster={card.poster}
                playsinline
                preload="metadata"
                aria-label="{card.name} — {card.hero}"
              ></video>
              <button
                type="button"
                class="pcards-hit"
                onclick={(e) => openCard(card, e.currentTarget)}
                aria-label={`Enlarge and play ${card.name}'s card`}
              >
                <span class="pcards-tag">tap to enlarge</span>
              </button>
            {/if}
            <figcaption>
              <span class="pcards-rank">#{card.rank}</span>
              <span class="pcards-name">{card.name}</span>
              <span class="pcards-hero">{card.hero} · {card.points} pts</span>
              <span class="pcards-share">
                <a href={shareImageUrl(card)} target="_blank" rel="noopener">card ↗</a>
                <a href={card.src.split('?')[0]} target="_blank" rel="noopener">video ↗</a>
              </span>
            </figcaption>
          </figure>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if selectedCard}
  <div class="pcards-lightbox" data-component="player-card-lightbox">
    <button
      type="button"
      class="pcards-backdrop"
      aria-label="Close enlarged card"
      onclick={closeCard}
    ></button>
    <div
      class="pcards-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${selectedCard.name} — ${selectedCard.hero}`}
    >
      <button
        bind:this={closeButton}
        type="button"
        class="pcards-close"
        aria-label="Close enlarged card"
        onclick={closeCard}
      >×</button>
      <!-- svelte-ignore a11y_media_has_caption: animated baseball card has no speech -->
      <video
        bind:this={modalVideo}
        src={selectedCard.src}
        poster={selectedCard.poster}
        controls
        autoplay
        playsinline
        preload="auto"
        aria-label={`${selectedCard.name} — ${selectedCard.hero}`}
      ></video>
      <div class="pcards-modal-caption">
        <span class="pcards-rank">#{selectedCard.rank}</span>
        <span class="pcards-name">{selectedCard.name}</span>
        <span class="pcards-hero">{selectedCard.hero} · {selectedCard.points} pts</span>
        <span class="pcards-share">
          <a href={shareImageUrl(selectedCard)} target="_blank" rel="noopener">card ↗</a>
          <a href={selectedCard.src.split('?')[0]} target="_blank" rel="noopener">video ↗</a>
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .pcards {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .pcards-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 720px) {
    .pcards-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  }
  .pcards-card {
    position: relative;
    margin: 0;
  }
  .pcards-card video,
  .pcards-card img {
    display: block;
    width: 100%;
    aspect-ratio: 1080 / 1512;
    object-fit: cover;
    border-radius: var(--r-2);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-3);
    background: #0a0d11;
  }
  .pcards-hit {
    position: absolute;
    inset: 0 0 52px 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .pcards-tag {
    position: absolute;
    left: 8px;
    bottom: 10px;
    padding: 3px 7px;
    border-radius: 999px;
    background: rgba(10, 13, 17, 0.78);
    color: var(--mash-pulp);
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 8px;
    margin-top: 8px;
    min-width: 0;
  }
  .pcards-share {
    flex: 1 1 100%;
    display: flex;
    gap: 12px;
  }
  .pcards-share a {
    font: 600 10px/1.6 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
  .pcards-share a:hover,
  .pcards-share a:focus-visible {
    color: var(--fg);
    border-bottom-style: solid;
  }
  .pcards-rank {
    color: var(--mash-pulp);
    font: 700 10px/1 var(--font-mono);
  }
  .pcards-name {
    color: var(--fg);
    font: 700 12px/1.2 var(--font-body);
  }
  .pcards-hero {
    flex: 1 1 100%;
    color: var(--fg-muted);
    font: italic 400 11px/1.35 var(--font-body);
  }
  .pcards-lightbox {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    padding-bottom: max(16px, env(safe-area-inset-bottom));
  }
  .pcards-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: rgba(4, 6, 10, 0.88);
    cursor: default;
  }
  .pcards-modal {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(560px, 96vw);
    max-height: calc(100dvh - 32px);
    padding: 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    background: #0a0d11;
    box-shadow: var(--shadow-3);
  }
  .pcards-modal video {
    display: block;
    width: auto;
    max-width: 100%;
    max-height: calc(100dvh - 112px);
    aspect-ratio: 1080 / 1512;
    object-fit: contain;
    background: #05060a;
  }
  .pcards-close {
    position: absolute;
    z-index: 2;
    top: 8px;
    right: 8px;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    color: white;
    background: rgba(4, 6, 10, 0.82);
    font: 400 26px/1 var(--font-body);
    cursor: pointer;
  }
  .pcards-modal-caption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 8px;
    width: 100%;
    margin-top: 10px;
  }
  .pcards-modal-caption .pcards-hero {
    flex-basis: auto;
    margin-left: auto;
  }
  @media (max-width: 520px) {
    .pcards-lightbox { padding: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
    .pcards-modal { width: 96vw; max-height: calc(100dvh - 16px); padding: 8px; }
    .pcards-modal video { max-height: calc(100dvh - 92px); }
    .pcards-modal-caption { gap: 4px 6px; }
    .pcards-modal-caption .pcards-hero { flex-basis: 100%; margin-left: 0; }
  }
</style>
