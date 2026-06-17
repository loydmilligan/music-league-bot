<script lang="ts">
  import '$lib/digest/digest.css';
  import type { ContentLeague } from '../../routes/content/+page.server.js';

  const ARCHIVE_STEER_CHIPS = [
    'warmer',
    'less roast-y',
    'more concise',
    "celebrate, don't rank",
    'keep current winner',
  ];

  type UpdatePlanSection = {
    id: string;
    kind: 'add' | 'recompute';
    label: string;
    required?: boolean;
    note: string;
    detail: string;
    steerable?: boolean;
    decision?: 'refresh' | 'hold' | 'lock';
  };

  type UpdatePlan = {
    league: { id: number; name: string };
    slug: string;
    pending: {
      roundId: number;
      theme: string;
      winnerSong: string;
      winnerArtist: string;
      submitter: string;
      votes: number;
      closedAt: string | null;
    };
    sections: UpdatePlanSection[];
  };

  type ReshareData = {
    leagueId: number;
    url: string;
    round: number;
    theme: string;
    league: string;
    headline: string;
    blurb: string;
    cardText: string;
  };

  type Props = {
    league: ContentLeague;
    onClose: () => void;
    onPublished: (data: ReshareData) => void;
  };

  let { league, onClose, onPublished }: Props = $props();

  let plan = $state<UpdatePlan | null>(null);
  let loadErr = $state<string | null>(null);
  let decisions = $state<Record<string, 'refresh' | 'hold' | 'lock'>>({});
  let steerOpen = $state<string | null>(null);
  let steerChips = $state<Record<string, string[]>>({});
  let steerText = $state<Record<string, string>>({});
  let announce = $state<'card' | 'link' | 'silent'>('card');
  let snarkLevel = $state<0 | 1 | 2>(1);
  let generating = $state(false);
  let generateErr = $state<string | null>(null);

  $effect(() => {
    fetch(`/api/content/${league.id}/update-plan`)
      .then((r) => {
        if (!r.ok) return r.text().then((t) => { throw new Error(t); });
        return r.json() as Promise<UpdatePlan>;
      })
      .then((p) => {
        plan = p;
        const init: Record<string, 'refresh' | 'hold' | 'lock'> = {};
        for (const s of p.sections) {
          if (s.kind === 'recompute' && s.decision) init[s.id] = s.decision;
        }
        decisions = init;
      })
      .catch((e: unknown) => {
        loadErr = e instanceof Error ? e.message : 'Failed to load update plan';
      });
  });

  const refreshingCount = $derived(Object.values(decisions).filter((v) => v === 'refresh').length);

  function setDecision(id: string, v: 'refresh' | 'hold' | 'lock') {
    decisions = { ...decisions, [id]: v };
    if (v !== 'refresh' && steerOpen === id) steerOpen = null;
  }

  function toggleSteer(id: string) {
    steerOpen = steerOpen === id ? null : id;
  }

  function toggleChip(sectionId: string, chip: string) {
    const cur = steerChips[sectionId] ?? [];
    steerChips = {
      ...steerChips,
      [sectionId]: cur.includes(chip) ? cur.filter((c) => c !== chip) : [...cur, chip],
    };
  }

  function setSteerText(id: string, val: string) {
    steerText = { ...steerText, [id]: val };
  }

  async function setSnarkLevel(level: 0 | 1 | 2) {
    snarkLevel = level;
    await fetch(`/api/content/${league.id}/snark`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function generate() {
    if (!plan) return;
    generating = true;
    generateErr = null;
    try {
      const steerPayload: Record<string, string> = {};
      for (const id of Object.keys({ ...steerChips, ...steerText })) {
        const chips = steerChips[id] ?? [];
        const text = steerText[id]?.trim() ?? '';
        const parts = text ? [...chips, text] : chips;
        if (parts.length > 0) steerPayload[id] = parts.join(', ');
      }

      const r = await fetch(`/api/content/${league.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions, steer: steerPayload, announce }),
      });
      if (!r.ok) throw new Error(await r.text());
      const result = await r.json();

      onPublished({
        leagueId: league.id,
        url: result.url,
        round: plan.pending.roundId,
        theme: plan.pending.theme,
        league: plan.league.name,
        headline: result.reshare?.headline ?? 'NEW IN THE ARCHIVE',
        blurb: result.reshare?.blurb ?? '',
        cardText: result.reshare?.cardText ?? result.url,
      });
      onClose();
    } catch (e: unknown) {
      generateErr = e instanceof Error ? e.message : 'Generate failed';
    } finally {
      generating = false;
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="dg-modal-scrim"
  onclick={handleScrim}
  role="dialog"
  aria-modal="true"
  aria-label="Update b-side"
  tabindex="-1"
>
  <div class="dg-modal ct-modal" onclick={(e) => e.stopPropagation()} role="presentation">
    <header class="dg-modal-head">
      <h3>Update b-side · <span style="color: var(--mash-pulp);">{plan?.league.name ?? league.name}</span></h3>
      <button type="button" class="x" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="dg-modal-body">
      {#if loadErr}
        <p class="ct-modal-sub" style="color: var(--mash-pulp);">{loadErr}</p>
      {:else if !plan}
        <p class="ct-modal-sub">Loading plan…</p>
      {:else}
        <p class="ct-modal-sub">
          Adding <b>R-{plan.pending.roundId} — "{plan.pending.theme}"</b> to the archive.
          Pick what recomputes from the new round.
          Held sections keep their current version; locked sections never auto-update.
        </p>

        <div class="ct-uplist">
          {#each plan.sections as section (section.id)}
            {@const dec = decisions[section.id]}
            <div class="ct-up-row{section.kind === 'add' ? ' is-add' : dec === 'hold' ? ' is-held' : dec === 'lock' ? ' is-locked' : ''}">
              <span class="ct-up-glyph">{section.kind === 'add' ? '+' : '↻'}</span>

              <div class="ct-up-body">
                <div class="ct-up-label">
                  {section.label}
                  {#if section.required}<span class="ct-up-required">added</span>{/if}
                </div>
                <div class="ct-up-note">{section.note}</div>
                <div class="ct-up-detail">{section.detail}</div>

                {#if section.steerable && dec === 'refresh'}
                  <button type="button" class="ct-up-steer" onclick={() => toggleSteer(section.id)}>
                    ↻ steer this rewrite{steerOpen === section.id ? '…' : ''}
                  </button>
                  {#if steerOpen === section.id}
                    <div class="ct-steer-panel">
                      <div class="dg-modal-chips">
                        {#each ARCHIVE_STEER_CHIPS as chip (chip)}
                          <button
                            type="button"
                            class="dg-modal-chip"
                            class:is-on={(steerChips[section.id] ?? []).includes(chip)}
                            onclick={() => toggleChip(section.id, chip)}
                          >{chip}</button>
                        {/each}
                      </div>
                      <textarea
                        class="dg-modal-textarea"
                        value={steerText[section.id] ?? ''}
                        oninput={(e) => setSteerText(section.id, e.currentTarget.value)}
                        placeholder="Specific instructions… lean into the comeback, mention the upset, etc."
                      ></textarea>
                    </div>
                  {/if}
                {/if}
              </div>

              {#if section.kind === 'add'}
                <span class="ct-add-fixed">timeline</span>
              {:else}
                <div class="ct-seg">
                  {#each ['refresh', 'hold', 'lock'] as v (v)}
                    <button
                      type="button"
                      data-v={v}
                      class={dec === v ? 'is-on' : ''}
                      onclick={() => setDecision(section.id, v as 'refresh' | 'hold' | 'lock')}
                    >{v === 'lock' ? '🔒 lock' : v}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="ct-config">
          <span class="ct-config-lbl">Season pulse</span>
          <div class="ct-seg">
            {#each [[0, 'Gentle'], [1, 'Medium'], [2, 'Spicy']] as [v, l] (v)}
              <button
                type="button"
                data-v={v === 1 ? 'refresh' : ''}
                class={snarkLevel === v ? 'is-on' : ''}
                onclick={() => setSnarkLevel(v as 0 | 1 | 2)}
              >{l}</button>
            {/each}
          </div>
          <span class="ct-config-lbl">Announce</span>
          <div class="ct-seg">
            {#each [['card', 'share card'], ['link', 'link only'], ['silent', 'silent']] as [v, l] (v)}
              <button
                type="button"
                data-v={v === 'card' ? 'refresh' : ''}
                class={announce === v ? 'is-on' : ''}
                onclick={() => (announce = v as 'card' | 'link' | 'silent')}
              >{l}</button>
            {/each}
          </div>
          <span class="ct-sluglock" style="margin-left: auto;">
            <span class="lock">🔒</span>same slug · <b>{plan.slug}</b>
          </span>
          <span class="ct-config-hint">
            Members keep the exact link they already have — the archive just gains a round and the live numbers refresh.
          </span>
        </div>

        {#if generateErr}
          <p style="color: var(--mash-pulp); font: 500 11px/1.5 var(--font-mono); margin: 8px 0 0;">
            {generateErr}
          </p>
        {/if}
      {/if}
    </div>

    <footer class="dg-modal-foot">
      <span class="cost">
        {refreshingCount} section{refreshingCount === 1 ? '' : 's'} refresh · ~ 1.2k tokens · ~ 14¢ · same slug
      </span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="mash-btn mash-btn--primary mash-btn--sm"
          onclick={generate}
          disabled={!plan || generating}
        >
          {generating ? 'Generating…' : 'Generate update →'}
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .ct-steer-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    margin-top: 6px;
  }
</style>
