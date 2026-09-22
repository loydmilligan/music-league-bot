<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types.js';

  let { data }: { data: PageData } = $props();
  let selectedSlug = $state('');
  let selectedCandidateId = $state('A');
  const selectedPlayer = $derived(data.players.find(player => player.slug === selectedSlug) ?? data.players.find(player => data.stills?.[player.slug]?.length) ?? data.players.find(player => player.candidates.length) ?? data.players[0]);
  const selectedCandidate = $derived(selectedPlayer?.candidates.find(candidate => candidate.id === selectedCandidateId) ?? selectedPlayer?.candidates[0]);
  const readyCount = $derived(data.players.filter(player => player.candidates.length).length);
  const playerStills = $derived(selectedPlayer ? data.stills?.[selectedPlayer.slug] ?? [] : []);
  const STILL_SHOTS = ['frontal', 'profile', 'face_closeup'] as const;

  // The rendered baseball card lives in the player's card/ folder; show it in its
  // own section and keep it out of the generic media grid below.
  const cardMedia = $derived(selectedPlayer ? selectedPlayer.media.filter(m => m.path.startsWith('card/')) : []);
  const cardFront = $derived(cardMedia.find(m => m.name === 'card-front.png'));
  const cardBack = $derived(cardMedia.find(m => m.name === 'card-back.png'));
  const cardVideo = $derived(cardMedia.find(m => m.name === 'card.mp4'));
  const otherMedia = $derived(selectedPlayer ? selectedPlayer.media.filter(m => !m.path.startsWith('card/')) : []);

  let uploadBusy = $state(false);
  let stillsBusy = $state(false);
  let uploadNotice = $state('');
  let stillsStatus = $state<{ shot: string; ok: boolean; error?: string }[]>([]);

  type Pack = NonNullable<PageData['stills']>[string][number];

  function stillUrl(slug: string, dirName: string, file: string): string {
    return `/boarz-season-1/media/${encodeURIComponent(slug)}/stills/${encodeURIComponent(dirName)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function uploadStill(kind: 'person' | 'inspiration', input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    const player = selectedPlayer;
    if (!file || !player || uploadBusy) return;
    uploadNotice = '';
    uploadBusy = true;
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch(`/boarz-season-1/upload/${player.slug}/${kind}`, { method: 'POST', body });
      const payload = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!payload.ok) uploadNotice = payload.error ?? 'upload failed';
    } catch {
      uploadNotice = 'upload failed';
    } finally {
      uploadBusy = false;
    }
    await invalidateAll();
  }

  async function generateStills() {
    const player = selectedPlayer;
    if (!player || stillsBusy) return;
    stillsBusy = true;
    stillsStatus = [];
    try {
      const res = await fetch(`/boarz-season-1/generate/${player.slug}`, { method: 'POST' });
      const payload = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      stillsStatus = payload.shots ?? [{ shot: 'all', ok: false, error: payload.error ?? 'generation failed' }];
    } catch {
      stillsStatus = [{ shot: 'all', ok: false, error: 'generation request failed' }];
    } finally {
      stillsBusy = false;
    }
    await invalidateAll();
  }

  function selectPlayer(slug: string) {
    selectedSlug = slug;
    selectedCandidateId = data.players.find(player => player.slug === slug)?.candidates[0]?.id ?? 'A';
  }
</script>

<svelte:head>
  <title>Boarz / Season 1 · Concept Review</title>
  <meta name="description" content="Private concept and media review for the Boarz Season 1 cinematic." />
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="review-shell">
  <header class="topbar">
    <div class="brand"><span class="brand-mark">B/</span><span>BOARZ <i>STUDIO</i></span></div>
    <div class="top-meta"><span class="top-dot"></span> SEASON 01 <span class="top-divider">/</span> CONCEPT REVIEW</div>
  </header>

  <div class="review-layout">
    <aside class="roster" aria-label="Player roster">
      <div class="rail-eyebrow">THE ROSTER <span>{data.players.length.toString().padStart(2, '0')}</span></div>
      <div class="rail-intro">Choose a player to review their superhero directions.</div>
      <nav class="player-list">
        {#each data.players as player, index}
          <button type="button" class:active={player.slug === selectedSlug} onclick={() => selectPlayer(player.slug)}>
            <span class="player-index">{String(index + 1).padStart(2, '0')}</span>
            <span class="player-name">{player.name}</span>
            <span class="player-count" class:ready={player.candidates.length > 0}>{player.candidates.length || '—'}</span>
          </button>
        {/each}
      </nav>
      <div class="rail-footer"><strong>{readyCount} / {data.players.length}</strong> players with candidates<br />Concepts stay unselected until human review.</div>
    </aside>

    <main class="content">
      <div class="hero">
        <div class="eyebrow"><span class="eyebrow-line"></span> CINEMATIC / HERO DEVELOPMENT</div>
        <h1>Season One<br /><em>character room.</em></h1>
        <p>A working view of each player’s superhero concepts, with generated images and video joining the page as they arrive.</p>
        <div class="hero-rule"><span>{data.players.length} PLAYERS</span><span>ONE ENSEMBLE</span><span>NO WINNERS YET</span></div>
      </div>

      {#if selectedPlayer}
        <section class="player-section" aria-labelledby="player-heading">
          <div class="section-heading">
            <div><div class="eyebrow small">PLAYER DOSSIER / {selectedPlayer.slug}</div><h2 id="player-heading">{selectedPlayer.name}<span class="period">.</span></h2></div>
            <span class="status-pill">{selectedPlayer.candidates.length ? `${selectedPlayer.candidates.length} CANDIDATES` : 'AWAITING CONCEPTS'}</span>
          </div>

          {#if selectedPlayer.candidates.length}
            <div class="candidate-tabs" role="group" aria-label="Superhero concepts">
              {#each selectedPlayer.candidates as candidate}
                <button type="button" class:chosen={selectedCandidate?.id === candidate.id} onclick={() => selectedCandidateId = candidate.id} aria-pressed={selectedCandidate?.id === candidate.id}>
                  <span>{candidate.id}</span>{candidate.name}
                </button>
              {/each}
            </div>

            {#if selectedCandidate}
              <article class="concept-card">
                <div class="concept-top"><span class="concept-number">DIRECTION {selectedCandidate.id}</span><span class="concept-state">● &nbsp; CANDIDATE</span></div>
                <h3>{selectedCandidate.name}</h3>
                {#if selectedCandidate.hook}<p class="concept-hook">{selectedCandidate.hook}</p>{/if}
                <div class="concept-fields">
                  {#each selectedCandidate.fields.filter(field => !/^core (character )?hook$/i.test(field.label)) as field}
                    <div class="concept-field"><h4>{field.label}</h4><p>{field.text}</p></div>
                  {/each}
                </div>
              </article>
            {/if}
            <p class="selection-note">All directions are candidates. This page does not select or approve a concept.</p>
          {:else}
            <div class="empty-concepts"><span class="empty-icon">✳</span><h3>Concepts in progress</h3><p>This player’s candidate file is still a template. Their directions will appear here when written.</p></div>
          {/if}
        </section>

        <section class="media-section" aria-labelledby="media-heading">
          <div class="section-heading media-heading"><div><div class="eyebrow small">VISUAL DEVELOPMENT</div><h2 id="media-heading">Image &amp; motion<span class="period">.</span></h2></div><span class="status-pill muted">{otherMedia.length} ASSETS</span></div>
          {#if otherMedia.length}
            <div class="media-grid">
              {#each otherMedia as item}
                <figure class="media-item">
                  {#if item.kind === 'image'}<a href={item.url} target="_blank" rel="noopener noreferrer"><img src={item.url} alt={item.name} loading="lazy" /></a>
                  {:else}
                    <!-- svelte-ignore a11y_media_has_caption: source footage has no caption track in the project yet -->
                    <video src={item.url} controls preload="metadata" playsinline aria-label={item.name}></video>
                  {/if}
                  <figcaption><span>{item.kind.toUpperCase()}</span><span title={item.path}>{item.path}</span></figcaption>
                </figure>
              {/each}
            </div>
          {:else}
            <div class="empty-media"><span class="media-glyph">◫</span><div><h3>Visual tests will live here.</h3><p>Images and videos saved in this player’s generations or selects folders will appear automatically.</p></div></div>
          {/if}
        </section>

        <section class="card-section" aria-labelledby="card-heading">
          <div class="section-heading">
            <div><div class="eyebrow small">BASEBALL CARD</div><h2 id="card-heading">The card<span class="period">.</span></h2></div>
            <a class="status-pill link" href={`/boarz-season-1/card/${selectedPlayer.slug}`}>OPEN CARD PAGE →</a>
          </div>
          {#if cardFront || cardBack || cardVideo}
            <div class="card-showcase">
              {#if cardVideo}
                <!-- svelte-ignore a11y_media_has_caption: animated card has no caption track -->
                <video class="card-video" src={cardVideo.url} controls preload="metadata" playsinline aria-label="Animated card"></video>
              {/if}
              <div class="card-faces">
                {#if cardFront}<a href={cardFront.url} target="_blank" rel="noopener noreferrer"><img src={cardFront.url} alt="Card front" loading="lazy" /></a>{/if}
                {#if cardBack}<a href={cardBack.url} target="_blank" rel="noopener noreferrer"><img src={cardBack.url} alt="Card back" loading="lazy" /></a>{/if}
              </div>
            </div>
          {:else}
            <div class="empty-media"><span class="media-glyph">▮</span><div><h3>Card not rendered yet.</h3><p>Run <code>npm run render:all</code> in card-studio to render this player’s card into their card/ folder.</p></div></div>
          {/if}
        </section>

        {#if playerStills.length}
          {#each playerStills as pack (pack.dirName)}
            <section class="stills-section" aria-label="Reference pack">
              <div class="section-heading">
                <div><div class="eyebrow small">REFERENCE PACK / {pack.dirName}</div><h2 id="stills-heading-{pack.dirName}">{pack.spec.heroName}<span class="period">.</span></h2></div>
                <span class="status-pill muted">{pack.spec.candidate ? `CANDIDATE ${pack.spec.candidate}` : 'REFERENCE PACK'}</span>
              </div>
              <article class="refpack">
                <div class="refpack-columns">
                  <div class="upload-slot">
                    <div class="slot-label">PERSON REFERENCE <span class="slot-note">person.png · {pack.hasPerson ? 'uploaded' : 'missing'}</span></div>
                    <div class="slot-body">
                      {#if pack.hasPerson}
                        <a class="slot-thumb" href={stillUrl(selectedPlayer!.slug, pack.dirName, pack.personPath ?? 'person.png')} target="_blank" rel="noopener noreferrer"><img src={stillUrl(selectedPlayer!.slug, pack.dirName, pack.personPath ?? 'person.png')} alt="Person reference" /></a>
                      {:else}
                        <div class="slot-empty">no<br />photo</div>
                      {/if}
                      <label class="upload-btn">{pack.hasPerson ? 'Replace photo' : 'Upload photo'}<input type="file" accept=".png,.jpg,.jpeg,.webp" onchange={event => uploadStill('person', event.currentTarget)} /></label>
                    </div>
                  </div>
                  <div class="upload-slot">
                    <div class="slot-label">INSPIRATION <span class="slot-note">inspiration.jpg · {pack.hasInspiration ? 'uploaded' : 'optional'}</span></div>
                    <div class="slot-body">
                      {#if pack.hasInspiration}
                        <a class="slot-thumb" href={stillUrl(selectedPlayer!.slug, pack.dirName, pack.inspirationPath)} target="_blank" rel="noopener noreferrer"><img src={stillUrl(selectedPlayer!.slug, pack.dirName, pack.inspirationPath)} alt="Inspiration reference" /></a>
                      {:else}
                        <div class="slot-empty">none<br />yet</div>
                      {/if}
                      <label class="upload-btn">{pack.hasInspiration ? 'Replace image' : 'Upload image'}<input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" onchange={event => uploadStill('inspiration', event.currentTarget)} /></label>
                    </div>
                  </div>
                </div>
                <div class="upload-slot desc-slot">
                  <div class="slot-label">HERO DESCRIPTION <span class="slot-note">{pack.spec.descriptionFile} · read-only source of truth</span></div>
                  <pre class="desc-preview">{pack.description}</pre>
                </div>
                <div class="still-outputs">
                  {#each STILL_SHOTS as shot (shot)}
                    <figure class="still-item">
                      {#if pack.outputs[shot].exists}
                        <a href={stillUrl(selectedPlayer!.slug, pack.dirName, pack.outputs[shot].path)} target="_blank" rel="noopener noreferrer"><img src={stillUrl(selectedPlayer!.slug, pack.dirName, pack.outputs[shot].path)} alt="{pack.spec.heroName} — {shot.replace('_', ' ')}" loading="lazy" /></a>
                      {:else}
                        <div class="still-placeholder">◌</div>
                      {/if}
                      <figcaption><span>{shot.toUpperCase().replace('_', ' ')}</span><span>{pack.outputs[shot].exists ? pack.outputs[shot].run ?? 'READY' : 'NOT GENERATED'}</span></figcaption>
                    </figure>
                  {/each}
                </div>
                <div class="stills-actions">
                  <button type="button" class="gen-btn" disabled={stillsBusy} onclick={generateStills}>{stillsBusy ? 'GENERATING…' : 'GENERATE STILLS'}</button>
                  {#if stillsBusy}<span class="spinner" aria-hidden="true"></span><span class="shot-status">THREE SHOTS, ONE BY ONE — 120S EACH</span>{/if}
                  {#each stillsStatus as status}
                    <span class="shot-status" class:pass={status.ok} class:fail={!status.ok}>{status.shot.toUpperCase().replace('_', ' ')} {status.ok ? '✓ SAVED' : `✕ ${status.error ?? 'failed'}`}</span>
                  {/each}
                </div>
                {#if uploadNotice}<p class="stills-error">{uploadNotice}</p>{/if}
              </article>
            </section>
          {/each}
        {/if}
      {/if}
    </main>
  </div>
</div>

<style>
  :global(.boarz-site) { min-height: 100vh; background: #0d1015; color: #f3f0e9; font-family: Inter, 'Inter Tight', sans-serif; }
  .review-shell { max-width: 1800px; margin: auto; min-height: 100vh; }
  .topbar { height: 68px; display: flex; justify-content: space-between; align-items: center; padding: 0 34px; border-bottom: 1px solid #343840; background: #12161c; }
  .brand { display: flex; gap: 15px; align-items: center; font-size: 13px; letter-spacing: .2em; font-weight: 900; }
  .brand i { font-style: normal; color: #f25b38; }
  .brand-mark { display: grid; place-items: center; width: 39px; height: 39px; background: #f25b38; color: #11151b; font-size: 20px; font-weight: 950; letter-spacing: -.1em; transform: skew(-6deg); }
  .top-meta, .eyebrow, .rail-eyebrow, .status-pill, .concept-number, .concept-state, .concept-field h4, .hero-rule, .media-item figcaption, .selection-note { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; }
  .top-meta { color: #a4a9ae; display: flex; gap: 13px; align-items: center; }
  .top-dot { width: 7px; height: 7px; border-radius: 100%; background: #e8ae57; box-shadow: 0 0 13px #e8ae57; }
  .top-divider { color: #5a5e65; }
  .review-layout { display: grid; grid-template-columns: 292px minmax(0, 1fr); }
  .roster { border-right: 1px solid #343840; min-height: calc(100vh - 68px); background: #14181e; padding: 34px 15px 30px; }
  .rail-eyebrow { color: #f25b38; display: flex; justify-content: space-between; margin: 0 15px; }
  .rail-eyebrow span { color: #7b8188; }
  .rail-intro { color: #9da3ab; font-size: 13px; line-height: 1.55; margin: 12px 15px 27px; }
  .player-list { display: grid; gap: 3px; }
  .player-list button { background: transparent; color: #c7cbd0; border: 1px solid transparent; text-align: left; display: grid; grid-template-columns: 28px minmax(0,1fr) 22px; gap: 9px; align-items: center; width: 100%; padding: 13px 12px; cursor: pointer; font-size: 13px; transition: background .15s; }
  .player-list button:hover { background: #222932; }
  .player-list button.active { background: #2a211f; border-color: #754135; color: #fff3eb; }
  .player-index, .player-count { font: 700 11px 'JetBrains Mono', monospace; color: #69717b; }
  .player-list button.active .player-index, .player-count.ready { color: #f25b38; }
  .player-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 650; }
  .rail-footer { margin: 31px 15px 0; padding-top: 23px; border-top: 1px solid #343840; color: #858c94; font-size: 12px; line-height: 1.7; }
  .rail-footer strong { color: #e8ae57; }
  .content { min-width: 0; padding: 0 clamp(24px, 4.5vw, 74px) 90px; }
  .hero { padding: 66px 0 39px; border-bottom: 1px solid #343840; position: relative; overflow: hidden; }
  .hero::after { content: '01'; position: absolute; right: -8px; top: 10px; color: #1d252c; font: 900 clamp(160px, 23vw, 340px)/1 Georgia, serif; z-index: 0; pointer-events: none; }
  .hero > * { position: relative; z-index: 1; }
  .eyebrow { color: #f25b38; display: flex; align-items: center; gap: 11px; }
  .eyebrow-line { width: 28px; height: 1px; background: #f25b38; }
  .eyebrow.small { font-size: 10px; }
  h1 { font: 900 clamp(50px, 6.5vw, 96px)/.96 Georgia, serif; letter-spacing: -.065em; margin: 20px 0; max-width: 760px; }
  h1 em { color: #e8ae57; font-weight: 400; }
  .hero p { max-width: 580px; color: #aeb4bb; line-height: 1.65; font-size: 15px; }
  .hero-rule { display: flex; gap: 35px; color: #7c8590; margin-top: 37px; }
  .hero-rule span::before { content: '✳'; color: #f25b38; margin-right: 8px; }
  .player-section, .media-section { padding-top: 52px; }
  .section-heading { display: flex; gap: 25px; justify-content: space-between; align-items: flex-end; margin-bottom: 27px; }
  h2 { font: 800 clamp(34px, 4vw, 57px)/1.03 Georgia, serif; letter-spacing: -.05em; margin: 12px 0 0; }
  .period { color: #f25b38; }
  .status-pill { color: #e8ae57; border: 1px solid #675437; border-radius: 99px; padding: 8px 13px; white-space: nowrap; }
  .status-pill.muted { color: #aeb4bb; border-color: #4b535c; }
  .candidate-tabs { display: flex; overflow-x: auto; gap: 7px; padding-bottom: 14px; }
  .candidate-tabs button { flex: 0 0 auto; background: #1a2027; color: #b7bec5; border: 1px solid #38414b; padding: 11px 16px; font: 650 12px Inter, sans-serif; cursor: pointer; }
  .candidate-tabs button span { color: #f25b38; font: 800 11px 'JetBrains Mono', monospace; margin-right: 11px; }
  .candidate-tabs button:hover { border-color: #bd674d; }
  .candidate-tabs button.chosen { background: #f25b38; color: #11151a; border-color: #f25b38; }
  .candidate-tabs button.chosen span { color: #11151a; }
  .concept-card { background: #191e25; border: 1px solid #3c454f; padding: clamp(24px, 4vw, 48px); position: relative; overflow: hidden; }
  .concept-card::after { content: '✳'; position: absolute; right: -20px; top: 31px; font-size: 170px; line-height: 1; color: #242e34; pointer-events: none; }
  .concept-card > * { position: relative; z-index: 1; }
  .concept-top { display: flex; justify-content: space-between; gap: 15px; color: #f25b38; }
  .concept-state { color: #e8ae57; }
  h3 { margin: 22px 0 12px; font: 800 clamp(34px, 4.4vw, 64px)/1.02 Georgia, serif; letter-spacing: -.055em; }
  .concept-hook { max-width: 770px; color: #e3e0d8; font: 400 clamp(18px, 2vw, 23px)/1.55 Georgia, serif; margin: 0 0 37px; }
  .concept-fields { border-top: 1px solid #46505b; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 0 32px; }
  .concept-field { border-bottom: 1px solid #313a43; padding: 20px 0 22px; }
  .concept-field h4 { text-transform: uppercase; color: #f25b38; margin: 0 0 8px; }
  .concept-field p { color: #b9c0c6; line-height: 1.65; font-size: 14px; margin: 0; }
  .selection-note { color: #858d94; margin-top: 16px; letter-spacing: .02em; }
  .media-section { margin-top: 22px; border-top: 1px solid #343840; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); gap: 16px; }
  .media-item { margin: 0; background: #191e25; border: 1px solid #3c454f; }
  .media-item img, .media-item video { width: 100%; aspect-ratio: 4/3; object-fit: contain; background: #090b0d; display: block; }
  .media-item figcaption { padding: 12px; display: flex; gap: 11px; color: #b3bac1; text-transform: none; letter-spacing: 0; overflow: hidden; }
  .media-item figcaption span:first-child { color: #f25b38; }
  .media-item figcaption span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-concepts, .empty-media { background: #181e24; border: 1px dashed #46515d; color: #aeb5bb; }
  .empty-concepts { padding: 48px; }
  .empty-concepts h3, .empty-media h3 { color: #eee9df; font-size: 25px; margin: 10px 0; }
  .empty-concepts p, .empty-media p { margin: 0; line-height: 1.55; }
  .empty-icon { color: #f25b38; font-size: 34px; }
  .empty-media { display: flex; align-items: center; gap: 24px; padding: 34px; }
  .media-glyph { color: #f25b38; font-size: 56px; line-height: 1; }
  .card-section { margin-top: 22px; border-top: 1px solid #343840; padding-top: 52px; }
  .status-pill.link { text-decoration: none; cursor: pointer; transition: border-color .15s, color .15s; }
  .status-pill.link:hover { border-color: #f25b38; color: #f25b38; }
  .card-showcase { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); gap: 24px; align-items: start; }
  .card-video { width: 100%; aspect-ratio: 1080 / 1350; background: #05060a; border: 1px solid #3c454f; display: block; }
  .card-faces { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .card-faces a { display: block; }
  .card-faces img { width: 100%; aspect-ratio: 1080 / 1350; object-fit: contain; background: #05060a; border: 1px solid #3c454f; display: block; }
  @media (max-width: 850px) { .card-showcase { grid-template-columns: 1fr; } }
  .stills-section { margin-top: 22px; border-top: 1px solid #343840; padding-top: 52px; }
  .refpack { background: #191e25; border: 1px solid #3c454f; padding: clamp(22px, 3.4vw, 42px); }
  .refpack-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; }
  .upload-slot { margin-top: 26px; min-width: 0; }
  .refpack-columns .upload-slot { margin-top: 0; }
  .slot-label { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #f25b38; margin: 0 0 10px; text-transform: uppercase; }
  .slot-note { color: #7c8590; letter-spacing: .04em; text-transform: lowercase; }
  .slot-body { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .slot-thumb { display: block; flex: 0 0 auto; }
  .slot-thumb img { width: 74px; height: 74px; object-fit: cover; border: 1px solid #4b535c; background: #090b0d; display: block; }
  .slot-empty { width: 74px; height: 74px; box-sizing: border-box; border: 1px dashed #46515d; color: #6d757e; display: grid; place-items: center; text-align: center; font-size: 10px; padding: 6px; }
  .upload-btn { display: inline-flex; align-items: center; cursor: pointer; background: #1a2027; color: #b7bec5; border: 1px solid #38414b; padding: 10px 14px; font: 650 11px Inter, sans-serif; letter-spacing: .07em; text-transform: uppercase; }
  .upload-btn:hover { border-color: #bd674d; color: #f3f0e9; }
  .upload-btn input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .desc-slot { max-width: 760px; }
  .desc-preview { margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; color: #b9c0c6; line-height: 1.6; font-size: 13px; border: 1px solid #313a43; background: #12161c; padding: 16px 18px; }
  .still-outputs { margin-top: 26px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .still-item { margin: 0; background: #12161c; border: 1px solid #3c454f; }
  .still-item img { width: 100%; aspect-ratio: 4/5; object-fit: contain; background: #090b0d; display: block; }
  .still-placeholder { aspect-ratio: 4/5; display: grid; place-items: center; color: #3c454f; font-size: 42px; background: #0d1015; }
  .still-item figcaption { padding: 11px 12px; font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .12em; color: #b3bac1; display: flex; justify-content: space-between; gap: 10px; }
  .still-item figcaption span:last-child { color: #7c8590; text-align: right; white-space: nowrap; }
  .stills-actions { margin-top: 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .gen-btn { background: #f25b38; color: #11151a; border: 1px solid #f25b38; padding: 12px 20px; font: 800 12px 'JetBrains Mono', monospace; letter-spacing: .12em; cursor: pointer; }
  .gen-btn:hover { background: #ff6f4c; }
  .gen-btn:disabled { opacity: .55; cursor: default; }
  .spinner { width: 15px; height: 15px; flex: 0 0 auto; border: 2px solid #675437; border-top-color: #e8ae57; border-radius: 50%; animation: stills-spin .8s linear infinite; }
  @keyframes stills-spin { to { transform: rotate(360deg); } }
  .shot-status { font: 700 11px/1.4 'JetBrains Mono', monospace; letter-spacing: .08em; color: #e8ae57; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .shot-status.pass { color: #7fd1a8; }
  .shot-status.fail { color: #ff8d6e; }
  .stills-error { color: #ff8d6e; font: 700 11px/1.5 'JetBrains Mono', monospace; letter-spacing: .08em; margin: 12px 0 0; }
  @media (max-width: 850px) { .review-layout { display: block; } .roster { min-height: 0; border-right: 0; border-bottom: 1px solid #343840; padding: 20px; } .rail-intro, .rail-footer { display: none; } .player-list { display: flex; overflow-x: auto; margin-top: 13px; } .player-list button { min-width: 190px; } .hero { padding-top: 44px; } .refpack-columns { grid-template-columns: 1fr; } .still-outputs { grid-template-columns: 1fr; } }
  @media (max-width: 620px) { .topbar { padding: 0 18px; } .top-meta { font-size: 9px; } .brand { font-size: 10px; gap: 8px; } .brand-mark { width: 32px; height: 32px; font-size: 17px; } .content { padding: 0 19px 65px; } .hero-rule { flex-wrap: wrap; gap: 12px 18px; font-size: 9px; } .section-heading { align-items: start; flex-direction: column; gap: 14px; } .concept-fields { grid-template-columns: 1fr; } .concept-top { font-size: 9px; } .empty-media { align-items: start; } }
</style>
