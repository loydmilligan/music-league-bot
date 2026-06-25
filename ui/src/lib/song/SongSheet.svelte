<script lang="ts">
  import { browser } from '$app/environment';
  import type { Song, SongRatings, SongCardConfig, ActionId, LayerId } from './canonical.js';
  import { DIMS, EMPTY_RATINGS, BUCKETS, fmtDur } from './canonical.js';
  import Rating from './Rating.svelte';

  const {
    song,
    config = {},
    animate = false,
    onClose,
    onAction,
    onRate,
    onAnalyze,
    onNotes,
  } = $props<{
    song: Song;
    config?: SongCardConfig;
    animate?: boolean;
    onClose: () => void;
    onAction?: (actionId: string, song: Song) => void;
    onRate?: (ratings: SongRatings, song: Song) => void;
    onAnalyze?: (song: Song) => void;
    onNotes?: (text: string, song: Song) => void;
  }>();

  const layers = $derived((config.layers ?? ['rating', 'meta', 'tags']) as LayerId[]);
  const has = $derived((l: LayerId) => layers.includes(l));
  const actions = $derived((config.actions ?? []) as ActionId[]);
  const ratingMode = $derived(config.ratingMode ?? 'bars');
  const ratingEditable = $derived(config.ratingEditable ?? false);

  let ratings = $state<SongRatings>({ ...EMPTY_RATINGS, ...(song.ratings || {}) });
  $effect(() => { ratings = { ...EMPTY_RATINGS, ...(song.ratings || {}) }; });

  let moreOpen = $state(false);

  const primaryId = $derived(actions.find((a: ActionId) => a === 'play' || a === 'winner') ?? actions[0]);
  const rest = $derived(actions.filter((a: ActionId) => a !== primaryId));
  const inlineIcons = $derived(rest.slice(0, 2));
  const overflow = $derived(rest.slice(2));

  const ACTIONS: Record<string, { g: string; label: string; ember?: boolean }> = {
    shortlist:  { g: '✚', label: 'Shortlist' },
    research:   { g: '✚', label: 'Round research' },
    h2h:        { g: '✚', label: 'Add to H2H' },
    assign:     { g: '▾', label: 'Assign to round' },
    play:       { g: '▸', label: 'Play on Spotify' },
    ytm:        { g: '▸', label: 'Play on YT Music' },
    analyze:    { g: '↻', label: 'Analyze / enrich' },
    save:       { g: '☆', label: 'Save for future' },
    submitted:  { g: '⊘', label: 'Mark submitted' },
    dismiss:    { g: '✕', label: 'Not interested', ember: true },
    remove:     { g: '✕', label: 'Remove',          ember: true },
    winner:     { g: '♔', label: 'Pick winner' },
  };

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

  // Body scroll lock while sheet is open
  $effect(() => {
    if (!browser) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  });

  function act(id: string) { onAction?.(id, song); }
  function rate(key: string, val: number) {
    ratings = { ...ratings, [key]: val } as SongRatings;
    onRate?.(ratings, song);
  }

  // Analysis state
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

  const ctx = $derived(song.context || {});
  const bk = $derived(song.metadata?.popularity?.bucket);
  const m  = $derived(song.metadata || {});

  const INTENT_CLS: Record<string, string> = {
    alt: 'mcm-chip--pulp', retro: 'mcm-chip--amber', found: 'mcm-chip--sky',
    ALT: 'mcm-chip--pulp', RETRO: 'mcm-chip--amber', FOUND: 'mcm-chip--sky',
  };
</script>

