<script lang="ts">
  import type { PageData } from './$types.js';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';

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

  let selectedRound = $state<Record<number, number | ''>>(
    Object.fromEntries(data.leagues.map(l => [l.id, l.activeRoundId ?? ''])),
  );

  $effect(() => {
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

  let editingId = $state<number | null>(null);
  let editName = $state('');
  // Bound to a type="number" input, so Svelte stores a number (or null when blank) —
  // NOT a string. Treating it as a string (.trim()) is what wedged the save spinner.
  let editAge = $state<number | null>(null);
  let editSaving = $state(false);

  // ---- avatar editor (operates on the currently-edited player) -------------
  const AV_STYLES = ['average', 'skater', 'preppy', 'formal', 'jock', 'punk', 'bohemian'];
  const AV_GENDERS = ['male', 'female', 'nonbinary'];
  const AV_HEIGHTS = ['petite', 'short', 'average', 'tall', 'very tall'];
  const AV_BUILDS = ['lanky', 'medium', 'athletic', 'thick'];

  let avTraits = $state({ gender: '', style: '', height: '', build: '', hair: '', trait: '' });
  let avSaving = $state(false);
  let avGenerating = $state(false);
  let avUploading = $state(false);
  let avHasBase = $state(false);
  let avBaseSource = $state<string | null>(null);
  let avBaseCost = $state<number | null>(null);   // last base-gen cost (USD), null if uploaded/never
  let avThemedCost = $state<number | null>(null);  // last themed-gen cost (USD)
  let avBaseVersion = $state(0); // bumps to cache-bust the preview <img> after a new base lands

  function startEdit(player: Player) {
    editingId = player.id;
    editName = player.name;
    editAge = player.age ?? null;
    avTraits = {
      gender: player.avatar.gender,
      style: player.avatar.style,
      height: player.avatar.height,
      build: player.avatar.build,
      hair: player.avatar.hair,
      trait: player.avatar.trait,
    };
    avHasBase = player.avatar.hasBase;
    avBaseSource = player.avatar.baseSource;
    avBaseCost = player.avatar.baseCostUsd;
    avThemedCost = player.avatar.themedCostUsd;
    avBaseVersion = 0;
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

  // Persist the six avatar trait columns. Called on every control change so the
  // generate-base endpoint (which reads traits from the DB) always sees current values.
  async function saveTraits() {
    if (!editingId || avSaving) return;
    avSaving = true;
    const res = await apiCall(`/api/players/${editingId}/avatar/traits`, 'PATCH', {
      avatar_gender: avTraits.gender,
      avatar_style: avTraits.style,
      avatar_height: avTraits.height,
      avatar_build: avTraits.build,
      avatar_hair: avTraits.hair,
      avatar_trait: avTraits.trait,
    });
    avSaving = false;
    if (!res.ok) showBanner('Error saving avatar traits', 'warn');
  }

  function setTrait<K extends keyof typeof avTraits>(key: K, value: string) {
    // Toggle off a pill if the same value is clicked again.
    avTraits[key] = avTraits[key] === value ? '' : value;
    saveTraits();
  }

  async function generateBase() {
    if (!editingId || avGenerating) return;
    if (!avTraits.gender || !avTraits.style) return;
    avGenerating = true;
    // Make sure the latest traits are persisted before the server reads them.
    await saveTraits();
    const res = await apiCall(`/api/players/${editingId}/avatar/generate-base`, 'POST');
    avGenerating = false;
    if (!res.ok) {
      const msg = await res.json().then(j => j.error).catch(() => 'Generate failed');
      showBanner(`Avatar generate failed: ${msg}`, 'warn');
      return;
    }
    const gen = await res.json().catch(() => ({}));
    avHasBase = true;
    avBaseSource = 'generated';
    avBaseCost = typeof gen.costUsd === 'number' ? gen.costUsd : null;
    avBaseVersion += 1;
    showBanner('Base avatar generated');
    await invalidateAll();
  }

  let avFileInput = $state<HTMLInputElement | null>(null);

  async function uploadBase(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !editingId) return;
    if (file.size > 5 * 1024 * 1024) {
      showBanner('Image too large (max 5MB)', 'warn');
      input.value = '';
      return;
    }
    avUploading = true;
    const fd = new FormData();
    fd.append('avatar', file);
    const res = await fetch(`/api/players/${editingId}/avatar/upload`, { method: 'POST', body: fd });
    avUploading = false;
    input.value = '';
    if (!res.ok) {
      const msg = await res.json().then(j => j.error).catch(() => 'Upload failed');
      showBanner(`Avatar upload failed: ${msg}`, 'warn');
      return;
    }
    avHasBase = true;
    avBaseSource = 'uploaded';
    avBaseCost = null;
    avBaseVersion += 1;
    showBanner('Base avatar uploaded');
    await invalidateAll();
  }

  async function saveNameAge() {
    if (!editingId || editSaving) return;
    editSaving = true;
    try {
      const body: Record<string, unknown> = {};
      if (editName.trim()) body.name = editName.trim();
      // editAge is a number (or null when blank) from the type="number" binding.
      const age = editAge;
      if (age === null || (Number.isInteger(age) && age >= 0 && age <= 150)) {
        body.age = age;
      }
      const res = await apiCall(`/api/players/${editingId}`, 'PATCH', body);
      if (!res.ok) { showBanner('Error saving player', 'warn'); return; }
      showBanner('Player updated');
      await invalidateAll();
    } finally {
      // Always release the spinner, even if a fetch throws — the old code left
      // "saving…" stuck forever when this function errored mid-way.
      editSaving = false;
    }
  }

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
  let roundsExpanded = $state<Record<number, boolean>>({});

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

  // ---- Auto-fill deadlines ------------------------------------------------
  type LeagueRow = { slug: string; name: string };
  type ActiveRoundRow = { leagueName: string; seasonNumber: number };
  const allLeagues = $derived(data.allLeagues as LeagueRow[]);

  const seasonsByLeagueSlug = $derived.by(() => {
    const map = new Map<string, number[]>();
    for (const r of (data.activeRounds as ActiveRoundRow[])) {
      const league = allLeagues.find((l: LeagueRow) => l.name === r.leagueName);
      if (!league) continue;
      const list = map.get(league.slug) ?? [];
      if (!list.includes(r.seasonNumber)) list.push(r.seasonNumber);
      map.set(league.slug, list);
    }
    for (const list of map.values()) list.sort((a, b) => a - b);
    return map;
  });

  const firstLeagueWithSeasons = $derived(
    allLeagues.find((l) => (seasonsByLeagueSlug.get(l.slug)?.length ?? 0) > 0)?.slug ??
      allLeagues[0]?.slug ??
      ''
  );

  let afLeague = $state('');
  let afSeason = $state<number | ''>('');
  let afDaysToSubmit = $state(4);
  let afDaysToVote = $state(3);
  let afStartDate = $state(new Date().toISOString().slice(0, 10));
  let afStatus = $state<{ tone: 'health' | 'warn'; label: string } | null>(null);
  let afSubmitting = $state(false);

  let deadlinesOpen = $state(false);

  const afSeasonOptions = $derived(seasonsByLeagueSlug.get(afLeague) ?? []);

  $effect(() => {
    if (!afLeague && firstLeagueWithSeasons) afLeague = firstLeagueWithSeasons;
  });
  $effect(() => {
    const opts = afSeasonOptions;
    if (opts.length === 0) {
      afSeason = '';
    } else if (typeof afSeason !== 'number' || !opts.includes(afSeason)) {
      afSeason = opts[0];
    }
  });

  async function autoFillDeadlines() {
    if (!afLeague || afSeason === '' || afSubmitting) return;
    afSubmitting = true;
    afStatus = null;
    try {
      const res = await fetch('/api/deadlines/auto-fill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          league: afLeague,
          season: afSeason,
          daysToSubmit: afDaysToSubmit,
          daysToVote: afDaysToVote,
          startDate: afStartDate
        })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        afStatus = {
          tone: 'warn',
          label: (err?.error ?? `HTTP ${res.status}`).toString().toUpperCase()
        };
        return;
      }
      const body = (await res.json()) as { updated: number };
      afStatus = {
        tone: 'health',
        label: `AUTO-FILLED · ${body.updated} ROUND${body.updated === 1 ? '' : 'S'}`
      };
      await invalidateAll();
    } catch (e) {
      afStatus = {
        tone: 'warn',
        label: (e instanceof Error ? e.message : 'NETWORK ERROR').toUpperCase()
      };
    } finally {
      afSubmitting = false;
    }
  }
