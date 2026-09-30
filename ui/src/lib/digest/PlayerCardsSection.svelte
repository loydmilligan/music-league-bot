<script lang="ts">
  // Season-recap roster: animated baseball cards (front clip → flip to stats).
  // Synthetic visual section — not a digest_sections row. Media from
  // digests/_media/boarz-s1-cards/, same Coinage URL rules as The Reel.
  import { page } from '$app/state';
  import type { VisualComponentProps } from './variants.js';
  import { BOARZ_S1_PLAYER_CARDS, type PlayerCardsContent, type PlayerCardItem } from './playerCards.js';

  let { content }: VisualComponentProps = $props();
  const c = $derived((content ?? {}) as PlayerCardsContent);
  const cards = $derived((c.cards?.length ? c.cards : BOARZ_S1_PLAYER_CARDS) as PlayerCardItem[]);
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  function safeUrl(url: string | undefined): string {
    const raw = (url ?? '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
    } catch {
      return '';
    }
  }
</script>

<div class="pc-wrap">
  {#if c.note}
    <p class="pc-note">{c.note}</p>
  {/if}
  <div class="pc-grid">
    {#each cards as card (card.slug)}
      {@const src = safeUrl(card.src)}
      {@const poster = safeUrl(card.poster)}
      <figure class="pc-card">
        {#if isExport}
          {#if poster}
            <img src={poster} alt="{card.name} baseball card" />
          {/if}
        {:else if src}
          <!-- svelte-ignore a11y_media_has_caption: card animation has no speech -->
          <video
            src={src}
            poster={poster || undefined}
            autoplay
            muted
            playsinline
            preload="metadata"
            aria-label="{card.hero} — {card.name}"
          ></video>
        {:else if poster}
          <img src={poster} alt="{card.name} baseball card" />
        {/if}
        <figcaption>
          <span class="pc-rank">#{card.rank}</span>
          <span class="pc-name">{card.name}</span>
          <span class="pc-hero">{card.hero}</span>
          <span class="pc-pts">{card.points} pts</span>
        </figcaption>
      </figure>
    {/each}
  </div>
</div>

<style>
  .pc-wrap { padding: 0 0 8px; }
  .pc-note {
    font: italic 15px/1.45 Georgia, serif;
    color: #b8bec6;
    margin: 0 0 18px;
  }
  .pc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }
  .pc-card { margin: 0; }
  .pc-card video, .pc-card img {
    width: 100%;
    aspect-ratio: 1080 / 1512;
    object-fit: contain;
    background: #05060a;
    border: 1px solid #3c454f;
    display: block;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: baseline;
    padding: 8px 2px 0;
    font: 700 11px/1.4 'JetBrains Mono', ui-monospace, monospace;
    letter-spacing: .06em;
    color: #aeb5bb;
  }
  .pc-rank { color: #e8ae57; }
  .pc-name { color: #eee9df; letter-spacing: .04em; }
  .pc-hero { color: #f25b38; font-weight: 600; }
  .pc-pts { margin-left: auto; color: #8a90a6; }
  @media (max-width: 620px) {
    .pc-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  }
</style>