<div class="mcm-overlay" role="dialog" aria-modal="true">
  <!-- scrim -->
  <div class="mcm-scrim" role="button" tabindex="-1" aria-label="Close" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}></div>

  <!-- sheet -->
  <div class="mcm-sheet{animate ? ' anim' : ''}">
    <div class="mcm-handle"></div>
    <button class="mcm-sheet-close" onclick={onClose} aria-label="Close">✕</button>

    <div class="mcm-sheet-scroll">
      <!-- header -->
      <div class="mcm-sheet-head">
        <div class="mcm-sheet-art" style:background={song.art ? 'var(--ink-3)' : artGradient()}>
          {#if song.art}
            <img src={song.art.url} alt="" />
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" />
            </svg>
          {/if}
        </div>
        <div class="mcm-sheet-head-text">
          <div class="mcm-sheet-title">{song.title}</div>
          <div class="mcm-sheet-artist">{song.artist}</div>
          <div class="mcm-sheet-meta">
            {song.album}{song.year ? ` · ${song.year}` : ''}{song.durationSec ? ` · ${fmtDur(song.durationSec)}` : ''}
          </div>
        </div>
      </div>

      <!-- state layer -->
      {#if has('state') && (ctx.assignments?.length || ctx.submittedElsewhere || ctx.saveForFuture || ctx.submittedByOther)}
        <div class="mcm-sect">
          <div class="mcm-sect-label">status</div>
          <div class="mcm-pills">
            {#each ctx.assignments || [] as r}
              <span class="mcm-pill assign">round {r}</span>
            {/each}
            {#if ctx.submittedElsewhere}<span class="mcm-pill muted">submitted elsewhere</span>{/if}
            {#if ctx.saveForFuture}<span class="mcm-pill muted">saved for future</span>{/if}
            {#if ctx.submittedByOther}<span class="mcm-pill muted">{ctx.submittedByOther}</span>{/if}
          </div>
        </div>
      {/if}

      <!-- badges layer -->
      {#if has('badges') && ctx.badges}
        <div class="mcm-sect">
          <div class="mcm-sect-label">history</div>
          <div class="mcm-badges">
            {#if ctx.badges.medals && ctx.badges.medals > 0}
              <span class="mcm-badge gold">★ <span class="ct">{ctx.badges.medals}</span> placed</span>
            {/if}
            {#if ctx.badges.bigDiscussion}<span class="mcm-badge">▸ discussed</span>{/if}
            {#if ctx.badges.artistBigDiscussion}<span class="mcm-badge">▸ artist talked-up</span>{/if}
            {#if bk && BUCKETS[bk as keyof typeof BUCKETS]}
              {@const b = BUCKETS[bk as keyof typeof BUCKETS]}
              <span class="mcm-bucket {b.cls}"><span class="dot"></span>{b.label}</span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- rating layer -->
      {#if has('rating')}
        <div class="mcm-sect mcm-rate">
          <div class="mcm-sect-label">
            rating
            <span class="hint">{ratingEditable ? `tap to set · ${ratingMode}` : 'read-only'}</span>
          </div>
          <Rating
            value={ratings}
            mode={ratingMode}
            editable={ratingEditable}
            onchange={(k, val) => rate(k, val)}
          />
        </div>
      {/if}

      <!-- meta layer -->
      {#if has('meta') && (m.popularity || m.audio)}
        <div class="mcm-sect">
          <div class="mcm-sect-label">metadata</div>
          <div class="mcm-stats">
            {#if m.popularity}
              <div class="mcm-stat">
                <div class="k">Tastemaker</div>
                <div class="v">{m.popularity.proxy}<small> / obsc {Math.round((m.popularity.obscurity || 0) * 100)}</small></div>
              </div>
            {/if}
            {#if m.audio}
              <div class="mcm-stat">
                <div class="k">Tempo</div>
                <div class="v">{m.audio.bpm}<small> bpm · {m.audio.key} {m.audio.scale}</small></div>
              </div>
              <div class="mcm-stat" style="grid-column: 1 / -1">
                <div class="k">Energy</div>
                <div class="v">{Math.round(m.audio.energy * 100)}<small> / 100</small></div>
                <div class="mcm-energy-bar"><i style="width: {m.audio.energy * 100}%"></i></div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- tags layer -->
      {#if has('tags') && m.tags?.length}
        <div class="mcm-sect">
          <div class="mcm-sect-label">tags</div>
          <div class="mcm-tags">
            {#each m.tags as tag}
              <span class="mcm-tag">{tag}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- corpus layer -->
      {#if has('corpus') && ctx.corpus}
        <div class="mcm-sect">
          <div class="mcm-sect-label">corpus</div>
          <div class="mcm-stats">
            <div class="mcm-stat"><div class="k">Appearances</div><div class="v">{ctx.corpus.appearances}×</div></div>
            {#if ctx.corpus.submitters?.length}
              <div class="mcm-stat"><div class="k">Submitted by</div><div class="v" style="font-size:14px;font-weight:400">{ctx.corpus.submitters.join(', ')}</div></div>
            {/if}
            <div class="mcm-stat"><div class="k">Chat mentions</div><div class="v">{ctx.corpus.chatMentions}</div></div>
          </div>
        </div>
      {/if}

      <!-- chat layer -->
      {#if has('chat') && ctx.chat}
        <div class="mcm-sect">
          <div class="mcm-sect-label">chat context</div>
          <div class="mcm-chat-chips">
            <span class="mcm-chip mcm-chip--muted">{ctx.chat.mentionCount} mentions</span>
            {#each ctx.chat.chats || [] as c}
              <span class="mcm-chip mcm-chip--{c.tone}">{c.name}</span>
            {/each}
            {#if ctx.chat.intent}
              <span class="mcm-chip {INTENT_CLS[ctx.chat.intent] || 'mcm-chip--sky'}">{ctx.chat.intent.toUpperCase()}</span>
            {/if}
          </div>
          {#each ctx.chat.mentions || [] as mn}
            <div class="mcm-pull">
              <div class="mcm-pull-text">"{mn.text}"</div>
              <div class="mcm-pull-attrib">
                <span class="mcm-avatar mcm-avatar--{mn.senderTone}">{mn.sender[0]}</span>
                <span class="mcm-attrib-name">{mn.sender}</span>
                <span class="mcm-chip mcm-chip--{mn.tone}">{mn.chatName}</span>
                {#if mn.time}<span class="mcm-attrib-time">{mn.time}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- notes layer -->
      {#if has('notes')}
        <div class="mcm-sect">
          <div class="mcm-sect-label">notes</div>
          <textarea
            class="mcm-notes"
            placeholder="Why this one? (private operator note)"
            value={config.noteText || ''}
            onblur={(e) => onNotes?.(e.currentTarget.value, song)}
          ></textarea>
        </div>
      {/if}

      <!-- analyze layer -->
      {#if has('analyze')}
        <div class="mcm-sect">
          <div class="mcm-sect-label">single-song analysis</div>
          <div class="mcm-analyze">
            <button
              class="mcm-analyze-btn"
              onclick={runAnalyze}
              disabled={analyzePhase === 'running'}
            >
              <span>↻</span>
              {analyzePhase === 'done' ? 'Re-analyze' : analyzePhase === 'running' ? 'Analyzing…' : 'Analyze this song'}
            </button>
            <div style="margin-top: 10px">
              {#each AN_JOBS as job, i}
                {@const s = jobState(i)}
                <div class="mcm-job">
                  <span class="mcm-jdot {s}"></span>
                  <span class="jt">{job.t}</span>
                  <span class="js {s}">{s === 'done' ? 'done' : s === 'run' ? 'running' : 'queued'}</span>
                </div>
              {/each}
            </div>
            {#if analyzePhase === 'done'}
              <div class="mcm-fp-result">
                <Rating value={ratings} mode="fingerprint" size="lg" />
                <div>
                  <div class="mcm-fp-cap" style="margin-bottom: 6px">taste fingerprint</div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- overflow actions (when moreOpen) -->
      {#if moreOpen && overflow.length}
        <div class="mcm-sect">
          <div class="mcm-sect-label">more actions</div>
          <div class="mcm-moreactions">
            {#each overflow as id}
              {@const a = ACTIONS[id]}
              {#if a}
                <button
                  class="mcm-moreact{a.ember ? ' ember' : ''}"
                  onclick={() => { moreOpen = false; act(id); }}
                >
                  <span class="g">{a.g}</span>{a.label}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- sticky action bar -->
    {#if actions.length}
      <div class="mcm-actionbar">
        {#if primaryId && ACTIONS[primaryId]}
          <button class="mcm-act-primary" onclick={() => act(primaryId)}>
            {ACTIONS[primaryId].g} {ACTIONS[primaryId].label}
          </button>
        {/if}
        {#each inlineIcons as id}
          {@const a = ACTIONS[id]}
          {#if a}
            <button
              class="mcm-act-icon{a.ember ? ' ember' : ''}"
              title={a.label}
              onclick={() => act(id)}
            >{a.g}</button>
          {/if}
        {/each}
        {#if overflow.length}
          <button class="mcm-act-icon" title="More" onclick={() => { moreOpen = !moreOpen; }}>⋯</button>
        {/if}
      </div>
    {/if}
  </div>
</div>