</script>

<svelte:head><title>Music League Setup · music-league-bot</title></svelte:head>

<!-- Banner -->
{#if banner}
  <div class="fixed bottom-6 right-6 z-50">
    <StatusChip label={banner.label} tone={banner.tone} />
  </div>
{/if}

<!-- Page header -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · /settings/setup
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">Music League Setup</h1>
  <p class="text-fg-muted max-w-2xl">
    Manage leagues, seasons, active rounds, players, and round metadata.
  </p>
</div>

<SettingsTabs />

<div class="mt-6">

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
                      <td class="px-4 py-1.5 font-mono text-xs text-fg-muted">S{round.seasonNumber}</td>
                      <td class="px-4 py-1.5">
                        <StatusChip
                          label={round.phase === 'submission' ? 'OPEN' : round.phase === 'voting' ? 'VOTING' : round.phase === 'archive' ? 'DONE' : 'UPCOMING'}
                          tone={round.phase === 'submission' ? 'health' : round.phase === 'voting' ? 'warn' : 'muted'}
                        />
                      </td>
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
<section class="mb-10">
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

  {#if data.players.length === 0}
    <p class="text-fg-dim text-sm italic">No players yet. Add one above.</p>
  {:else}
    <div class="flex flex-col gap-3">
      {#each data.players as player (player.id)}
        <div class="bg-surface border border-border-muted rounded-xl overflow-hidden">
          <div class="flex items-center gap-3 px-5 py-3">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-fg">{player.name}</div>
              {#if player.age != null}
                <div class="font-mono text-[10px] text-fg-faint mt-0.5">Age {player.age}</div>
              {/if}
            </div>
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

              <div>
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2 flex items-center gap-2">
                  Avatar
                  {#if avSaving}<span class="text-fg-faint normal-case tracking-normal">saving…</span>{/if}
                </div>
                <div class="flex flex-col sm:flex-row gap-5">
                  <!-- Base avatar preview + actions -->
                  <div class="flex flex-col items-center gap-2 shrink-0">
                    <div class="w-24 h-24 rounded-xl overflow-hidden border border-border-muted bg-bg-elevated flex items-center justify-center">
                      {#if avHasBase}
                        <img
                          src="/api/avatars/{player.id}/base?v={avBaseVersion}"
                          alt="Base avatar for {player.name}"
                          class="w-full h-full object-cover"
                        />
                      {:else}
                        <span class="font-mono text-[9px] text-fg-faint text-center px-2">no base avatar</span>
                      {/if}
                    </div>
                    <div class="flex gap-1.5">
                      <button
                        type="button"
                        onclick={generateBase}
                        disabled={avGenerating || avUploading || !avTraits.gender || !avTraits.style}
                        title={!avTraits.gender || !avTraits.style ? 'Set gender and style first' : 'Generate from traits'}
                        class="font-mono text-[10px] px-2 py-1 rounded-sm border border-border-muted text-fg-dim hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {avGenerating ? 'generating…' : avHasBase ? 'Regenerate' : 'Generate'}
                      </button>
                      <button
                        type="button"
                        onclick={() => avFileInput?.click()}
                        disabled={avGenerating || avUploading}
                        class="font-mono text-[10px] px-2 py-1 rounded-sm border border-border-muted text-fg-dim hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
                      >
                        {avUploading ? 'uploading…' : 'Upload'}
                      </button>
                      <input
                        bind:this={avFileInput}
                        type="file"
                        accept="image/png,image/jpeg"
                        onchange={uploadBase}
                        class="hidden"
                      />
                    </div>
                    {#if avHasBase && avBaseSource}
                      <span class="font-mono text-[9px] text-fg-faint">
                        {avBaseSource}{#if avBaseCost != null} · base ${avBaseCost.toFixed(3)}{/if}{#if avThemedCost != null} · themed ${avThemedCost.toFixed(3)}{/if}
                      </span>
                    {/if}
                  </div>

                  <!-- Trait controls -->
                  <div class="flex-1 flex flex-col gap-3">
                    <div>
                      <div class="font-mono text-[10px] text-fg-faint mb-1">Style</div>
                      <div class="flex flex-wrap gap-1">
                        {#each AV_STYLES as s (s)}
                          <button
                            type="button"
                            onclick={() => setTrait('style', s)}
                            class="font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-colors {avTraits.style === s
                              ? 'border-accent bg-accent-bg text-accent'
                              : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                          >{s}</button>
                        {/each}
                      </div>
                    </div>
                    <div>
                      <div class="font-mono text-[10px] text-fg-faint mb-1">Gender</div>
                      <div class="flex flex-wrap gap-1">
                        {#each AV_GENDERS as g (g)}
                          <button
                            type="button"
                            onclick={() => setTrait('gender', g)}
                            class="font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-colors {avTraits.gender === g
                              ? 'border-accent bg-accent-bg text-accent'
                              : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                          >{g}</button>
                        {/each}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-3">
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-height-{player.id}">Height</label>
                        <select
                          id="av-height-{player.id}"
                          bind:value={avTraits.height}
                          onchange={saveTraits}
                          class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each AV_HEIGHTS as h (h)}<option value={h}>{h}</option>{/each}
                        </select>
                      </div>
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-build-{player.id}">Build</label>
                        <select
                          id="av-build-{player.id}"
                          bind:value={avTraits.build}
                          onchange={saveTraits}
                          class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each AV_BUILDS as b (b)}<option value={b}>{b}</option>{/each}
                        </select>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-3">
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-hair-{player.id}">Hair</label>
                        <input
                          id="av-hair-{player.id}"
                          type="text"
                          bind:value={avTraits.hair}
                          onblur={saveTraits}
                          placeholder="e.g. curly red shoulder-length"
                          class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none w-52"
                        />
                      </div>
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-trait-{player.id}">Freeform trait</label>
                        <input
                          id="av-trait-{player.id}"
                          type="text"
                          bind:value={avTraits.trait}
                          onblur={saveTraits}
                          placeholder="e.g. round glasses, denim jacket"
                          class="bg-bg-elevated border border-border-muted rounded px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none w-52"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
                          ×
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
                          ×
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

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

<!-- ======== AUTO-FILL DEADLINES ======== -->
<section class="bg-surface border border-border-muted rounded-xl p-6 mb-6">
  <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
    <div>
      <SectionLabel>Auto-fill</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">Bulk-set deadlines for a season</h2>
    </div>
    {#if afStatus}
      <StatusChip label={afStatus.label} tone={afStatus.tone} />
    {/if}
  </header>
  <p class="text-xs text-fg-dim mb-5">
    Picks the first round's start = <span class="font-mono text-fg">start date</span>, then chains
    <span class="font-mono text-fg">+ days-to-submit</span> →
    <span class="font-mono text-fg">+ days-to-vote</span> through every round in the season (zero buffer).
  </p>

  <div class="flex flex-wrap gap-3 items-end">
    <div>
      <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="af-league">League</label>
      <select
        id="af-league"
        bind:value={afLeague}
        disabled={allLeagues.length === 0}
        class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
      >
        {#each allLeagues as l (l.slug)}
          <option value={l.slug}>{l.name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="af-season">Season</label>
      <select
        id="af-season"
        bind:value={afSeason}
        disabled={afSeasonOptions.length === 0}
        class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
      >
        {#if afSeasonOptions.length === 0}
          <option value="">no active</option>
        {:else}
          {#each afSeasonOptions as n (n)}
            <option value={n}>Season {n}</option>
          {/each}
        {/if}
      </select>
    </div>
    <div>
      <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="af-submit">Days to submit</label>
      <input
        id="af-submit"
        type="number"
        min="1"
        max="60"
        bind:value={afDaysToSubmit}
        class="w-20 bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg font-mono focus:border-accent focus:outline-none transition-colors"
      />
    </div>
    <div>
      <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="af-vote">Days to vote</label>
      <input
        id="af-vote"
        type="number"
        min="1"
        max="60"
        bind:value={afDaysToVote}
        class="w-20 bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg font-mono focus:border-accent focus:outline-none transition-colors"
      />
    </div>
    <div>
      <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="af-start">Start date</label>
      <input
        id="af-start"
        type="date"
        bind:value={afStartDate}
        class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg font-mono focus:border-accent focus:outline-none transition-colors"
      />
    </div>
    <button
      type="button"
      onclick={autoFillDeadlines}
      disabled={!afLeague || afSeason === '' || afSubmitting}
      class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
    >
      {afSubmitting ? 'Filling…' : 'Auto-fill deadlines'}
    </button>
  </div>
</section>

<!-- ======== ROUND DEADLINES ======== -->
<details
  bind:open={deadlinesOpen}
  class="group bg-surface border border-border-muted rounded-xl [&>summary::-webkit-details-marker]:hidden"
>
  <summary
    class="cursor-pointer list-none flex items-center justify-between gap-3 p-6 hover:bg-surface-hover transition-colors rounded-xl"
  >
    <div class="flex items-center gap-3 min-w-0">
      <span
        class="inline-block text-accent text-sm font-mono transition-transform duration-150 shrink-0"
        style:transform={deadlinesOpen ? 'rotate(90deg)' : 'rotate(0)'}
        aria-hidden="true"
      >
        ▸
      </span>
      <SectionLabel>
        Round deadlines · {deadlinesOpen ? 'click to collapse' : 'click to expand'}
      </SectionLabel>
    </div>
    <span class="font-mono text-[11px] tracking-widest uppercase text-fg-dim shrink-0">
      {data.activeRounds.length} active
    </span>
  </summary>
  <div class="px-6 pb-6 pt-0">
    <p class="text-xs text-fg-dim mb-5">
      Submission and voting deadlines for active rounds. Drives the
      <span class="font-mono text-fg">SUBMISSIONS · 3D 14H</span> countdown chips on the home screen.
    </p>

    {#if data.activeRounds.length}
      <div class="flex flex-col gap-2">
        {#each data.activeRounds as r (r.id)}
          <form
            method="POST"
            action="?/updateDeadline"
            use:enhance
            class="flex flex-wrap items-center gap-3 text-sm bg-bg-elevated border border-border-muted rounded-md px-3 py-2"
          >
            <input type="hidden" name="roundId" value={r.id} />
            <span class="text-fg w-56 truncate">
              <span class="text-fg-dim">{r.leagueName} S{r.seasonNumber}</span>
              <span class="text-fg-faint"> · </span>
              {r.name}
            </span>
            <div class="flex items-center gap-2">
              <label class="font-mono text-[10px] tracking-widest uppercase text-accent" for="sub-{r.id}">Submit by</label>
              <input
                id="sub-{r.id}"
                type="datetime-local"
                name="submissionDeadline"
                value={r.submissionDeadline?.slice(0, 16) ?? ''}
                class="bg-bg border border-border-muted rounded-md px-2 py-1 text-xs text-fg font-mono focus:border-accent focus:outline-none transition-colors"
              />
            </div>
            <div class="flex items-center gap-2">
              <label class="font-mono text-[10px] tracking-widest uppercase text-health" for="vote-{r.id}">Vote by</label>
              <input
                id="vote-{r.id}"
                type="datetime-local"
                name="votingDeadline"
                value={r.votingDeadline?.slice(0, 16) ?? ''}
                class="bg-bg border border-border-muted rounded-md px-2 py-1 text-xs text-fg font-mono focus:border-accent focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              class="ml-auto border border-border text-fg-muted hover:text-fg hover:border-accent font-mono text-[10px] tracking-widest uppercase px-3 py-1 rounded-md transition-colors"
            >
              Save
            </button>
          </form>
        {/each}
      </div>
    {:else}
      <p class="text-fg-dim text-sm">No active rounds found.</p>
    {/if}
  </div>
</details>

</div><!-- /mt-6 wrapper -->
