<script lang="ts">
  import type { Song, SongRatings, SongCardConfig, ActionId, LayerId } from './canonical.js';
  import { DIMS, EMPTY_RATINGS, BUCKETS, fmtDur } from './canonical.js';
  import Rating from './Rating.svelte';

  const {
    song,
    density = 'row',
    config = {},
    defaultExpanded = false,
    expanded: controlledExpanded,
    onToggle,
    onAction,
    onRate,
    onAnalyze,
    onNotes,
  } = $props<{
    song: Song;
    density?: 'row' | 'expanded';
    config?: SongCardConfig;
    defaultExpanded?: boolean;
    /** When provided, expansion is controlled by the parent. */
    expanded?: boolean;
    onToggle?: () => void;
    onAction?: (actionId: string, song: Song) => void;
    onRate?: (ratings: SongRatings, song: Song) => void;
    onAnalyze?: (song: Song) => void;
    onNotes?: (text: string, song: Song) => void;
  }>();

  let _expanded = $state(defaultExpanded);
  // If parent provides `expanded`, use that; otherwise use internal state
  const expanded = $derived(controlledExpanded !== undefined ? controlledExpanded : _expanded);
  function toggleExpand() {
    if (onToggle) { onToggle(); }
    else { _expanded = !_expanded; }
  }
  let ratings = $state<SongRatings>({ ...EMPTY_RATINGS, ...(song.ratings || {}) });

  $effect(() => {
    ratings = { ...EMPTY_RATINGS, ...(song.ratings || {}) };
  });

  function act(id: string) { onAction?.(id, song); }
  function rate(key: string, val: number) {
    ratings = { ...ratings, [key]: val } as SongRatings;
    onRate?.(ratings, song);
  }

  // Gradient fallback for missing art
  const ART_SETS = [
    ['oklch(0.55 0.13 32)', 'oklch(0.30 0.06 28)'],
    ['oklch(0.52 0.10 250)', 'oklch(0.28 0.05 255)'],
    ['oklch(0.58 0.11 70)', 'oklch(0.32 0.05 60)'],
    ['oklch(0.50 0.09 150)', 'oklch(0.27 0.05 155)'],
  ];
  const artSeed = $derived(song.id.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0));
  const artGradient = $derived(() => {
    const s = ART_SETS[Math.abs(artSeed) % ART_SETS.length];
    return `linear-gradient(140deg, ${s[0]}, ${s[1]})`;
  });

  const ACTIONS: Record<string, { g: string; label: string; primary?: boolean; ember?: boolean }> = {
    shortlist: { g: '✚', label: 'Shortlist' },
    research:  { g: '✚', label: 'Round research' },
    h2h:       { g: '✚', label: 'Add to H2H' },
    assign:    { g: '▾', label: 'Assign to round' },
    play:      { g: '▸', label: 'Play on Spotify', primary: true },
    ytm:       { g: '▸', label: 'Play on YT Music' },
    analyze:   { g: '↻', label: 'Analyze / enrich' },
    notes:     { g: '✎', label: 'Notes' },
    save:      { g: '☆', label: 'Save for future' },
    submitted: { g: '⊘', label: 'Mark submitted' },
    dismiss:   { g: '✕', label: 'Not interested', ember: true },
    remove:    { g: '✕', label: 'Remove', ember: true },
    winner:    { g: '♔', label: 'Pick winner', primary: true },
  };

  const HISTORY_STATUS_LABELS: Record<string, string> = {
    'song-mine':    'submitted · mine',
    'song-others':  'submitted',
    'artist-mine':  'artist · mine',
    'artist-others':'artist seen',
  };

  const INTENT_CLS: Record<string, string> = {
    alt:   'usc-intent--pulp',
    retro: 'usc-intent--amber',
    found: 'usc-intent--sky',
    ALT:   'usc-intent--pulp',
    RETRO: 'usc-intent--amber',
    FOUND: 'usc-intent--sky',
  };

  // Analysis panel state
  let analyzePhase = $state<'idle' | 'running' | 'done'>('idle');
  $effect(() => {
    if (song.metadata?.enrichState === 'done') analyzePhase = 'done';
  });

  const AN_JOBS = [
    { t: 'ytm link', k: 'ytm' },
    { t: 'last.fm popularity', k: 'pop' },
    { t: 'genre + mood tags', k: 'tags' },
    { t: 'audio features (bpm/key/energy)', k: 'audio' },
    { t: 'lyrics presence', k: 'lyrics' },
  ];

  function jobState(i: number): 'done' | 'run' | 'queued' {
    if (analyzePhase === 'done') return 'done';
    if (analyzePhase === 'running') return i === 0 ? 'done' : i === 1 ? 'run' : 'queued';
    return 'queued';
  }

  function runAnalyze() {
    if (analyzePhase === 'running') return;
    analyzePhase = 'running';
    onAnalyze?.(song);
  }

  // Overflow menu
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuAnchor && !menuAnchor.contains(e.target as Node)) menuOpen = false;
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  });

  const expandedCfg = $derived({ ...config, ...(config.expandedConfig || {}) });
