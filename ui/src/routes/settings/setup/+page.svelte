<script lang="ts">
  import type { PageData } from './$types.js';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';
  import {
    AVATAR_GENDERS,
    AVATAR_RACES,
    AVATAR_HEIGHTS,
    AVATAR_BUILDS,
    AVATAR_HAIR_STYLES,
    AVATAR_HAIR_COLORS,
    stylesForGender,
  } from '$lib/avatarTraits.js';
  import { basePreviewUrl } from '$lib/avatarPreview.js';
  import TasteWaveform from '$lib/taste-waveform/TasteWaveform.svelte';
  import {
    tasteEngine,
    scopedLeague,
    DEFAULT_TASTE_SETTINGS,
  } from '$lib/taste-waveform/taste-waveform.js';
  import type { TasteSettings, TasteBlock } from '$lib/taste-waveform/taste-waveform.js';
  import CollapsiblePanel from '$lib/components/CollapsiblePanel.svelte';

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
  const AV_GENDERS = AVATAR_GENDERS;
  const AV_RACES = AVATAR_RACES;
  const AV_HEIGHTS = AVATAR_HEIGHTS;
  const AV_BUILDS = AVATAR_BUILDS;
  const AV_HAIR_STYLES = AVATAR_HAIR_STYLES;
  const AV_HAIR_COLORS = AVATAR_HAIR_COLORS;

  let avTraits = $state({
    gender: '', race: '', style: '', height: '', build: '', hairStyle: '', hairColor: '', trait: '',
  });
  // Style options depend on the selected gender (separate list per gender).
  const avStyleOptions = $derived(stylesForGender(avTraits.gender));
  let avSaving = $state(false);
  let avGenerating = $state(false);
  let avUploading = $state(false);
  let avHasBase = $state(false);
  let avBaseSource = $state<string | null>(null);
  let avBaseCost = $state<number | null>(null);   // last base-gen cost (USD), null if uploaded/never
  let avThemedCost = $state<number | null>(null);  // last themed-gen cost (USD)

  function startEdit(player: Player) {
    editingId = player.id;
    editName = player.name;
    editAge = player.age ?? null;
    avTraits = {
      gender: player.avatar.gender,
      race: player.avatar.race,
      style: player.avatar.style,
      height: player.avatar.height,
      build: player.avatar.build,
      hairStyle: player.avatar.hairStyle,
      hairColor: player.avatar.hairColor,
      trait: player.avatar.trait,
    };
    avHasBase = player.avatar.hasBase;
    avBaseSource = player.avatar.baseSource;
    avBaseCost = player.avatar.baseCostUsd;
    avThemedCost = player.avatar.themedCostUsd;
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
      avatar_race: avTraits.race,
      avatar_style: avTraits.style,
      avatar_height: avTraits.height,
      avatar_build: avTraits.build,
      avatar_hair_style: avTraits.hairStyle,
      avatar_hair_color: avTraits.hairColor,
      avatar_trait: avTraits.trait,
    });
    avSaving = false;
    if (!res.ok) showBanner('Error saving avatar traits', 'warn');
  }

  function setTrait<K extends keyof typeof avTraits>(key: K, value: string) {
    // Toggle off a pill if the same value is clicked again.
    avTraits[key] = avTraits[key] === value ? '' : value;
    // Changing gender re-scopes the style list; drop a now-invalid style.
    if (key === 'gender' && avTraits.style && !stylesForGender(avTraits.gender).includes(avTraits.style)) {
      avTraits.style = '';
    }
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

  onMount(() => {
    loadTasteSettings();
  });

  // ---- Taste Waveform settings panel --------------------------------------
  let tasteSettings = $state<TasteSettings>({ ...DEFAULT_TASTE_SETTINGS });
  let sampleBlock = $state<TasteBlock | null>(null);
  let tasteSaving = $state(false);
  let tasteStatus = $state<{ tone: 'health' | 'warn'; label: string } | null>(null);

  const SIGNAL_OPTIONS: { value: TasteSettings['signal']; label: string }[] = [
    { value: 'all', label: 'ALL' },
    { value: 'subs', label: 'SUBS' },
    { value: 'top', label: 'TOP' },
    { value: 'frac', label: 'VOTE%' },
  ];

  const sampleEng = $derived(
    sampleBlock
      ? tasteEngine({ axes: sampleBlock.axes, players: sampleBlock.players }, tasteSettings)
      : null,
  );

  // ---- League → Player picker state (Task 9) ---------------------------------
  let selectedLeagueId = $state<number | null>(null);
  let selectedPlayerIdx = $state(0);

  // Players present in the selected league (rows carry leagueId at index 5).
  const leaguePlayers = $derived(
    sampleBlock && selectedLeagueId != null
      ? sampleBlock.players
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.rows.some((r) => r[5] === selectedLeagueId))
      : (sampleBlock ? sampleBlock.players.map((p, i) => ({ p, i })) : []),
  );

  // Engine scoped to the chosen league (or all leagues when none chosen).
  const previewEng = $derived(
    sampleBlock
      ? tasteEngine(
          scopedLeague(sampleBlock, { ...tasteSettings, scopeAll: selectedLeagueId == null }, selectedLeagueId ?? undefined),
          tasteSettings,
        )
      : null,
  );

  // Index of the selected player within the scoped engine's player list.
  const previewPlayerIdx = $derived.by(() => {
    if (!sampleBlock || !previewEng) return 0;
    const targetName = sampleBlock.players[selectedPlayerIdx]?.name;
    for (let i = 0; i < previewEng.nP; i++) if (previewEng.name(i) === targetName) return i;
    return 0;
  });

  // Separation score derivation (Task 10).
  const separation = $derived.by(() => {
    if (!sampleBlock || !previewEng || previewEng.nP < 2) return null;
    const scope = { ...tasteSettings, scopeAll: selectedLeagueId == null };
    const lg = scopedLeague(sampleBlock, scope, selectedLeagueId ?? undefined);
    const score = tasteEngine(lg, tasteSettings).separation();
    const baseline = tasteEngine(lg, { ...tasteSettings, signal: 'all' }).separation();
    const mult = baseline > 0 ? score / baseline : 1;
    return { score, mult };
  });

  // Default selectedLeagueId to the first league once data is available.
  $effect(() => {
    if (selectedLeagueId == null && data.leagues.length > 0) selectedLeagueId = data.leagues[0].id;
  });

  // When the selected league changes, snap the player picker to the first player
  // ELIGIBLE for that league. Resetting to a bare 0 leaves the <select> blank when
  // full-list index 0 isn't in the league's filtered option set. leaguePlayers is
  // derived from selectedLeagueId, so this re-runs on league change but not when the
  // user picks a different player within the same league.
  $effect(() => {
    const first = leaguePlayers[0];
    if (first) selectedPlayerIdx = first.i;
  });

  async function loadTasteSettings() {
    try {
      const [settingsRes, sampleRes] = await Promise.all([
        fetch('/api/settings/taste'),
        fetch('/api/history/taste'),
      ]);
      if (settingsRes.ok) {
        const loaded = await settingsRes.json() as TasteSettings;
        tasteSettings = { ...DEFAULT_TASTE_SETTINGS, ...loaded };
      }
      if (sampleRes.ok) {
        sampleBlock = await sampleRes.json() as TasteBlock;
      }
    } catch { /* silently ignore */ }
  }

  async function saveTasteSettings() {
    if (tasteSaving) return;
    tasteSaving = true;
    tasteStatus = null;
    try {
      const res = await fetch('/api/settings/taste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tasteSettings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null;
        tasteStatus = { tone: 'warn', label: (err?.message ?? `HTTP ${res.status}`).toUpperCase() };
        return;
      }
      const result = await res.json() as { ok: boolean; patched: number };
      tasteStatus = {
        tone: 'health',
        label: `SAVED · ${result.patched} SITE${result.patched === 1 ? '' : 'S'} PATCHED`,
      };
    } catch (e) {
      tasteStatus = { tone: 'warn', label: (e instanceof Error ? e.message : 'NETWORK ERROR').toUpperCase() };
    } finally {
      tasteSaving = false;
    }
  }

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
<CollapsiblePanel id="mls-leagues-seasons" title="Leagues & Seasons">
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
</CollapsiblePanel>

