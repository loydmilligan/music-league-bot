<script lang="ts">
  // ── The Reel · Register B (Newsroom) ────────────────────────────────────────
  // Built to design_handoff_reel_section/README.md (docs/Reel section
  // mockups.zip). A per-round looping video framed as an editorial unit: the
  // .dgB-section-head from digest.css, a square 480px frame with four static
  // decorative overlays (grain, accent glow, letterbox top/bottom), and one
  // italic caption line. No player UI — autoplay muted loop, no controls.
  //
  // Synthetic data-driven section (stats/guesser family): content lives on
  // digest_drafts.reel_content_json. Media follows the Coinage rules
  // (docs/digest-sections.md): served from digests/_media/, absolute http(s)
  // URLs only, `poster` mandatory alongside `src` — the PNG export screenshots
  // a still (?export=1 prints the poster inside the same frame).
  //
  // The handoff's pulled-quote overlay is a prototype stand-in for the video's
  // own burned-in content and is intentionally not rendered. The waveform IS
  // implemented but content can switch it off (waveform:false) when the render
  // carries its own sound bed visuals.
  import { page } from '$app/state';
  import type { VisualComponentProps } from './variants.js';

  type ReelAccent = 'pulp' | 'amber' | 'sky' | 'moss' | 'ember';

  interface ReelContent {
    /** eyebrow override — rendered by DigestSection, NOT here */
    title?: string;
    /** the italic caption line under the frame (README §3) */
    note?: string;
    media?: { src?: string; poster?: string; alt?: string; caption?: string };
    /** README §Configurable options — defaults: pulp, all layers on */
    accent?: ReelAccent;
    waveform?: boolean;
    letterbox?: boolean;
    grain?: boolean;
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
  // so the whole section is dropped rather than capturing a blank video.
  const showVideo = $derived(!isExport && !!src);
  const showPoster = $derived(!!poster && (isExport || !src));
  const hasMedia = $derived(showVideo || showPoster);

  // Accent RGB triples (README §Configurable options).
  const ACCENT_RGB: Record<ReelAccent, string> = {
    pulp: '255,91,46',
    amber: '232,168,58',
    sky: '92,163,214',
    moss: '74,178,120',
    ember: '230,86,108',
  };
  const accentRgb = $derived(ACCENT_RGB[reel.accent ?? 'pulp'] ?? ACCENT_RGB.pulp);
  const showWaveform = $derived(reel.waveform ?? true);
  const showLetterbox = $derived(reel.letterbox ?? true);
  const showGrain = $derived(reel.grain ?? true);

  // 52-bar audio-envelope heights — the README's exact generator.
  const bars: string[] = (() => {
    const out: string[] = [];
    for (let i = 0; i < 52; i++) {
      const t = i / 51;
      const env = Math.sin(t * Math.PI);
      const n = Math.abs(Math.sin(i * 1.7) + Math.sin(i * 0.6) * 0.6);
      const h = 14 + env * 74 * (0.35 + 0.65 * (n % 1));
      out.push(Math.max(10, Math.min(96, Math.round(h))) + '%');
    }
    return out;
  })();
</script>

{#if hasMedia}
  <section class="reelB">
    <!-- Existing Newsroom section head (digest.css .dgB-section-head) -->
    <div class="dgB-section-head">
      <h2>The Reel</h2>
      <span class="deck">Chat moments · sound on · loops</span>
    </div>

    <div class="reelB-wrap">
      <div class="reelB-frame">
        {#if showVideo}
          <video
            src={src}
            poster={poster || undefined}
            autoplay
            muted
            loop
            playsinline
            aria-label={reel.media?.alt ?? 'the reel'}
          ></video>
        {:else if showPoster}
          <img src={poster} alt={reel.media?.alt ?? 'the reel'} />
        {/if}

        {#if showGrain}<div class="reelB-grain" aria-hidden="true"></div>{/if}
        <div
          class="reelB-glow"
          aria-hidden="true"
          style={`background: radial-gradient(ellipse 70% 55% at 50% 34%, rgba(${accentRgb},0.16), transparent 62%);`}
        ></div>
        {#if showLetterbox}
          <div class="reelB-lb reelB-lb--top" aria-hidden="true"></div>
          <div class="reelB-lb reelB-lb--bottom" aria-hidden="true"></div>
        {/if}
        {#if showWaveform}
          <div class="reelB-wave" aria-hidden="true">
            {#each bars as h, i (i)}
              <i style={`height:${h}; background:rgb(${accentRgb});`}></i>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if reel.note}<p class="reelB-caption">{reel.note}</p>{/if}
  </section>
{/if}

<style>
  .reelB-wrap {
    max-width: 480px;
    margin: 0 auto;
  }
  .reelB-frame {
    position: relative;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: var(--r-2);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-3);
    background: linear-gradient(180deg, #12171d, #0a0d11);
  }
  .reelB-frame video,
  .reelB-frame img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* Overlay layers — all decorative, all inert (README §2) */
  .reelB-grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.022) 0 1px,
      transparent 1px 3px
    );
    mix-blend-mode: overlay;
  }
  .reelB-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .reelB-lb {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
  }
  .reelB-lb--top {
    top: 0;
    height: 15%;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent);
  }
  .reelB-lb--bottom {
    bottom: 0;
    height: 26%;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.62), transparent);
  }
  .reelB-wave {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14px;
    height: 34px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    pointer-events: none;
  }
  .reelB-wave i {
    flex: 1;
    min-width: 2px;
    border-radius: 2px;
    opacity: 0.6;
  }
  .reelB-caption {
    max-width: 480px;
    margin: 10px auto 0;
    text-align: center;
    font: italic 400 12px/1.5 var(--font-body);
    color: var(--fg-muted);
  }
</style>
