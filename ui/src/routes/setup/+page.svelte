<script lang="ts">
  import type { PageData } from './$types.js';
  import { invalidateAll } from '$app/navigation';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';

  let { data }: { data: PageData } = $props();

  // ---- types ---------------------------------------------------------------
  type Season = { id: number; seasonNumber: number; status: 'active' | 'complete'; rounds: { id: number; name: string }[] };
  type League = typeof data.leagues[number];
  type Player = typeof data.players[number];

  // ---- shared status banner ------------------------------------------------
  type BannerTone = 'health' | 'warn';
  let banner = $state<{ tone: BannerTone; label: string } | null>(null);

  function showBanner(label: string, tone: BannerTone = 'health') {
    banner = { label, tone };
    setTimeout(() => { banner = null; }, 3000);
  }

  async function apiCall(url: string, method: string, body?: unknown): Promise<Response> {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  // ---- leagues & seasons section ------------------------------------------
  let leagueLoading = $state<Record<number, boolean>>({});

  async function toggleLeagueActive(league: League) {
    leagueLoading = { ...leagueLoading, [league.id]: true };
    const res = await apiCall(`/api/leagues/${league.id}/active`, 'PATCH', { active: !league.manuallyActive });
    leagueLoading = { ...leagueLoading, [league.id]: false };
    if (!res.ok) { showBanner(`Error toggling ${league.name}`, 'warn'); return; }
    showBanner(`${league.name} ${!league.manuallyActive ? 'activated' : 'deactivated'}`);
    await invalidateAll();
  }

  type SeasonFlipState = Record<number, boolean>;
  let seasonLoading: SeasonFlipState = $state({});

  async function flipSeasonStatus(league: League, season: Season) {
    const newStatus = season.status === 'active' ? 'complete' : 'active';
    seasonLoading = { ...seasonLoading, [season.id]: true };
    const res = await apiCall(`/api/leagues/${league.id}/seasons/${season.id}`, 'PATCH', { status: newStatus });
    seasonLoading = { ...seasonLoading, [season.id]: false };
    if (!res.ok) { showBanner('Error updating season status', 'warn'); return; }
    showBanner(`Season ${season.seasonNumber} marked ${newStatus}`);
    await invalidateAll();
  }

  // Active-round selector per league: local shadow state so the select feels
  // instant. We sync back to server on change.
  let selectedRound = $state<Record<number, number | ''>>(
    Object.fromEntries(data.leagues.map(l => [l.id, l.activeRoundId ?? ''])),
  );

  $effect(() => {
    // Re-sync from server data when invalidateAll() fires.
    for (const l of data.leagues) {
      selectedRound[l.id] = l.activeRoundId ?? '';
    }
  });

  let roundSaving = $state<Record<number, boolean>>({});

  async function setActiveRound(league: League, roundId: number | '') {
    roundSaving = { ...roundSaving, [league.id]: true };
    const res = await apiCall(`/api/leagues/${league.id}/active-round`, 'PUT', { roundId: roundId === '' ? null : roundId });
    roundSaving = { ...roundSaving, [league.id]: false };
    if (!res.ok) { showBanner('Error setting active round', 'warn'); return; }
    showBanner('Active round updated');
    await invalidateAll();
  }

  // ---- players section -----------------------------------------------------
  // Add-player form state
  let newName = $state('');
  let addingPlayer = $state(false);

  async function addPlayer() {
    if (!newName.trim() || addingPlayer) return;
    addingPlayer = true;
    const res = await apiCall('/api/players', 'POST', { name: newName.trim() });
    addingPlayer = false;
    if (!res.ok) { showBanner('Error adding player', 'warn'); return; }
    newName = '';
    showBanner('Player added');
    await invalidateAll();
  }

  // Inline edit state: which row is expanded
  let editingId = $state<number | null>(null);
  let editName = $state('');
  let editAge = $state<string>('');
  let editSaving = $state(false);

  function startEdit(player: Player) {
    editingId = player.id;
    editName = player.name;
    editAge = player.age != null ? String(player.age) : '';
    // reset identity/relationship subforms
    newIdentityType = $state.snapshot(newIdentityType) === newIdentityType ? newIdentityType : 'whatsapp';
    newIdentityId = '';
    newIdentityLeague = '';
    showAddIdentity = false;
    newRelatedPlayer = '';
    newRelType = '';
    newRelNote = '';
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveNameAge() {
    if (!editingId || editSaving) return;
    editSaving = true;
    const body: Record<string, unknown> = {};
    if (editName.trim()) body.name = editName.trim();
    const parsedAge = editAge.trim() === '' ? null : Number(editAge.trim());
    if (editAge.trim() === '' || (parsedAge !== null && Number.isInteger(parsedAge) && parsedAge >= 0)) {
      body.age = parsedAge;
    }
    const res = await apiCall(`/api/players/${editingId}`, 'PATCH', body);
    editSaving = false;
    if (!res.ok) { showBanner('Error saving player', 'warn'); return; }
    showBanner('Player updated');
    await invalidateAll();
  }

  // Season membership per player: toggling adds/removes the player from a season.
  let membershipSaving = $state<Record<string, boolean>>({});

  async function toggleMembership(player: Player, seasonId: number) {
    const key = `${player.id}-${seasonId}`;
    membershipSaving = { ...membershipSaving, [key]: true };
    const isMember = player.seasonIds.includes(seasonId);
    let res: Response;
    if (isMember) {
      res = await apiCall(`/api/seasons/${seasonId}/players/${player.id}`, 'DELETE');
    } else {
      res = await apiCall(`/api/seasons/${seasonId}/players`, 'POST', { playerId: player.id });
    }
    membershipSaving = { ...membershipSaving, [key]: false };
    if (!res.ok) { showBanner('Error updating season membership', 'warn'); return; }
    await invalidateAll();
  }

  // ---- identity section per player ----------------------------------------
  let showAddIdentity = $state(false);
  let newIdentityType = $state<'whatsapp' | 'google-chat' | 'music-league'>('whatsapp');
  let newIdentityId = $state('');
  let newIdentityLeague = $state<string>('');
  let addingIdentity = $state(false);

  const identityPlaceholders: Record<string, string> = {
    'whatsapp': "Display name in WhatsApp group (e.g. 'Matt M.')",
    'google-chat': 'Google Chat display name or email address',
    'music-league': 'Username on musicleague.app',
  };

  async function addIdentity(playerId: number) {
    if (!newIdentityId.trim() || addingIdentity) return;
    addingIdentity = true;
    const body: Record<string, unknown> = {
      identity_type: newIdentityType,
      identifier: newIdentityId.trim(),
    };
    if (newIdentityLeague) body.league_id = Number(newIdentityLeague);
    const res = await apiCall(`/api/players/${playerId}/identities`, 'POST', body);
    addingIdentity = false;
    if (!res.ok) { showBanner('Error adding identity', 'warn'); return; }
    newIdentityId = '';
    newIdentityLeague = '';
    showAddIdentity = false;
    showBanner('Identity added');
    await invalidateAll();
  }

  let deletingIdentity = $state<Record<number, boolean>>({});

  async function deleteIdentity(playerId: number, identityId: number) {
    deletingIdentity = { ...deletingIdentity, [identityId]: true };
    const res = await apiCall(`/api/players/${playerId}/identities/${identityId}`, 'DELETE');
    deletingIdentity = { ...deletingIdentity, [identityId]: false };
    if (!res.ok) { showBanner('Error removing identity', 'warn'); return; }
    showBanner('Identity removed');
    await invalidateAll();
  }

  // ---- relationships section per player -----------------------------------
  let newRelatedPlayer = $state<string>('');
  let newRelType = $state<string>('');
  let newRelNote = $state('');
  let addingRel = $state(false);

  const REL_TYPES = [
    'sister', 'brother', 'parent', 'spouse', 'child', 'grandchild',
    'cousin', 'boyfriend', 'girlfriend', 'other',
  ] as const;

  async function addRelationship(playerId: number) {
    if (!newRelatedPlayer || !newRelType || addingRel) return;
    if (newRelType === 'other' && !newRelNote.trim()) return;
    addingRel = true;
    const body: Record<string, unknown> = {
      related_player_id: Number(newRelatedPlayer),
      relationship_type: newRelType,
      relationship_note: newRelType === 'other' ? newRelNote.trim() : undefined,
    };
    const res = await apiCall(`/api/players/${playerId}/relationships`, 'POST', body);
    addingRel = false;
    if (!res.ok) {
      const msg = res.status === 409 ? 'Relationship already exists' : 'Error adding relationship';
      showBanner(msg, 'warn');
      return;
    }
    newRelatedPlayer = '';
    newRelType = '';
    newRelNote = '';
    showBanner('Relationship added');
    await invalidateAll();
  }

  let deletingRel = $state<Record<number, boolean>>({});

  async function deleteRelationship(playerId: number, relId: number) {
    deletingRel = { ...deletingRel, [relId]: true };
    const res = await apiCall(`/api/players/${playerId}/relationships/${relId}`, 'DELETE');
    deletingRel = { ...deletingRel, [relId]: false };
    if (!res.ok) { showBanner('Error removing relationship', 'warn'); return; }
    showBanner('Relationship removed');
    await invalidateAll();
  }

  // ---- competitors section -------------------------------------------------
  let competitorLink = $state<Record<number, number | ''>>(
    Object.fromEntries(data.competitors.map(c => [c.id, c.player_id ?? ''])),
  );
  let competitorSaving = $state<Record<number, boolean>>({});

  const unlinkedCompetitors = $derived(data.competitors.filter(c => c.player_id == null));
  const linkedCompetitors = $derived(data.competitors.filter(c => c.player_id != null));

  $effect(() => {
    for (const c of data.competitors) {
      competitorLink[c.id] = c.player_id ?? '';
    }
  });

  async function setCompetitorLink(competitorId: number, value: number | '') {
    competitorSaving = { ...competitorSaving, [competitorId]: true };
    const playerId = value === '' ? null : value;
    const res = await apiCall(`/api/competitors/${competitorId}`, 'PATCH', { player_id: playerId });
    competitorSaving = { ...competitorSaving, [competitorId]: false };
    if (!res.ok) { showBanner('Error updating competitor link', 'warn'); return; }
    showBanner(playerId ? 'Competitor linked' : 'Competitor unlinked');
    await invalidateAll();
  }

  // ---- rounds section ------------------------------------------------------
  // Track which leagues have their rounds expanded.
  let roundsExpanded = $state<Record<number, boolean>>({});

  // Add-round form per league.
  type AddRoundForm = { name: string; subDeadline: string; voteDeadline: string; setActive: boolean; saving: boolean };
  let addRoundForms = $state<Record<number, AddRoundForm>>({});

  function getAddRoundForm(leagueId: number): AddRoundForm {
    return addRoundForms[leagueId] ?? { name: '', subDeadline: '', voteDeadline: '', setActive: false, saving: false };
  }

  async function addRound(leagueId: number) {
    const form = getAddRoundForm(leagueId);
    if (!form.name.trim() || form.saving) return;
    addRoundForms = { ...addRoundForms, [leagueId]: { ...form, saving: true } };
    const body: Record<string, unknown> = { name: form.name.trim() };
    if (form.subDeadline) body.submission_deadline = new Date(form.subDeadline).toISOString();
    if (form.voteDeadline) body.voting_deadline = new Date(form.voteDeadline).toISOString();
    if (form.setActive) body.set_active = true;
    const res = await apiCall(`/api/leagues/${leagueId}/rounds`, 'POST', body);
    if (!res.ok) {
      const msg = res.status === 409 ? 'No active season — activate a season first' : 'Error adding round';
      addRoundForms = { ...addRoundForms, [leagueId]: { ...form, saving: false } };
      showBanner(msg, 'warn');
      return;
    }
    addRoundForms = { ...addRoundForms, [leagueId]: { name: '', subDeadline: '', voteDeadline: '', setActive: false, saving: false } };
    showBanner('Round added');
    await invalidateAll();
  }

  function toggleRoundsExpanded(leagueId: number) {
    roundsExpanded = { ...roundsExpanded, [leagueId]: !roundsExpanded[leagueId] };
  }

  // Local round edit state: keyed by round id.
  type RoundEditState = {
    roundNumber: string;
    name: string;
    tag: string;
    submittedBy: string;
    saving: boolean;
  };
  let roundEdits = $state<Record<number, RoundEditState>>({});

  function getRoundEdit(round: { id: number; roundNumber?: number | null; name: string; tag?: string | null; themeSubmittedBy?: number | null }): RoundEditState {
    return roundEdits[round.id] ?? {
      roundNumber: round.roundNumber != null ? String(round.roundNumber) : '',
      name: round.name,
      tag: round.tag ?? '',
      submittedBy: round.themeSubmittedBy != null ? String(round.themeSubmittedBy) : '',
      saving: false,
    };
  }

  async function saveRoundField(roundId: number, field: string, value: unknown) {
    roundEdits = { ...roundEdits, [roundId]: { ...getRoundEditById(roundId), saving: true } };
    const res = await apiCall(`/api/rounds/${roundId}`, 'PATCH', { [field]: value });
    roundEdits = { ...roundEdits, [roundId]: { ...getRoundEditById(roundId), saving: false } };
    if (!res.ok) { showBanner('Error saving round', 'warn'); return; }
    await invalidateAll();
  }

  function getRoundEditById(roundId: number): RoundEditState {
    return roundEdits[roundId] ?? { roundNumber: '', name: '', tag: '', submittedBy: '', saving: false };
  }
</script>

<svelte:head><title>Setup · music-league-bot</title></svelte:head>

<!-- Banner -->
{#if banner}
  <div class="fixed bottom-6 right-6 z-50">
    <StatusChip label={banner.label} tone={banner.tone} />
  </div>
{/if}

<!-- Page header -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · setup
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">Setup</h1>
  <p class="text-fg-muted max-w-2xl">
    Manage leagues, seasons, active rounds, players, and round metadata.
  </p>
</div>

<!-- ======== LEAGUES & SEASONS ======== -->
<section class="mb-10">
  <header class="mb-4">
    <SectionLabel>Leagues &amp; Seasons</SectionLabel>
    <h2 class="text-2xl font-bold text-fg mt-1">Leagues &amp; Seasons</h2>
  </header>

  <div class="flex flex-col gap-6">
    {#each data.leagues as league (league.id)}
      <div class="bg-surface border border-border-muted rounded-xl p-5">
        <!-- League header row -->
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <h3 class="text-lg font-bold text-fg flex-1 min-w-0 truncate">{league.name}</h3>
          <StatusChip
            label={league.manuallyActive ? 'ACTIVE' : 'INACTIVE'}
            tone={league.manuallyActive ? 'health' : 'muted'}
          />
          <button
            type="button"
            onclick={() => toggleLeagueActive(league)}
            disabled={leagueLoading[league.id]}
            class="font-mono text-[10px] tracking-widest uppercase border border-border text-fg-muted hover:text-fg hover:border-accent px-3 py-1 rounded-md transition-colors disabled:opacity-50"
          >
            {league.manuallyActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>

        <!-- Active-round selector -->
        <div class="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <label
            for="active-round-{league.id}"
            class="font-mono text-[10px] tracking-widest uppercase text-fg-faint shrink-0"
          >
            Active round
          </label>
          <select
            id="active-round-{league.id}"
            bind:value={selectedRound[league.id]}
            disabled={roundSaving[league.id]}
            onchange={() => setActiveRound(league, selectedRound[league.id])}
            class="flex-1 min-w-0 bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
          >
            <option value="">— none (auto-derive) —</option>
            {#each league.availableRounds as r (r.id)}
              <option value={r.id}>{r.name}</option>
            {/each}
            {#each league.seasons as s (s.id)}
              {#each s.rounds as r (r.id)}
                {#if !league.availableRounds.some(ar => ar.id === r.id)}
                  <option value={r.id}>{r.name} (S{s.seasonNumber})</option>
                {/if}
              {/each}
            {/each}
          </select>
          {#if roundSaving[league.id]}
            <span class="font-mono text-[10px] text-fg-faint">saving…</span>
          {/if}
        </div>

        <!-- Seasons list -->
        <div>
          <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Seasons</div>
          {#if league.seasons.length === 0}
            <p class="text-xs text-fg-dim italic">No seasons yet.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each league.seasons as season (season.id)}
                <div class="flex flex-wrap items-center gap-3 bg-bg-elevated border border-border-muted rounded-md px-3 py-2 text-sm">
                  <span class="text-fg font-mono">S{season.seasonNumber}</span>
                  <StatusChip
                    label={season.status.toUpperCase()}
                    tone={season.status === 'active' ? 'health' : 'muted'}
                  />
                  <span class="text-fg-dim text-xs flex-1 min-w-0">
                    {season.rounds.length} round{season.rounds.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onclick={() => flipSeasonStatus(league, season as Season)}
                    disabled={seasonLoading[season.id]}
                    class="font-mono text-[10px] tracking-widest uppercase border border-border text-fg-muted hover:text-fg hover:border-accent px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                  >
                    {season.status === 'active' ? 'Mark complete' : 'Reactivate'}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<!-- ======== ROUNDS ======== -->
<section class="mb-10">
  <header class="mb-4">
    <SectionLabel>Rounds</SectionLabel>
    <h2 class="text-2xl font-bold text-fg mt-1">Round management</h2>
    <p class="text-xs text-fg-dim mt-1">
      Set round numbers, tags, and theme submitters. Edits save on blur.
    </p>
  </header>

  <div class="flex flex-col gap-4">
    {#each data.leagues as league (league.id)}
      {@const leagueRounds = data.leagueRounds[league.id] ?? []}
      <div class="bg-surface border border-border-muted rounded-xl overflow-hidden">
        <!-- League header / toggle -->
        <button
          type="button"
          onclick={() => toggleRoundsExpanded(league.id)}
          class="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-hover transition-colors"
        >
          <span class="font-bold text-fg flex-1">{league.name}</span>
          <span class="font-mono text-[10px] text-fg-faint">{leagueRounds.length} rounds</span>
          <span class="text-fg-faint text-sm">{roundsExpanded[league.id] ? '▲' : '▼'}</span>
        </button>

        {#if roundsExpanded[league.id]}
          {#if leagueRounds.length === 0}
            <p class="px-5 py-3 text-xs text-fg-dim italic border-t border-border-muted">No rounds yet.</p>
          {:else}
            <!-- Desktop table -->
            <div class="hidden md:block overflow-x-auto border-t border-border-muted">
              <table class="w-full text-sm">
                <thead>
                  <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint border-b border-border-muted">
                    <th class="text-left px-4 py-2 font-bold w-16">#</th>
                    <th class="text-left px-4 py-2 font-bold">Theme</th>
                    <th class="text-left px-4 py-2 font-bold w-20">Season</th>
                    <th class="text-left px-4 py-2 font-bold w-20">Status</th>
                    <th class="text-left px-4 py-2 font-bold w-28">Tag</th>
                    <th class="text-left px-4 py-2 font-bold w-36">Submitted by</th>
                  </tr>
                </thead>
                <tbody>
                  {#each leagueRounds as round (round.id)}
                    {@const edit = getRoundEdit(round)}
                    <tr class="border-t border-border-muted hover:bg-surface-hover">
                      <!-- Round number -->
                      <td class="px-4 py-1.5">
                        <input
                          type="number"
                          value={edit.roundNumber}
                          min="1"
                          oninput={(e) => {
                            const val = (e.target as HTMLInputElement).value;
                            roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), roundNumber: val } };
                          }}
                          onblur={() => {
                            const val = edit.roundNumber.trim();
                            saveRoundField(round.id, 'round_number', val === '' ? null : Number(val));
                          }}
                          class="w-14 bg-bg-elevated border border-border-muted rounded px-1.5 py-1 text-sm text-fg focus:border-accent focus:outline-none text-center"
                        />
                      </td>
                      <!-- Theme name -->
                      <td class="px-4 py-1.5">
                        <input
                          type="text"
                          value={edit.name}
                          oninput={(e) => {
                            const val = (e.target as HTMLInputElement).value;
                            roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), name: val } };
                          }}
                          onblur={() => {
                            if (edit.name.trim() && edit.name.trim() !== round.name) {
                              saveRoundField(round.id, 'name', edit.name.trim());
                            }
                          }}
                          class="w-full min-w-[140px] bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </td>
                      <!-- Season -->
                      <td class="px-4 py-1.5 font-mono text-xs text-fg-muted">S{round.seasonNumber}</td>
                      <!-- Status chip -->
                      <td class="px-4 py-1.5">
                        <StatusChip
                          label={round.phase === 'submission' ? 'OPEN' : round.phase === 'voting' ? 'VOTING' : round.phase === 'archive' ? 'DONE' : 'UPCOMING'}
                          tone={round.phase === 'submission' ? 'health' : round.phase === 'voting' ? 'warn' : 'muted'}
                        />
                      </td>
                      <!-- Tag -->
                      <td class="px-4 py-1.5">
                        <input
                          type="text"
                          value={edit.tag}
                          placeholder="e.g. 90s"
                          oninput={(e) => {
                            const val = (e.target as HTMLInputElement).value;
                            roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), tag: val } };
                          }}
                          onblur={() => saveRoundField(round.id, 'tag', edit.tag.trim() || null)}
                          class="w-full bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </td>
                      <!-- Submitted by -->
                      <td class="px-4 py-1.5">
                        <select
                          value={edit.submittedBy}
                          onchange={(e) => {
                            const val = (e.target as HTMLSelectElement).value;
                            roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), submittedBy: val } };
                            saveRoundField(round.id, 'theme_submitted_by', val === '' ? null : Number(val));
                          }}
                          class="w-full bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each data.players as p (p.id)}
                            <option value={p.id}>{p.name}</option>
                          {/each}
                        </select>
                        {#if edit.saving}
                          <span class="font-mono text-[9px] text-fg-faint">saving…</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Mobile cards -->
            <div class="md:hidden divide-y divide-border-muted border-t border-border-muted">
              {#each leagueRounds as round (round.id)}
                {@const edit = getRoundEdit(round)}
                <div class="p-4 flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[10px] text-fg-faint w-5">#</span>
                    <input
                      type="number"
                      value={edit.roundNumber}
                      min="1"
                      oninput={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), roundNumber: val } };
                      }}
                      onblur={() => {
                        const val = edit.roundNumber.trim();
                        saveRoundField(round.id, 'round_number', val === '' ? null : Number(val));
                      }}
                      class="w-16 bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                    <StatusChip
                      label={round.phase === 'submission' ? 'OPEN' : round.phase === 'voting' ? 'VOTING' : round.phase === 'archive' ? 'DONE' : 'UPCOMING'}
                      tone={round.phase === 'submission' ? 'health' : round.phase === 'voting' ? 'warn' : 'muted'}
                    />
                    <span class="font-mono text-[10px] text-fg-faint ml-auto">S{round.seasonNumber}</span>
                  </div>
                  <input
                    type="text"
                    value={edit.name}
                    placeholder="Theme name"
                    oninput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), name: val } };
                    }}
                    onblur={() => {
                      if (edit.name.trim() && edit.name.trim() !== round.name) {
                        saveRoundField(round.id, 'name', edit.name.trim());
                      }
                    }}
                    class="w-full bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                  />
                  <div class="flex gap-2">
                    <input
                      type="text"
                      value={edit.tag}
                      placeholder="Tag (e.g. 90s)"
                      oninput={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), tag: val } };
                      }}
                      onblur={() => saveRoundField(round.id, 'tag', edit.tag.trim() || null)}
                      class="flex-1 bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                    <select
                      value={edit.submittedBy}
                      onchange={(e) => {
                        const val = (e.target as HTMLSelectElement).value;
                        roundEdits = { ...roundEdits, [round.id]: { ...getRoundEditById(round.id), submittedBy: val } };
                        saveRoundField(round.id, 'theme_submitted_by', val === '' ? null : Number(val));
                      }}
                      class="flex-1 bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                    >
                      <option value="">Submitted by…</option>
                      {#each data.players as p (p.id)}
                        <option value={p.id}>{p.name}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Add round form -->
          {@const addForm = getAddRoundForm(league.id)}
          <div class="border-t border-border-muted px-5 py-4">
            <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-3">Add round</div>
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap gap-2 items-end">
                <div class="flex-1 min-w-[160px]">
                  <label class="block font-mono text-[10px] text-fg-faint mb-1" for="add-round-name-{league.id}">Theme / name</label>
                  <input
                    id="add-round-name-{league.id}"
                    type="text"
                    value={addForm.name}
                    placeholder="e.g. Songs about rain"
                    oninput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      addRoundForms = { ...addRoundForms, [league.id]: { ...getAddRoundForm(league.id), name: val } };
                    }}
                    class="w-full bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-mono text-[10px] text-fg-faint mb-1" for="add-round-sub-{league.id}">Sub deadline</label>
                  <input
                    id="add-round-sub-{league.id}"
                    type="datetime-local"
                    value={addForm.subDeadline}
                    oninput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      addRoundForms = { ...addRoundForms, [league.id]: { ...getAddRoundForm(league.id), subDeadline: val } };
                    }}
                    class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-mono text-[10px] text-fg-faint mb-1" for="add-round-vote-{league.id}">Vote deadline</label>
                  <input
                    id="add-round-vote-{league.id}"
                    type="datetime-local"
                    value={addForm.voteDeadline}
                    oninput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      addRoundForms = { ...addRoundForms, [league.id]: { ...getAddRoundForm(league.id), voteDeadline: val } };
                    }}
                    class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addForm.setActive}
                    onchange={(e) => {
                      const val = (e.target as HTMLInputElement).checked;
                      addRoundForms = { ...addRoundForms, [league.id]: { ...getAddRoundForm(league.id), setActive: val } };
                    }}
                    class="accent-accent"
                  />
                  <span class="font-mono text-[10px] uppercase text-fg-muted">Set as active round</span>
                </label>
                <button
                  type="button"
                  onclick={() => addRound(league.id)}
                  disabled={!addForm.name.trim() || addForm.saving}
                  class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-1.5 rounded-md transition-colors"
                >
                  {addForm.saving ? 'Adding…' : '+ Add round'}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</section>

