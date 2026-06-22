<script lang="ts">
  import './history.css';
  import HistoryFilters from './HistoryFilters.svelte';
  import RoundCard from './RoundCard.svelte';
  import MessageCard from './MessageCard.svelte';
  import BubbleThread from './BubbleThread.svelte';
  import { detectMedia } from '../historyQuery.js';

  interface RoundInfo {
    id: number;
    name: string;
    seasonNumber: number;
    fromIso: string;
    toIso: string;
    platform: string;
    groupName: string;
    isLive?: boolean;
  }

  interface RoundWithStats extends RoundInfo {
    messageCount: number;
    lastTs: string | null;
    snippet: string | null;
  }

  interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    ts: string;
    platform: string;
    group_name: string;
    isBuffer?: boolean;
  }

  interface SearchResult extends ChatMessage {
    roundId: number;
    roundName: string;
    fromIso: string;
    toIso: string;
    groupName: string;
  }

  interface Props {
    rounds: RoundWithStats[];
    groups: { group_name: string; platform: string }[];
    senders: string[];
    sendersByGroup?: Record<string, string[]>;
    selfNames?: string[];
    roundBoundary?: 'strict' | 'buffer';
    bufferDays?: number;
    hasUnlinkedLeagues?: boolean;
    // scope lock: when set, the view is locked to one round (round page mode)
    lockedRound?: RoundInfo | null;
    lockedMessages?: ChatMessage[];
    lockedHasMore?: boolean;
  }

  let {
    rounds,
    groups,
    senders,
    sendersByGroup = {},
    selfNames = [],
    roundBoundary = 'strict',
    bufferDays = 1,
    hasUnlinkedLeagues = false,
    lockedRound = null,
    lockedMessages = [],
    lockedHasMore = false,
  }: Props = $props();

  // Filter state
  let selectedGroup = $state('');
  let selectedSeason = $state<number | null>(null);
  let selectedSender = $state('');
  let mediaOnly = $state(false);
  let searchQuery = $state('');

  // Viewer state
  let selectedRound = $state<RoundWithStats | null>(null);
  let viewerMessages = $state<ChatMessage[]>([]);
  let viewerLoading = $state(false);
  let viewerHasMore = $state(false);
  let loadingOlder = $state(false);
  let hitId = $state<string | null>(null);

  // Search state
  let searchResults = $state<SearchResult[]>([]);
  let searchLoading = $state(false);
  let isSearchMode = $derived(searchQuery.trim().length > 0);

  // Sender list: scoped to selected group when possible, else all senders
  const activeSenders = $derived(
    selectedGroup && sendersByGroup[selectedGroup]
      ? sendersByGroup[selectedGroup]
      : senders
  );

  // + mine toggle
  let showMine = $state(false);
  const showMinePlus = $derived(selectedSender && selfNames.length > 0 && !selfNames.some(n => n.toLowerCase() === selectedSender.toLowerCase()));

  // Locked mode
  const isLocked = $derived(!!lockedRound);

  // Group rounds by season for the list
  interface SeasonGroup {
    seasonNumber: number;
    rounds: RoundWithStats[];
  }

  const filteredRounds = $derived.by(() => {
    let r = rounds;
    if (selectedGroup) r = r.filter(x => x.groupName === selectedGroup);
    if (selectedSeason !== null) r = r.filter(x => x.seasonNumber === selectedSeason);
    return r;
  });

  // Available seasons for the filter (from group-filtered rounds, before season filter)
  const availableSeasons = $derived.by(() => {
    let r = rounds;
    if (selectedGroup) r = r.filter(x => x.groupName === selectedGroup);
    const nums = [...new Set(r.map(x => x.seasonNumber))].sort((a, b) => b - a);
    return nums;
  });

  const seasonGroups = $derived.by<SeasonGroup[]>(() => {
    const map = new Map<number, RoundWithStats[]>();
    for (const r of filteredRounds) {
      const existing = map.get(r.seasonNumber) ?? [];
      existing.push(r);
      map.set(r.seasonNumber, existing);
    }
    const sorted = [...map.entries()].sort((a, b) => b[0] - a[0]);
    return sorted.map(([seasonNumber, rs]) => ({ seasonNumber, rounds: rs }));
  });

  let viewerEl = $state<HTMLDivElement | null>(null);

  function bufferWindow(from: string, to: string): { qFrom: string; qTo: string } {
    if (roundBoundary !== 'buffer') return { qFrom: from, qTo: to };
    const ms = bufferDays * 86_400_000;
    return {
      qFrom: new Date(new Date(from).getTime() - ms).toISOString(),
      qTo: new Date(new Date(to).getTime() + ms).toISOString(),
    };
  }

  async function loadRoundThread(round: RoundWithStats) {
    if (selectedRound?.id === round.id) return;
    selectedRound = round;
    hitId = null;
    viewerLoading = true;
    viewerHasMore = false;
    try {
      const { qFrom, qTo } = bufferWindow(round.fromIso, round.toIso);
      const params = new URLSearchParams({
        groupName: round.groupName,
        from: qFrom,
        to: qTo,
      });
      if (roundBoundary === 'buffer') {
        params.set('strictFrom', round.fromIso);
        params.set('strictTo', round.toIso);
      }
      const res = await fetch(`/api/chat/history/thread?${params}`);
      if (!res.ok) throw new Error('Load failed');
      const data = await res.json() as { messages: ChatMessage[]; hasMore: boolean };
      viewerMessages = data.messages;
      viewerHasMore = data.hasMore;
    } catch {
      viewerMessages = [];
    } finally {
      viewerLoading = false;
    }
  }

  async function loadOlder(round: RoundInfo, currentMessages: ChatMessage[], isLocked: boolean) {
    const oldest = currentMessages[0];
    if (!oldest) return;
    loadingOlder = true;
    try {
      const { qFrom, qTo } = bufferWindow(round.fromIso, round.toIso);
      const params = new URLSearchParams({
        groupName: round.groupName,
        from: qFrom,
        to: qTo,
        before: oldest.ts,
      });
      if (roundBoundary === 'buffer') {
        params.set('strictFrom', round.fromIso);
        params.set('strictTo', round.toIso);
      }
      const res = await fetch(`/api/chat/history/thread?${params}`);
      if (!res.ok) throw new Error('Load failed');
      const data = await res.json() as { messages: ChatMessage[]; hasMore: boolean };
      if (isLocked) {
        // locked mode uses lockedMessages — we need to prepend; signal via a local override
        lockedMessagesExtra = [...data.messages, ...lockedMessagesExtra];
        lockedHasMoreOverride = data.hasMore;
      } else {
        viewerMessages = [...data.messages, ...currentMessages];
        viewerHasMore = data.hasMore;
      }
    } catch {
      // silent — button stays visible so user can retry
    } finally {
      loadingOlder = false;
    }
  }

  // Locked-mode pagination state (prepended older pages)
  let lockedMessagesExtra = $state<ChatMessage[]>([]);
  let lockedHasMoreOverride = $state<boolean | null>(null);
  const lockedHasMoreEffective = $derived(lockedHasMoreOverride !== null ? lockedHasMoreOverride : lockedHasMore);
  const allLockedMessages = $derived([...lockedMessagesExtra, ...lockedMessages]);

  $effect(() => {
    if (!isSearchMode) {
      searchResults = [];
      return;
    }
    searchLoading = true;
    const params = new URLSearchParams({ q: searchQuery });
    if (selectedGroup) params.set('groupName', selectedGroup);
    if (selectedRound) {
      params.set('from', selectedRound.fromIso);
      params.set('to', selectedRound.toIso);
    }
    if (selectedSender) params.set('sender', selectedSender);
    if (mediaOnly) params.set('mediaOnly', '1');

    fetch(`/api/chat/history/search?${params}`)
      .then(r => r.json())
      .then((data: SearchResult[]) => { searchResults = data; })
      .catch(() => { searchResults = []; })
      .finally(() => { searchLoading = false; });
  });

  // For locked mode, load thread immediately when lockedMessages provided
  const displayMessages = $derived(isLocked ? allLockedMessages : viewerMessages);

  const viewerFilteredMessages = $derived.by(() => {
    let msgs = displayMessages;
    if (mediaOnly) msgs = msgs.filter(m => detectMedia(m.text).hasMedia);
    return msgs;
  });

  function scrollLatest() {
    if (!viewerEl) return;
    viewerEl.scrollTop = viewerEl.scrollHeight;
  }

  function openSearchResult(result: SearchResult) {
    hitId = result.id;
    const round = rounds.find(r => r.id === result.roundId);
    if (round) {
      loadRoundThread(round);
    } else {
      // synthesize a RoundWithStats from search result
      selectedRound = {
        id: result.roundId,
        name: result.roundName,
        seasonNumber: 0,
        fromIso: result.fromIso,
        toIso: result.toIso,
        platform: result.platform,
        groupName: result.groupName,
        messageCount: 0,
        lastTs: null,
        snippet: null,
      };
      viewerLoading = true;
      const params = new URLSearchParams({
        groupName: result.groupName,
        from: result.fromIso,
        to: result.toIso,
      });
      fetch(`/api/chat/history/thread?${params}`)
        .then(r => r.json())
        .then((data: { messages: ChatMessage[]; hasMore: boolean }) => {
          viewerMessages = data.messages;
          viewerHasMore = data.hasMore;
        })
        .finally(() => { viewerLoading = false; });
    }
  }
