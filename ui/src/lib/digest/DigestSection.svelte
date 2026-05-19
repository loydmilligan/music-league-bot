<script lang="ts">
  import ArtSlot from './ArtSlot.svelte';
  import {
    type SectionKind,
    type DigestSubmission,
    type FlowNotable,
    type ConsensusSide,
    type DigestComment,
    type DigestChatCallout,
    DIGEST_VILLAIN,
  } from './fixtures.js';

  type Props = {
    kind: SectionKind;
    submissions?: DigestSubmission[];
    villain?: typeof DIGEST_VILLAIN;
    flowNotable?: FlowNotable[];
    consensus?: { agreed: ConsensusSide; contested: ConsensusSide };
    comments?: DigestComment[];
    chat?: DigestChatCallout[];
  };
  let { kind, submissions, villain, flowNotable, consensus, comments, chat }: Props = $props();

  function trackClass(rank: number): string {
    if (rank === 1) return 'dgC-track dgC-track--gold';
    if (rank === 2) return 'dgC-track dgC-track--silver';
    if (rank === 3) return 'dgC-track dgC-track--bronze';
    return 'dgC-track';
  }

  function notableLabel(k: FlowNotable['kind']): string {
    if (k === 'first') return 'first vote';
    if (k === 'across') return 'crossed lines';
    if (k === 'mutual') return 'mutual';
    return 'downvote';
  }

  function chatHeadline(headline: string): string {
    return headline.replace('·', '/');
  }
</script>

{#if kind === 'podium' && submissions}
  <section class="dg-section">
    <p class="dg-section-eyebrow">A-side · final ranking</p>
    <div class="dgC-tracks">
      {#each submissions as s (s.rank)}
        <div class={trackClass(s.rank)}>
          <span class="dgC-track-num">{String(s.rank).padStart(2, '0')}.</span>
          <div class="dgC-track-art"><ArtSlot artist={s.artist} size={44} /></div>
          <div class="dgC-track-meta">
            <span class="dgC-track-title">{s.title}</span>
            <span class="dgC-track-artist">{s.artist} · {s.year}</span>
          </div>
          <span class="dgC-track-sub">submitted by <span class="name">{s.submitter}</span></span>
          <span class="dgC-track-pts">{s.points} pt</span>
        </div>
      {/each}
    </div>
  </section>
{:else if kind === 'villain' && villain}
  <section class="dg-section">
    <p class="dg-section-eyebrow">B-side · the downvote</p>
    <div class="dgC-villain">
      <div class="dgC-villain-tag">[ REMOVED · {villain.points} PTS · DOWNVOTED ]</div>
      <div class="dgC-villain-line">
        <span class="strike">{villain.songTitle}</span>
        <span>·</span>
        <span>{villain.songArtist}</span>
        <span>·</span>
        <span>submitted by</span>
        <span style="color: var(--fg); font-weight: 700;">{villain.submitter}</span>
        <span>·</span>
        <span>from:</span>
        <span class="from">{villain.downvoter} (theme chooser)</span>
        <span>·</span>
        <span class="pts">{villain.points} pts</span>
      </div>
      <div class="dgC-villain-comment">"{villain.comment}"</div>
    </div>
  </section>
{:else if kind === 'flow' && flowNotable}
  <section class="dg-section">
    <p class="dg-section-eyebrow">Credits · notable votes</p>
    <div class="dgC-credits">
      {#each flowNotable as n (n.from + n.to + n.kind)}
        <div class="dgC-credit-item dgC-credit-item--{n.kind}">
          <span class="dgC-credit-tag">{notableLabel(n.kind)}</span>
          <span class="dgC-credit-line">
            <span class="who">{n.from}</span> <span class="arrow">→</span> <span class="who">{n.to}</span>'s pick
          </span>
          <span class="dgC-credit-pts">{n.pts > 0 ? `+${n.pts}` : n.pts}</span>
          <span class="dgC-credit-gloss">{n.text}</span>
        </div>
      {/each}
    </div>
  </section>
{:else if kind === 'consensus' && consensus}
  <section class="dg-section">
    <p class="dg-section-eyebrow">Consensus & controversy</p>
    <div class="dgC-cc">
      <div class="dgC-cc-block dgC-cc-block--agree">
        <div class="dgC-cc-h">[ MOST AGREED-UPON ]</div>
        <div class="dgC-cc-title">"{consensus.agreed.title}"</div>
        <div class="dgC-cc-artist">{consensus.agreed.artist} · {consensus.agreed.submitter}</div>
        <div class="dgC-cc-spread">
          {#each consensus.agreed.spread as v, i (i)}
            <div class="row">
              <span class="name">voter {i + 1}</span>
              <span class="bar"><i style:width="{(v / 5) * 100}%"></i></span>
              <span class="v">{v}</span>
            </div>
          {/each}
        </div>
      </div>
      <div class="dgC-cc-block dgC-cc-block--contest">
        <div class="dgC-cc-h">[ MOST CONTESTED ]</div>
        <div class="dgC-cc-title">"{consensus.contested.title}"</div>
        <div class="dgC-cc-artist">{consensus.contested.artist} · {consensus.contested.submitter}</div>
        <div class="dgC-cc-spread">
          {#each consensus.contested.spread as v, i (i)}
            <div class="row">
              <span class="name">voter {i + 1}</span>
              <span class="bar"><i style:width="{(Math.abs(v) / 5) * 100}%"></i></span>
              <span class="v">{v}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>
{:else if kind === 'quotes' && comments}
  <section class="dg-section">
    <p class="dg-section-eyebrow">Liner quotes · llm picks</p>
    <div class="dgC-quotes">
      {#each comments as c (c.who + c.whose_song)}
        <div class="dgC-quote">
          <p class="dgC-quote-q">"{c.quote}"</p>
          <div class="dgC-quote-em">
            {c.who} · {c.whose_song}{c.points !== undefined ? ` · ${c.points} pt vote` : ''}{c.rank ? ` · #${c.rank}` : ''}
          </div>
          <div class="dgC-quote-gloss">{c.gloss}</div>
        </div>
      {/each}
    </div>
  </section>
{:else if kind === 'chat' && chat}
  <section class="dg-section">
    <p class="dg-section-eyebrow">Back cover · chat notes</p>
    <div class="dgC-chat">
      {#each chat as c (c.headline)}
        <div class="dgC-chat-row">
          <span class="dgC-chat-h">[ {chatHeadline(c.headline)} ]</span>
          <div class="dgC-chat-body">
            {#if c.quote}<em>"{c.quote}"</em>{/if}
            {c.text ?? c.gloss ?? ''}
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}
