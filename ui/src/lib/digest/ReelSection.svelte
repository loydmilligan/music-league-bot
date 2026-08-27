<script lang="ts">
  // ── The Reel · weekly chat slideshow / video ────────────────────────────────
  // Synthetic data-driven section (same family as stats/guesser): content lives
  // on digest_drafts.reel_content_json, never in digest_sections. Media-first by
  // design — a few words at most, the video carries the section. Media follows
  // the Coinage rules (docs/digest-sections.md): served from digests/_media/
  // (absolute URLs only), and a `poster` is mandatory alongside any `src`
  // because the PNG/PDF export screenshots the page and video never captures —
  // ?export=1 prints the still instead.
  import { page } from '$app/state';
  import type { VisualComponentProps } from './variants.js';

  interface ReelContent {
    /** kicker over the media, e.g. "The Week That Was" — optional, keep short */
    title?: string;
    /** one sentence under the media; the section's entire prose budget */
    note?: string;
    media?: { src?: string; poster?: string; alt?: string; caption?: string };
  }

  let { content }: VisualComponentProps = $props();
  const reel = $derived((content ?? {}) as ReelContent);

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  /** The URL, but only if it is one and only if it is http(s). Else empty. */
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

  const src = $derived(safeUrl(reel.media?.src));
  const poster = $derived(safeUrl(reel.media?.poster));
  // Export prints the poster still; without one there is nothing safe to print,
  // so the whole media slot is dropped rather than capturing a blank video.
  const showVideo = $derived(!isExport && !!src);
  const showPoster = $derived(!!poster && (isExport || !src));
  const hasMedia = $derived(showVideo || showPoster);
</script>

{#if hasMedia}
  <div class="reel">
    {#if reel.title}<p class="reel-kicker">{reel.title}</p>{/if}
    <figure class="reel-stage">
      {#if showVideo}
        <video
          src={src}
          poster={poster || undefined}
          autoplay
          loop
          muted
          playsinline
          controls
          aria-label={reel.media?.alt ?? reel.title ?? 'weekly reel'}
        ></video>
      {:else if showPoster}
        <img src={poster} alt={reel.media?.alt ?? reel.title ?? 'weekly reel'} />
      {/if}
      {#if reel.media?.caption}<figcaption>{reel.media.caption}</figcaption>{/if}
    </figure>
    {#if reel.note}<p class="reel-note">{reel.note}</p>{/if}
  </div>
{/if}

<style>
  .reel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .reel-kicker {
    margin: 0;
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .reel-stage {
    margin: 0;
  }
  .reel-stage video,
  .reel-stage img {
    display: block;
    width: 100%;
    max-width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
    background: #000;
  }
  .reel-stage figcaption {
    margin-top: 6px;
    font: 400 11px/1.4 var(--font-mono);
    color: var(--fg-muted);
  }
  .reel-note {
    margin: 0;
    font: 400 13px/1.5 var(--font-body, inherit);
    color: var(--fg);
  }
</style>