</script>

<div class="ch-layout">
  {#if !isLocked}
    <HistoryFilters
      {groups}
      senders={activeSenders}
      seasons={availableSeasons}
      {selectedGroup}
      {selectedSeason}
      {selectedSender}
      {mediaOnly}
      {searchQuery}
      onGroupChange={(g) => { selectedGroup = g; selectedSeason = null; selectedSender = ''; }}
      onSeasonChange={(s) => { selectedSeason = s; selectedSender = ''; }}
      onSenderChange={(s) => { selectedSender = s; showMine = false; }}
      onMediaOnlyChange={(v) => { mediaOnly = v; }}
      onSearchChange={(q) => { searchQuery = q; }}
    />
  {:else}
    <!-- Locked mode: scope card + player/media/search filters only -->
    {#if lockedRound}
      <div class="ch-scope-card">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="ch-pip {lockedRound.platform}"></span>
          <span class="font-bold text-fg text-sm">{lockedRound.name}</span>
          <span class="font-mono text-[10px] text-fg-dim uppercase tracking-wider">r-{lockedRound.id} · scope locked</span>
        </div>
      </div>
    {/if}
    <div class="ch-filters">
      <!-- Player -->
      <div class="flex items-center gap-1">
        <span class="font-mono text-[9px] tracking-widest uppercase text-fg-faint">Player</span>
        <select
          class="ch-select"
          bind:value={selectedSender}
          onchange={() => { showMine = false; }}
        >
          <option value="">Everyone</option>
          {#each activeSenders as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </div>
      {#if showMinePlus}
        <button
          type="button"
          class="ch-toggle"
          class:is-mine={showMine}
          onclick={() => (showMine = !showMine)}
        >+ mine</button>
      {/if}
      <button
        type="button"
        class="ch-toggle"
        class:is-on={mediaOnly}
        onclick={() => (mediaOnly = !mediaOnly)}
      >Media only</button>
      <div class="ml-auto">
        <input
          type="search"
          class="ch-search"
          placeholder="Search this round…"
          bind:value={searchQuery}
        />
      </div>
    </div>
  {/if}

  <div class="ch-columns">
    <!-- Left column -->
    {#if !isLocked}
      <div class="ch-list">
        {#if isSearchMode}
          {#if searchLoading}
            <div class="ch-empty">Searching…</div>
          {:else if searchResults.length === 0}
            <div class="ch-empty">No results</div>
          {:else}
            {#each searchResults as result (result.id)}
              {@const media = detectMedia(result.text)}
              <MessageCard
                sender={result.sender}
                text={result.text}
                ts={result.ts}
                roundId={result.roundId}
                roundName={result.roundName}
                query={searchQuery}
                platform={result.platform}
                hasMedia={media.hasMedia}
                mediaType={media.mediaType}
                onclick={() => openSearchResult(result)}
              />
            {/each}
          {/if}
        {:else}
          {#each seasonGroups as sg (sg.seasonNumber)}
            <div class="ch-season-sep">Season {sg.seasonNumber} · {sg.rounds.length} round{sg.rounds.length === 1 ? '' : 's'}</div>
            {#each sg.rounds as round (round.id)}
              <RoundCard
                roundId={round.id}
                roundName={round.name}
                platform={round.platform}
                messageCount={round.messageCount}
                lastTs={round.lastTs}
                snippet={round.snippet}
                isSelected={selectedRound?.id === round.id}
                isLive={round.isLive}
                onclick={() => loadRoundThread(round)}
              />
            {/each}
          {/each}
          {#if filteredRounds.length === 0}
            <div class="ch-empty">
              {#if selectedGroup}
                No rounds linked to this chat group.
              {:else if rounds.length === 0 && hasUnlinkedLeagues}
                No chat groups linked yet. Go to <a href="/settings/chat" class="text-accent hover:underline">Settings › Chat</a> to map leagues to chat groups.
              {:else}
                No rounds yet.
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Right column — viewer -->
    <div class="ch-viewer">
      {#if isLocked}
        <!-- Locked mode: display the loaded thread directly -->
        {#if allLockedMessages.length === 0}
          <div class="ch-empty">No messages in this round's window yet.</div>
        {:else}
          <div class="ch-viewer-header">
            <div class="ch-viewer-meta">
              {lockedHasMoreEffective ? `${allLockedMessages.length}+ messages` : `${allLockedMessages.length} message${allLockedMessages.length === 1 ? '' : 's'}`}
              {#if selectedSender}
                <span class="ch-viewer-filter-note"> · filtered: {selectedSender}{showMine ? ' + you' : ''}</span>
              {/if}
            </div>
          </div>
          {#if lockedHasMoreEffective && lockedRound}
            <button
              type="button"
              class="ch-load-older"
              disabled={loadingOlder}
              onclick={() => lockedRound && loadOlder(lockedRound, allLockedMessages, true)}
            >{loadingOlder ? 'Loading…' : '↑ Load older messages'}</button>
          {/if}
          <BubbleThread
            messages={viewerFilteredMessages}
            {hitId}
            filterSender={selectedSender || null}
            filterSelf={showMine}
            {selfNames}
            bind:viewerEl
          />
          <button type="button" class="ch-scroll-latest" onclick={scrollLatest}>↓ latest</button>
        {/if}
      {:else if selectedRound === null}
        <div class="ch-empty">Select a round to read its thread.</div>
      {:else if viewerLoading}
        <div class="ch-empty">Loading…</div>
      {:else}
        <div class="ch-viewer-header">
          <div class="ch-viewer-title">{selectedRound.name}</div>
          <div class="ch-viewer-meta">
            <span class="ch-pip {selectedRound.platform}"></span>
            r-{selectedRound.id} · {viewerMessages.length} message{viewerMessages.length === 1 ? '' : 's'}
            {#if selectedSender}
              <span class="ch-viewer-filter-note"> · {selectedSender}{showMine ? ' + you' : ''}</span>
            {/if}
          </div>
        </div>
        {#if viewerMessages.length === 0}
          <div class="ch-empty">No messages in this round's window.</div>
        {:else}
          <!-- + mine toggle in full mode -->
          {#if showMinePlus}
            <div class="px-3 pt-2">
              <button
                type="button"
                class="ch-toggle"
                class:is-mine={showMine}
                onclick={() => (showMine = !showMine)}
              >+ mine</button>
            </div>
          {/if}
          {#if viewerHasMore && selectedRound}
            <button
              type="button"
              class="ch-load-older"
              disabled={loadingOlder}
              onclick={() => selectedRound && loadOlder(selectedRound, viewerMessages, false)}
            >{loadingOlder ? 'Loading…' : '↑ Load older messages'}</button>
          {/if}
          <BubbleThread
            messages={viewerFilteredMessages}
            {hitId}
            filterSender={selectedSender || null}
            filterSelf={showMine}
            {selfNames}
            bind:viewerEl
          />
          <button type="button" class="ch-scroll-latest" onclick={scrollLatest}>↓ latest</button>
        {/if}
      {/if}
    </div>
  </div>
</div>
