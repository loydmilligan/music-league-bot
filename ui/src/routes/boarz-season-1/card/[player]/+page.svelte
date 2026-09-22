<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
  const hasCard = $derived(Boolean(data.front || data.back || data.video));
</script>

<svelte:head>
  <title>{data.name} · Card / Boarz Season 1</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="card-page">
  <header class="topbar">
    <a class="back" href="/boarz-season-1">← ALL PLAYERS</a>
    <div class="top-meta"><span class="top-dot"></span> BOARZ <span class="top-divider">/</span> SEASON 01 CARD</div>
  </header>

  <main class="card-main">
    <div class="eyebrow"><span class="eyebrow-line"></span> BASEBALL CARD / {data.slug}</div>
    <h1>{data.name}<span class="period">.</span></h1>

    {#if hasCard}
      {#if data.video}
        <!-- svelte-ignore a11y_media_has_caption: animated card has no caption track -->
        <video class="card-video" src={data.video} controls autoplay muted loop playsinline aria-label="Animated card"></video>
      {/if}
      <div class="faces">
        {#if data.front}
          <figure><a href={data.front} target="_blank" rel="noopener noreferrer"><img src={data.front} alt="Card front" /></a><figcaption>FRONT</figcaption></figure>
        {/if}
        {#if data.back}
          <figure><a href={data.back} target="_blank" rel="noopener noreferrer"><img src={data.back} alt="Card back" /></a><figcaption>BACK</figcaption></figure>
        {/if}
      </div>
    {:else}
      <div class="empty">
        <span class="glyph">▮</span>
        <div>
          <h3>Card not rendered yet.</h3>
          <p>Run <code>npm run render:all</code> in <code>card-studio/</code> to render this player’s card into their <code>card/</code> folder.</p>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .card-page { max-width: 1200px; margin: auto; min-height: 100vh; }
  .topbar { height: 68px; display: flex; justify-content: space-between; align-items: center; padding: 0 34px; border-bottom: 1px solid #343840; background: #12161c; }
  .back { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #f25b38; text-decoration: none; }
  .back:hover { color: #ff6f4c; }
  .top-meta { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #a4a9ae; display: flex; gap: 13px; align-items: center; }
  .top-dot { width: 7px; height: 7px; border-radius: 100%; background: #e8ae57; box-shadow: 0 0 13px #e8ae57; }
  .top-divider { color: #5a5e65; }
  .card-main { padding: clamp(28px, 5vw, 60px) clamp(24px, 4.5vw, 74px) 90px; }
  .eyebrow { font: 700 10px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #f25b38; display: flex; align-items: center; gap: 11px; }
  .eyebrow-line { width: 28px; height: 1px; background: #f25b38; }
  h1 { font: 800 clamp(40px, 6vw, 76px)/1 Georgia, serif; letter-spacing: -.05em; margin: 18px 0 34px; }
  .period { color: #f25b38; }
  .card-video { width: 100%; max-width: 540px; aspect-ratio: 1080 / 1350; background: #05060a; border: 1px solid #3c454f; display: block; margin: 0 0 28px; }
  .faces { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; max-width: 900px; }
  .faces figure { margin: 0; }
  .faces img { width: 100%; aspect-ratio: 1080 / 1350; object-fit: contain; background: #05060a; border: 1px solid #3c454f; display: block; }
  .faces figcaption { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #b3bac1; padding: 10px 2px; }
  .empty { background: #181e24; border: 1px dashed #46515d; color: #aeb5bb; display: flex; align-items: center; gap: 24px; padding: 34px; max-width: 720px; }
  .empty .glyph { color: #f25b38; font-size: 46px; line-height: 1; }
  .empty h3 { color: #eee9df; font-size: 22px; margin: 0 0 8px; }
  .empty p { margin: 0; line-height: 1.55; font-size: 14px; }
  .empty code { color: #e8ae57; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  @media (max-width: 620px) { .topbar { padding: 0 18px; } .card-main { padding: 24px 18px 60px; } .empty { flex-direction: column; align-items: start; } }
</style>