<!-- ======== COMPETITORS ======== -->
<section class="mb-10">
  <header class="mb-4">
    <SectionLabel>Competitors</SectionLabel>
    <h2 class="text-2xl font-bold text-fg mt-1">ML competitor roster</h2>
    <p class="text-xs text-fg-dim mt-1">
      Link Music League competitor accounts to players. Unlinked competitors are shown first.
    </p>
  </header>

  {#if unlinkedCompetitors.length > 0}
    <div class="mb-4 bg-warn/10 border border-warn/40 rounded-xl p-4">
      <div class="font-mono text-[10px] tracking-widest uppercase text-warn mb-3">
        {unlinkedCompetitors.length} unlinked competitor{unlinkedCompetitors.length === 1 ? '' : 's'} — action required
      </div>
      <div class="flex flex-col gap-2">
        {#each unlinkedCompetitors as comp (comp.id)}
          <div class="flex flex-wrap items-center gap-3 bg-surface border border-warn/30 rounded-lg px-4 py-2.5">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-fg">{comp.name}</div>
              <div class="font-mono text-[10px] text-fg-faint mt-0.5">
                {comp.ml_competitor_id.slice(0, 8)}…
                {#if comp.leagues}
                  · {comp.leagues}
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <select
                bind:value={competitorLink[comp.id]}
                disabled={competitorSaving[comp.id]}
                onchange={() => setCompetitorLink(comp.id, competitorLink[comp.id])}
                class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors disabled:opacity-50 max-w-[180px]"
              >
                <option value="">— unlinked —</option>
                {#each data.players as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
              {#if competitorSaving[comp.id]}
                <span class="font-mono text-[10px] text-fg-faint">saving…</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if linkedCompetitors.length > 0}
    <div class="bg-surface border border-border-muted rounded-xl overflow-hidden">
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint px-4 py-2.5 border-b border-border-muted">
        Linked competitors ({linkedCompetitors.length})
      </div>
      <!-- Desktop table -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint border-b border-border-muted">
              <th class="text-left px-4 py-2 font-bold">Name</th>
              <th class="text-left px-4 py-2 font-bold w-28">ID</th>
              <th class="text-left px-4 py-2 font-bold">Leagues</th>
              <th class="text-left px-4 py-2 font-bold w-44">Linked player</th>
            </tr>
          </thead>
          <tbody>
            {#each linkedCompetitors as comp (comp.id)}
              <tr class="border-t border-border-muted hover:bg-surface-hover">
                <td class="px-4 py-2 font-medium text-fg">{comp.name}</td>
                <td class="px-4 py-2 font-mono text-[10px] text-fg-faint">{comp.ml_competitor_id.slice(0, 8)}…</td>
                <td class="px-4 py-2 text-fg-muted text-xs">{comp.leagues ?? '—'}</td>
                <td class="px-4 py-2">
                  <div class="flex items-center gap-2">
                    <select
                      bind:value={competitorLink[comp.id]}
                      disabled={competitorSaving[comp.id]}
                      onchange={() => setCompetitorLink(comp.id, competitorLink[comp.id])}
                      class="w-full bg-bg-elevated border border-border-muted rounded px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
                    >
                      <option value="">— unlinked —</option>
                      {#each data.players as p (p.id)}
                        <option value={p.id}>{p.name}</option>
                      {/each}
                    </select>
                    {#if competitorSaving[comp.id]}
                      <span class="font-mono text-[10px] text-fg-faint whitespace-nowrap">saving…</span>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <!-- Mobile cards -->
      <div class="md:hidden divide-y divide-border-muted">
        {#each linkedCompetitors as comp (comp.id)}
          <div class="px-4 py-3 flex flex-col gap-2">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-medium text-fg">{comp.name}</div>
                <div class="font-mono text-[10px] text-fg-faint mt-0.5">
                  {comp.ml_competitor_id.slice(0, 8)}…{#if comp.leagues} · {comp.leagues}{/if}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <select
                bind:value={competitorLink[comp.id]}
                disabled={competitorSaving[comp.id]}
                onchange={() => setCompetitorLink(comp.id, competitorLink[comp.id])}
                class="flex-1 bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">— unlinked —</option>
                {#each data.players as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
              {#if competitorSaving[comp.id]}
                <span class="font-mono text-[10px] text-fg-faint">saving…</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<!-- ======== PLAYERS ======== -->
<section>
  <header class="mb-4">
    <SectionLabel>Players</SectionLabel>
    <h2 class="text-2xl font-bold text-fg mt-1">Player roster</h2>
    <p class="text-xs text-fg-dim mt-1">
      Manage players, identities, relationships, and season memberships.
    </p>
  </header>

  <!-- Add-player card -->
  <div class="bg-surface border border-border-muted rounded-xl p-5 mb-6">
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-3">Add player</div>
    <div class="flex flex-wrap gap-3 items-end">
      <div>
        <label class="block font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-1.5" for="new-name">Name</label>
        <input
          id="new-name"
          type="text"
          bind:value={newName}
          placeholder="Player name"
          class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors w-48"
        />
      </div>
      <button
        type="button"
        onclick={addPlayer}
        disabled={!newName.trim() || addingPlayer}
        class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
      >
        {addingPlayer ? 'Adding…' : 'Add player'}
      </button>
    </div>
  </div>

  <!-- Player list -->
  {#if data.players.length === 0}
    <p class="text-fg-dim text-sm italic">No players yet. Add one above.</p>
  {:else}
    <div class="flex flex-col gap-3">
      {#each data.players as player (player.id)}
        <div class="bg-surface border border-border-muted rounded-xl overflow-hidden">
          <!-- Player header row -->
          <div class="flex items-center gap-3 px-5 py-3">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-fg">{player.name}</div>
              {#if player.age != null}
                <div class="font-mono text-[10px] text-fg-faint mt-0.5">Age {player.age}</div>
              {/if}
            </div>
            <!-- Identity chips -->
            <div class="flex flex-wrap gap-1 min-w-0">
              {#each player.identities as ident (ident.id)}
                <span
                  class="font-mono text-[10px] px-2 py-0.5 rounded-sm border border-accent/40 bg-accent-bg text-accent"
                  title="{ident.identity_type}{ident.league_id ? ' (scoped)' : ''}"
                >
                  {ident.identity_type.slice(0, 2).toUpperCase()} · {ident.identifier.slice(0, 12)}{ident.identifier.length > 12 ? '…' : ''}
                </span>
              {/each}
            </div>
            <button
              type="button"
              onclick={() => editingId === player.id ? cancelEdit() : startEdit(player)}
              class="font-mono text-[10px] tracking-widest uppercase text-fg-dim hover:text-accent transition-colors shrink-0"
            >
              {editingId === player.id ? 'Close' : 'Edit'}
            </button>
          </div>

          {#if editingId === player.id}
            <div class="border-t border-border-muted px-5 py-4 flex flex-col gap-5">

              <!-- Name + Age row -->
              <div>
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Basic info</div>
                <div class="flex flex-wrap gap-3 items-end">
                  <div>
                    <label class="block font-mono text-[10px] text-fg-faint mb-1" for="edit-name-{player.id}">Name</label>
                    <input
                      id="edit-name-{player.id}"
                      type="text"
                      bind:value={editName}
                      onblur={saveNameAge}
                      class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none w-44"
                    />
                  </div>
                  <div>
                    <label class="block font-mono text-[10px] text-fg-faint mb-1" for="edit-age-{player.id}">Age</label>
                    <input
                      id="edit-age-{player.id}"
                      type="number"
                      min="0"
                      max="150"
                      bind:value={editAge}
                      onblur={saveNameAge}
                      placeholder="—"
                      class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none w-20"
                    />
                  </div>
                  {#if editSaving}
                    <span class="font-mono text-[10px] text-fg-faint">saving…</span>
                  {/if}
                </div>
              </div>

              <!-- Season memberships -->
              <div>
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Season memberships</div>
                <div class="flex flex-wrap gap-1">
                  {#each data.allSeasons as s (s.id)}
                    {@const isMember = player.seasonIds.includes(s.id)}
                    {@const key = `${player.id}-${s.id}`}
                    <button
                      type="button"
                      onclick={() => toggleMembership(player, s.id)}
                      disabled={membershipSaving[key]}
                      title="{s.leagueName} S{s.seasonNumber}"
                      class="font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 {isMember
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                    >
                      {s.leagueName.slice(0, 3).toUpperCase()} S{s.seasonNumber}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Identities -->
              <div>
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Identities</div>
                {#if player.identities.length > 0}
                  <div class="flex flex-col gap-1.5 mb-3">
                    {#each player.identities as ident (ident.id)}
                      <div class="flex items-center gap-2 bg-bg-elevated border border-border-muted rounded-md px-3 py-1.5 text-sm">
                        <span class="font-mono text-[10px] uppercase text-accent min-w-[80px]">{ident.identity_type}</span>
                        <span class="text-fg flex-1 truncate">{ident.identifier}</span>
                        {#if ident.league_id != null}
                          <span class="font-mono text-[9px] text-fg-faint">
                            {data.leagues.find(l => l.id === ident.league_id)?.name ?? `league ${ident.league_id}`}
                          </span>
                        {/if}
                        <button
                          type="button"
                          onclick={() => deleteIdentity(player.id, ident.id)}
                          disabled={deletingIdentity[ident.id]}
                          class="font-mono text-[10px] text-fg-dim hover:text-warn transition-colors disabled:opacity-50"
                        >
                          ✕
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if showAddIdentity && editingId === player.id}
                  <div class="flex flex-col gap-2 bg-bg-elevated border border-border-muted rounded-md p-3 mb-2">
                    <div class="flex flex-wrap gap-2">
                      <select
                        bind:value={newIdentityType}
                        class="bg-bg border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                      >
                        <option value="whatsapp">WhatsApp</option>
                        <option value="google-chat">Google Chat</option>
                        <option value="music-league">Music League</option>
                      </select>
                      <select
                        bind:value={newIdentityLeague}
                        class="bg-bg border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                      >
                        <option value="">All leagues</option>
                        {#each data.leagues as l (l.id)}
                          <option value={l.id}>{l.name}</option>
                        {/each}
                      </select>
                    </div>
                    <input
                      type="text"
                      bind:value={newIdentityId}
                      placeholder={identityPlaceholders[newIdentityType]}
                      class="w-full bg-bg border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                    <div class="text-[10px] text-fg-faint italic">{identityPlaceholders[newIdentityType]}</div>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        onclick={() => addIdentity(player.id)}
                        disabled={!newIdentityId.trim() || addingIdentity}
                        class="bg-accent hover:bg-accent-strong disabled:opacity-50 text-bg-elevated font-mono text-[10px] tracking-widest uppercase font-bold px-3 py-1.5 rounded transition-colors"
                      >
                        {addingIdentity ? 'Adding…' : 'Add'}
                      </button>
                      <button
                        type="button"
                        onclick={() => { showAddIdentity = false; }}
                        class="font-mono text-[10px] uppercase text-fg-dim hover:text-fg transition-colors px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={() => { showAddIdentity = true; }}
                    class="font-mono text-[10px] tracking-widest uppercase border border-border-muted text-fg-faint hover:text-fg hover:border-accent px-3 py-1 rounded-md transition-colors"
                  >
                    + Add identity
                  </button>
                {/if}
              </div>

              <!-- Relationships -->
              <div>
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Relationships</div>
                {#if player.relationships.length > 0}
                  <div class="flex flex-col gap-1.5 mb-3">
                    {#each player.relationships as rel (rel.id)}
                      <div class="flex items-center gap-2 bg-bg-elevated border border-border-muted rounded-md px-3 py-1.5 text-sm">
                        <span class="text-fg font-medium min-w-[100px]">{rel.related_player_name}</span>
                        <span class="font-mono text-[10px] uppercase text-fg-muted flex-1">
                          {rel.relationship_type}{rel.relationship_note ? ` · ${rel.relationship_note}` : ''}
                        </span>
                        <button
                          type="button"
                          onclick={() => deleteRelationship(player.id, rel.id)}
                          disabled={deletingRel[rel.id]}
                          class="font-mono text-[10px] text-fg-dim hover:text-warn transition-colors disabled:opacity-50"
                        >
                          ✕
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Add relationship form -->
                <div class="flex flex-wrap gap-2 items-end">
                  <select
                    bind:value={newRelatedPlayer}
                    class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                  >
                    <option value="">Player…</option>
                    {#each data.players.filter(p => p.id !== player.id) as p (p.id)}
                      <option value={p.id}>{p.name}</option>
                    {/each}
                  </select>
                  <select
                    bind:value={newRelType}
                    class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                  >
                    <option value="">Type…</option>
                    {#each REL_TYPES as t}
                      <option value={t}>{t}</option>
                    {/each}
                  </select>
                  {#if newRelType === 'other'}
                    <input
                      type="text"
                      bind:value={newRelNote}
                      placeholder="Describe (e.g. college roommate)"
                      class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none w-48"
                    />
                  {/if}
                  <button
                    type="button"
                    onclick={() => addRelationship(player.id)}
                    disabled={!newRelatedPlayer || !newRelType || (newRelType === 'other' && !newRelNote.trim()) || addingRel}
                    class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-[10px] tracking-widest uppercase font-bold px-3 py-1.5 rounded transition-colors"
                  >
                    {addingRel ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>

            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