<!-- ======== ROUNDS ======== -->
<CollapsiblePanel id="mls-round-management" title="Round management" subtitle="Set round numbers, tags, and theme submitters. Edits save on blur.">
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
</CollapsiblePanel>

<!-- ======== COMPETITORS ======== -->
<CollapsiblePanel id="mls-competitor-roster" title="ML competitor roster" subtitle="Link Music League competitor accounts to players. Unlinked competitors are shown first.">
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
</CollapsiblePanel>

<!-- ======== PLAYERS ======== -->
<CollapsiblePanel id="mls-player-roster" title="Player roster" subtitle="Manage players, identities, relationships, and season memberships.">
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
                      {#if player.avatar.baseKey}
                        <img
                          src={basePreviewUrl(player.id, player.avatar.baseKey)}
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
                    <div>
                      <div class="font-mono text-[10px] text-fg-faint mb-1">
                        Style{#if !avTraits.gender}<span class="text-fg-faint"> · set gender for the full list</span>{/if}
                      </div>
                      <div class="flex flex-wrap gap-1">
                        {#each avStyleOptions as s (s)}
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
                    <div class="flex flex-wrap gap-3">
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-race-{player.id}">Race</label>
                        <select
                          id="av-race-{player.id}"
                          bind:value={avTraits.race}
                          onchange={saveTraits}
                          class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each AV_RACES as r (r)}<option value={r}>{r}</option>{/each}
                        </select>
                      </div>
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
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-hairstyle-{player.id}">Hair style / length</label>
                        <select
                          id="av-hairstyle-{player.id}"
                          bind:value={avTraits.hairStyle}
                          onchange={saveTraits}
                          class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each AV_HAIR_STYLES as h (h)}<option value={h}>{h}</option>{/each}
                        </select>
                      </div>
                      <div>
                        <label class="block font-mono text-[10px] text-fg-faint mb-1" for="av-haircolor-{player.id}">Hair color</label>
                        <select
                          id="av-haircolor-{player.id}"
                          bind:value={avTraits.hairColor}
                          onchange={saveTraits}
                          class="bg-bg-elevated border border-border-muted rounded px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">—</option>
                          {#each AV_HAIR_COLORS as c (c)}<option value={c}>{c}</option>{/each}
                        </select>
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
</CollapsiblePanel>

<!-- ======== AUTO-FILL DEADLINES ======== -->
<CollapsiblePanel id="mls-bulk-deadlines" title="Bulk-set deadlines for a season" subtitle="Picks the first round's start = start date, then chains + days-to-submit → + days-to-vote through every round in the season (zero buffer).">
  {#if afStatus}
    <div class="mb-3"><StatusChip label={afStatus.label} tone={afStatus.tone} /></div>
  {/if}

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
</CollapsiblePanel>

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

<!-- ======== TASTE WAVEFORM ======== -->
<div class="mt-10">
<CollapsiblePanel id="mls-sonic-signature" title="Sonic Signature settings" subtitle="Controls how the Taste Waveform is computed and displayed. Changes apply to all published dashboards immediately.">
  <div class="flex flex-col lg:flex-row gap-6">
    <!-- Controls column -->
    <div class="flex-1 flex flex-col gap-6">

      <!-- Signal mode -->
      <div class="bg-surface border border-border-muted rounded-xl p-5">
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-3">Signal mode</div>
        <div class="flex flex-wrap gap-2">
          {#each SIGNAL_OPTIONS as opt (opt.value)}
            <button
              type="button"
              onclick={() => { tasteSettings = { ...tasteSettings, signal: opt.value }; }}
              class="font-mono text-[10px] px-3 py-1.5 rounded-md border transition-colors {tasteSettings.signal === opt.value
                ? 'border-accent bg-accent-bg text-accent'
                : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
            >{opt.label}</button>
          {/each}
        </div>
        <p class="text-[10px] text-fg-faint mt-2">
          ALL = all interactions · SUBS = submissions only · TOP = top N% vote-getters · VOTE% = vote points as % of a submission
        </p>
      </div>

      <!-- Numeric sliders -->
      <div class="bg-surface border border-border-muted rounded-xl p-5">
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-4">Weighting</div>
        <div class="flex flex-col gap-4">

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-mono text-[10px] uppercase text-fg-muted" for="tw-votePct">Vote % <span class="text-fg-faint">(per point, 0–25)</span></label>
              <span class="font-mono text-[10px] text-accent">{tasteSettings.votePct}</span>
            </div>
            <input
              id="tw-votePct"
              type="range" min="0" max="25" step="1"
              bind:value={tasteSettings.votePct}
              class="w-full accent-accent"
            />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-mono text-[10px] uppercase text-fg-muted" for="tw-dnPct">Downvote impact % <span class="text-fg-faint">(0–150)</span></label>
              <span class="font-mono text-[10px] text-accent">{tasteSettings.dnPct}</span>
            </div>
            <input
              id="tw-dnPct"
              type="range" min="0" max="150" step="5"
              bind:value={tasteSettings.dnPct}
              class="w-full accent-accent"
            />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-mono text-[10px] uppercase text-fg-muted" for="tw-lyrWeight">Lyrical weight <span class="text-fg-faint">(0–1)</span></label>
              <span class="font-mono text-[10px] text-accent">{tasteSettings.lyrWeight.toFixed(2)}</span>
            </div>
            <input
              id="tw-lyrWeight"
              type="range" min="0" max="1" step="0.05"
              bind:value={tasteSettings.lyrWeight}
              class="w-full accent-accent"
            />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-mono text-[10px] uppercase text-fg-muted" for="tw-spread">Spread <span class="text-fg-faint">(1–1.6 legibility stretch)</span></label>
              <span class="font-mono text-[10px] text-accent">{tasteSettings.spread.toFixed(2)}</span>
            </div>
            <input
              id="tw-spread"
              type="range" min="1" max="1.6" step="0.05"
              bind:value={tasteSettings.spread}
              class="w-full accent-accent"
            />
          </div>
        </div>
      </div>

      <!-- Toggle switches -->
      <div class="bg-surface border border-border-muted rounded-xl p-5">
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-4">Behaviour &amp; display</div>
        <div class="flex flex-col gap-3">
          {#each [
            { key: 'negatives' as const, label: 'Count downvotes' },
            { key: 'scopeAll' as const, label: 'Use all leagues (vs current league only)' },
            { key: 'showLabels' as const, label: 'Show axis labels' },
            { key: 'showKey' as const, label: 'Show key' },
            { key: 'showRead' as const, label: 'Show prose read' },
            { key: 'showChips' as const, label: 'Show taste chips' },
            { key: 'showLeagueAvg' as const, label: 'Show league average overlay' },
          ] as item}
            <label class="flex items-center gap-3 cursor-pointer group">
              <button
                type="button"
                role="switch"
                aria-checked={tasteSettings[item.key]}
                onclick={() => { tasteSettings = { ...tasteSettings, [item.key]: !tasteSettings[item.key] }; }}
                class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors focus:outline-none {tasteSettings[item.key] ? 'bg-accent border-accent' : 'bg-bg-elevated border-border-muted'}"
              >
                <span
                  class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform mt-px {tasteSettings[item.key] ? 'translate-x-4' : 'translate-x-0.5'}"
                ></span>
              </button>
              <span class="font-mono text-[10px] uppercase text-fg-muted group-hover:text-fg transition-colors">{item.label}</span>
            </label>
          {/each}
        </div>
      </div>

      <!-- Configure the look -->
      <div class="bg-surface border border-border-muted rounded-xl p-5">
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-4">Configure the look</div>
        <div class="flex flex-col gap-4">

          <!-- Palette -->
          <div>
            <div class="font-mono text-[10px] uppercase text-fg-muted mb-1.5">Palette</div>
            <div class="flex gap-1.5">
              {#each (['neon', 'cool', 'spectrum'] as const) as p (p)}
                <button type="button"
                  class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border transition-colors {tasteSettings.palette === p
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                  onclick={() => { tasteSettings = { ...tasteSettings, palette: p }; }}
                >{p}</button>
              {/each}
            </div>
          </div>

          <!-- Line style -->
          <div>
            <div class="font-mono text-[10px] uppercase text-fg-muted mb-1.5">Line style</div>
            <div class="flex gap-1.5">
              {#each (['strand', 'solid', 'none'] as const) as ls (ls)}
                <button type="button"
                  class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border transition-colors {tasteSettings.lineStyle === ls
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                  onclick={() => { tasteSettings = { ...tasteSettings, lineStyle: ls }; }}
                >{ls}</button>
              {/each}
            </div>
          </div>

          <!-- Nodes -->
          <div>
            <div class="font-mono text-[10px] uppercase text-fg-muted mb-1.5">Nodes</div>
            <div class="flex gap-1.5">
              {#each (['glow', 'dot', 'none'] as const) as ns (ns)}
                <button type="button"
                  class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border transition-colors {tasteSettings.nodeStyle === ns
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-border-muted text-fg-faint hover:border-accent hover:text-fg'}"
                  onclick={() => { tasteSettings = { ...tasteSettings, nodeStyle: ns }; }}
                >{ns}</button>
              {/each}
            </div>
          </div>

          <!-- Axis order -->
          <div>
            <div class="font-mono text-[10px] uppercase text-fg-muted mb-1.5">Axis order</div>
            <select
              bind:value={tasteSettings.order}
              class="w-full bg-bg-elevated border border-border-muted rounded-md px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors"
            >
              <option value="alt">alt</option>
              <option value="raw">raw</option>
              <option value="lyric-last">lyric-last</option>
              <option value="lyric-first">lyric-first</option>
            </select>
          </div>

          <!-- Band + opacity -->
          <div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={tasteSettings.band} class="accent-accent" />
              <span class="font-mono text-[10px] uppercase text-fg-muted">Band</span>
            </label>
            {#if tasteSettings.band}
              <div class="mt-2">
                <div class="flex justify-between text-[10px] text-fg-faint mb-1">
                  <span>Band opacity</span><span>{tasteSettings.bandOpacity.toFixed(2)}</span>
                </div>
                <input type="range" min="0" max="0.3" step="0.01"
                  bind:value={tasteSettings.bandOpacity}
                  class="w-full accent-accent"
                />
              </div>
            {/if}
          </div>

          <!-- Amplitude -->
          <div>
            <div class="flex justify-between text-[10px] text-fg-faint mb-1">
              <span class="font-mono uppercase text-fg-muted">Amplitude</span>
              <span>{tasteSettings.amplitude.toFixed(2)}×</span>
            </div>
            <input type="range" min="0.6" max="2.2" step="0.05"
              bind:value={tasteSettings.amplitude}
              class="w-full accent-accent"
            />
          </div>

        </div>
      </div>

      <!-- Save button -->
      <div class="flex items-center gap-4">
        <button
          type="button"
          onclick={saveTasteSettings}
          disabled={tasteSaving}
          class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-6 py-2 rounded-md transition-colors"
        >
          {tasteSaving ? 'Saving…' : 'Save & apply to live'}
        </button>
        {#if tasteStatus}
          <StatusChip label={tasteStatus.label} tone={tasteStatus.tone} />
        {/if}
      </div>

    </div>

    <!-- Live sample column -->
    <div class="lg:w-72 shrink-0">
      <div class="bg-surface border border-border-muted rounded-xl p-5 sticky top-4">
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-3">Live preview</div>
        {#if sampleBlock}
          <div class="mb-3 flex gap-2">
            <select class="flex-1 bg-surface border border-border-muted rounded-md px-2 py-1.5 text-sm"
              bind:value={selectedLeagueId}>
              {#each data.leagues as lg (lg.id)}<option value={lg.id}>{lg.name}</option>{/each}
            </select>
            <select class="flex-1 bg-surface border border-border-muted rounded-md px-2 py-1.5 text-sm"
              bind:value={selectedPlayerIdx}>
              {#each leaguePlayers as lp (lp.i)}<option value={lp.i}>{lp.p.name}</option>{/each}
            </select>
          </div>
          {#if previewEng && previewEng.nP > 0}
            <TasteWaveform
              variant="hero"
              engine={previewEng}
              pi={previewPlayerIdx}
              settings={tasteSettings}
              name={previewEng.name(previewPlayerIdx)}
            />
          {:else}
            <span class="font-mono text-[10px] text-fg-faint">no players in this league yet</span>
          {/if}
          {#if separation}
            <div class="mt-4 flex items-start justify-between gap-4 border-t border-border-muted pt-3">
              <div>
                <div class="font-mono text-[9.5px] tracking-widest uppercase text-fg-faint">Separation score</div>
                <div class="flex items-baseline gap-2 mt-0.5">
                  <span class="text-3xl font-extrabold text-fg leading-none">{separation.score.toFixed(1)}</span>
                  <span class="font-mono text-xs text-fg-muted">{separation.mult.toFixed(2)}× vs all-votes</span>
                </div>
              </div>
              <div class="text-[11px] text-fg-faint max-w-[240px] leading-snug text-right">
                Mean distance between every pair of fingerprints. Higher = more distinct people.
              </div>
            </div>
          {/if}
        {:else}
          <div class="flex items-center justify-center h-32 rounded-lg bg-bg-elevated border border-border-muted">
            <span class="font-mono text-[10px] text-fg-faint">loading sample…</span>
          </div>
        {/if}
        <p class="text-[10px] text-fg-faint mt-3">
          Preview re-renders as you adjust controls. Select a league and player to see their full sonic signature.
        </p>
      </div>
    </div>
  </div>
</CollapsiblePanel>
</div><!-- /mt-10 sonic wrapper -->

</div><!-- /mt-6 wrapper -->