</script>

{#snippet artThumb(px: number)}
  {@const style = `width: ${px}px; height: ${px}px`}
  <div class="usc-art-ph" {style} style:background={song.art ? 'var(--ink-3)' : artGradient()}>
    {#if song.art}
      <img src={song.art.url} alt="" />
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" />
      </svg>
    {/if}
  </div>
{/snippet}

{#snippet bucketChip(bucket: string | undefined)}
  {#if bucket && BUCKETS[bucket as keyof typeof BUCKETS]}
    {@const b = BUCKETS[bucket as keyof typeof BUCKETS]}
    <span class="usc-bucket {b.cls}"><span class="dot"></span>{b.label}</span>
  {/if}
{/snippet}

{#snippet statRow()}
  {@const m = song.metadata || {}}
  {@const p = m.popularity}
  <div class="usc-stats">
    {#if p}
      <div class="usc-stat">
        <span class="k">Tastemaker</span>
        <span class="v">{p.proxy}<small> / obsc {Math.round((p.obscurity || 0) * 100)}</small></span>
      </div>
    {/if}
    {#if m.audio}
      <div class="usc-stat">
        <span class="k">Tempo</span>
        <span class="v">{m.audio.bpm}<small> bpm · {m.audio.key} {m.audio.scale}</small></span>
      </div>
      <div class="usc-stat">
        <span class="k">Energy</span>
        <span class="v" style="display:flex;align-items:center;gap:8px">
          <span class="usc-energy"><i style="width: {m.audio.energy * 100}%"></i></span>
          {Math.round(m.audio.energy * 100)}
        </span>
      </div>
    {/if}
    {#if m.hasLyrics != null}
      <div class="usc-stat">
        <span class="k">Lyrics</span>
        <span class="v">{m.hasLyrics ? 'on file' : '—'}</span>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet statePills(ctx: Song['context'])}
  {@const pills = [
    ...(ctx.assignments || []).map(r => ({ type: 'assign', label: `round ${r}`, key: `a${r}` })),
    ...(ctx.submittedElsewhere ? [{ type: 'pill', label: 'submitted elsewhere', key: 'se' }] : []),
    ...(ctx.submittedByOther ? [{ type: 'pill', label: String(ctx.submittedByOther), key: 'so' }] : []),
    ...(ctx.saveForFuture ? [{ type: 'pill', label: 'saved for future', key: 'sf' }] : []),
  ]}
  {#if pills.length}
    <div class="usc-assign-chips">
      {#each pills as p (p.key)}
        {#if p.type === 'assign'}
          <span class="usc-assign-chip">{p.label}</span>
        {:else}
          <span class="usc-submitted-pill">{p.label}</span>
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet historyChip(status: string | null | undefined)}
  {#if status && HISTORY_STATUS_LABELS[status]}
    <span class="usc-history-chip {status}">{HISTORY_STATUS_LABELS[status]}</span>
  {/if}
{/snippet}

{#snippet badgeRow(badges: Song['context']['badges'])}
  {#if badges}
    {@const items = [
      ...(badges.medals ? [`★ ${badges.medals} placed`] : []),
      ...(badges.bigDiscussion ? ['▸ discussed'] : []),
      ...(badges.artistBigDiscussion ? ['▸ artist talked-up'] : []),
      ...(badges.poop ? ['flopped before'] : []),
    ]}
    {#if items.length}
      <div class="usc-badges">
        {#each items as item, i}
          <span class="usc-badge{i === 0 && badges.medals ? ' gold' : i === (badges.medals ? 1 : 0) && badges.bigDiscussion ? ' disc' : ''}">
            {item}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet corpusLayer(corpus: Song['context']['corpus'])}
  {#if corpus}
    <div class="usc-stats">
      <div class="usc-stat"><span class="k">Appearances</span><span class="v">{corpus.appearances}×</span></div>
      {#if corpus.submitters?.length}
        <div class="usc-stat"><span class="k">Submitted by</span><span class="v" style="font-weight:400">{corpus.submitters.join(', ')}</span></div>
      {/if}
      <div class="usc-stat"><span class="k">Chat mentions</span><span class="v">{corpus.chatMentions}</span></div>
    </div>
  {/if}
{/snippet}

{#snippet chatLayer(chat: Song['context']['chat'])}
  {#if chat}
    <div class="usc-chat">
      <div class="usc-badges">
        <span class="usc-chip usc-chip--muted">{chat.mentionCount} mentions</span>
        {#each chat.chats || [] as c}
          <span class="usc-chip usc-chip--{c.tone}">{c.name}</span>
        {/each}
        {#if chat.intent}
          <span class="usc-intent {INTENT_CLS[chat.intent] || 'usc-intent--sky'}">{chat.intent.toUpperCase()}</span>
        {/if}
      </div>
      {#each chat.mentions || [] as mn}
        <div class="usc-pull">
          {#each mn.priors || [] as p}
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;opacity:0.6">
              <span class="usc-avatar usc-avatar--{p.tone}">{p.sender[0]}</span>
              <span class="usc-pull-text" style="font-size:12px">{p.text}</span>
            </div>
          {/each}
          <div class="usc-pull-quote">
            <span class="usc-pull-deco">"</span>
            <span class="usc-pull-text">{mn.text}</span>
          </div>
          <div class="usc-pull-attrib">
            <span class="usc-avatar usc-avatar--{mn.senderTone}">{mn.sender[0]}</span>
            <span class="usc-attrib-name">{mn.sender}</span>
            <span class="usc-chip usc-chip--{mn.tone}">{mn.chatName}</span>
            {#if mn.intent}
              <span class="usc-intent {INTENT_CLS[mn.intent] || 'usc-intent--sky'}">{mn.intent.toUpperCase()}</span>
            {/if}
            {#if mn.time}<span class="usc-attrib-time">{mn.time}</span>{/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet actionBtn(id: ActionId, isShortlisted: boolean = false)}
  {@const a = ACTIONS[id]}
  {#if a}
    {@const isActive = id === 'shortlist' && isShortlisted}
    <button
      class="usc-btn{a.primary ? ' usc-btn--primary' : ''}
             {a.ember ? ' usc-btn--ember' : ''}
             {isActive ? ' usc-btn--active' : ''}"
      onclick={(e) => { e.stopPropagation(); act(id); }}
    >
      <span class="g">{a.g}</span>
      {isActive && id === 'shortlist' ? 'Shortlisted' : a.label}
    </button>
  {/if}
{/snippet}

{#snippet overflowMenu(actions: ActionId[])}
  <div class="usc-menu-anchor" bind:this={menuAnchor}>
    <button class="usc-iconbtn" onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }} title="More">⋯</button>
    {#if menuOpen}
      <div class="usc-menu" onclick={(e) => e.stopPropagation()}>
        {#each actions as id, i}
          {@const a = ACTIONS[id]}
          {#if a}
            {#if a.ember && i > 0}<hr />{/if}
            <button
              class={a.ember ? 'danger' : ''}
              onclick={() => { menuOpen = false; act(id); }}
            >
              <span class="g">{a.g}</span>{a.label}
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet analyzePanel()}
  <div class="an-panel">
    <div class="an-state">
      <button
        class="usc-btn usc-btn--primary"
        style="width:auto"
        onclick={runAnalyze}
        disabled={analyzePhase === 'running'}
      >
        <span class="g">↻</span>
        {analyzePhase === 'done' ? 'Re-analyze' : analyzePhase === 'running' ? 'Analyzing…' : 'Analyze this song'}
      </button>
      <span style="font-size:13px;color:var(--fg-muted)">
        {analyzePhase === 'done' ? 'Enriched — feeds the taste fingerprint.' : 'Runs the 5-job enrichment pipeline.'}
      </span>
    </div>
    <div class="an-pipe">
      {#each AN_JOBS as job, i}
        {@const s = jobState(i)}
        <div class="an-job">
          <span class="an-dot {s}"></span>
          <span class="jt">{job.t}</span>
          <span class="js {s}">{s === 'done' ? 'done' : s === 'run' ? 'running' : 'queued'}</span>
        </div>
      {/each}
    </div>
    {#if analyzePhase === 'done'}
      <div class="an-result">
        <div class="an-fp-big">
          <Rating value={ratings} mode="fingerprint" size="lg" />
          <span class="an-fp-cap">taste fingerprint</span>
        </div>
        <div>
          <div class="usc-layer-label">enriched metadata</div>
          {@render statRow()}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet expandedBody(cfg: SongCardConfig, onToggle: (() => void) | null)}
  {@const ctx = song.context || {}}
  {@const has = (l: LayerId) => (cfg.layers || []).includes(l)}
  {@const accentCls = cfg.accent === 'accent' ? ' accent-left' : cfg.accent ? ` accent-${cfg.accent}` : ''}
  {@const bucket = song.metadata?.popularity?.bucket}
  <div class="usc-card{accentCls}">
    <div class="usc-exp{(cfg.actions?.length && cfg.actionStyle !== 'menu') ? '' : ' no-actions'}">
      {#if cfg.art !== false}
        <div class="usc-exp-art">
          {@render artThumb(cfg.artPx || 120)}
          {#if cfg.bucket}{@render bucketChip(bucket)}{/if}
        </div>
      {/if}
      <div class="usc-exp-head">
        <div class="usc-exp-toprow">
          <div style="min-width:0">
            <div class="usc-exp-title">{song.title}</div>
            <div class="usc-exp-sub">
              {song.artist}{song.album ? ` · ${song.album}` : ''}{song.year ? ` · ${song.year}` : ''}
            </div>
          </div>
          {#if onToggle}
            <button class="usc-exp-collapse" onclick={onToggle}>
              collapse <span class="usc-kbd">esc</span>
            </button>
          {/if}
        </div>
        <div class="usc-layers">
          {#if has('state')}{@render statePills(ctx)}{/if}
          {#if has('badges')}{@render badgeRow(ctx.badges)}{/if}
          {#if has('rating')}
            <div>
              <div class="usc-layer-label">
                rating — {cfg.ratingEditable ? 'tap to set' : 'read-only'} · {cfg.ratingMode || 'bars'}
              </div>
              <Rating
                value={ratings}
                mode={cfg.ratingMode || 'bars'}
                editable={cfg.ratingEditable}
                onchange={(k, val) => rate(k, val)}
              />
            </div>
          {/if}
          {#if has('meta')}
            <div>
              <div class="usc-layer-label">metadata</div>
              {@render statRow()}
            </div>
          {/if}
          {#if has('tags') && song.metadata?.tags?.length}
            <div class="usc-tags">
              {#each song.metadata.tags as tag}
                <span class="usc-tag">{tag}</span>
              {/each}
            </div>
          {/if}
          {#if has('corpus')}
            <div>
              <div class="usc-layer-label">corpus history</div>
              {@render corpusLayer(ctx.corpus)}
            </div>
          {/if}
          {#if has('chat') && ctx.chat}
            <div>
              <div class="usc-layer-label">chat context</div>
              {@render chatLayer(ctx.chat)}
            </div>
          {/if}
          {#if has('notes')}
            <div>
              <div class="usc-layer-label">notes</div>
              <textarea class="usc-notes" placeholder="Why this one? (private operator note)" value={cfg.noteText || ''} onblur={(e) => onNotes?.(e.currentTarget.value, song)}></textarea>
            </div>
          {/if}
          {#if has('analyze')}
            <div>
              <div class="usc-layer-label">single-song analysis</div>
              {@render analyzePanel()}
            </div>
          {/if}
        </div>
      </div>
      {#if cfg.actions?.length && cfg.actionStyle !== 'menu'}
        <div class="usc-actions">
          {#each (cfg.actions || []) as id}
            {@render actionBtn(id, cfg.shortlisted)}
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet compactRow(cfg: SongCardConfig, isExpanded: boolean, onToggle: () => void)}
  {@const bucket = song.metadata?.popularity?.bucket}
  {@const ctx = song.context || {}}
  <div
    role="button"
    tabindex="0"
    class="usc-row{isExpanded ? ' is-selected' : ''}{cfg.actionStyle === 'reveal' ? ' reveal' : ''}"
    onclick={onToggle}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
  >
    {#if cfg.art !== false}{@render artThumb(44)}{/if}
    <span class="usc-row-body">
      <span class="usc-row-title">{song.title}</span>
      <span class="usc-row-sub">
        {song.artist}{cfg.showAlbum && song.album ? ` · ${song.album}` : ''}
      </span>
    </span>
    {#if cfg.bucket}{@render bucketChip(bucket)}{/if}
    {#if ctx.historyStatus}{@render historyChip(ctx.historyStatus)}{/if}
    {#if cfg.ratingMode && cfg.ratingMode !== 'none'}
      <span style="flex:none">
        <Rating value={ratings} mode={cfg.ratingMode} />
      </span>
    {/if}
    {#if cfg.duration}
      <span class="usc-row-meta">{fmtDur(song.durationSec)}</span>
    {/if}
    <span class="usc-row-actions" onclick={(e) => e.stopPropagation()}>
      {#if cfg.actionStyle === 'menu'}
        {@render overflowMenu(cfg.actions || [])}
      {:else}
        {#each (cfg.actions || []).slice(0, 3) as id}
          {@const a = ACTIONS[id]}
          {#if a}
            <button
              class="usc-iconbtn"
              title={a.label}
              onclick={(e) => { e.stopPropagation(); act(id); }}
            >{a.g}</button>
          {/if}
        {/each}
      {/if}
      <span class="usc-iconbtn" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
    </span>
  </div>
{/snippet}

{#if density === 'expanded'}
  {@render expandedBody(config, null)}
{:else}
  <div class="usc-cardwrap">
    {@render compactRow(config, expanded, toggleExpand)}
    {#if expanded}
      <div style="margin-top: 6px">
        {@render expandedBody(expandedCfg, toggleExpand)}
      </div>
    {/if}
  </div>
{/if}
