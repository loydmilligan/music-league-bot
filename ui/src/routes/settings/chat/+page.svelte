<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';

  let { data } = $props<{ data: PageData }>();

  let selfNames = $state(data.settings.selfNames.join('\n'));
  let roundBoundary = $state(data.settings.roundBoundary);
  let bufferDays = $state(data.settings.bufferDays);
  let saved = $state(false);

  // League→group map: one entry per league
  let leagueGroupMap = $state<Record<string, string>>({ ...data.settings.leagueGroupMap });

  function handleSaved() {
    saved = true;
    setTimeout(() => { saved = false; }, 2500);
  }
</script>

<svelte:head><title>Chat Settings · music-league-bot</title></svelte:head>

<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · /settings/chat
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">Chat Settings</h1>
  <p class="text-fg-muted max-w-2xl">
    Configure how the Chat Content viewer identifies you and buckets messages to rounds.
  </p>
</div>

<SettingsTabs />

<div class="mt-6 flex flex-col gap-6 max-w-2xl">

<form
  method="POST"
  action="?/saveChatSettings"
  use:enhance={() => ({ result }) => {
    if (result.type === 'success') handleSaved();
  }}
  class="flex flex-col gap-6"
>
  <!-- Which player is me -->
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <SectionLabel>Identity</SectionLabel>
    <h2 class="text-lg font-bold text-fg mt-1 mb-1">Which player is me</h2>
    <p class="text-xs text-fg-dim mb-4">
      One chat display name per line. Multiple aliases allowed (WhatsApp vs GChat may differ).
      Used by the "＋ mine" toggle to show your messages alongside another player's.
    </p>

    <label class="block">
      <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint block mb-1">Display name(s)</span>
      <textarea
        name="self_names"
        rows="3"
        bind:value={selfNames}
        placeholder="Matt Mariani&#10;Matt"
        class="w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors resize-y font-mono"
      ></textarea>
    </label>

    {#if data.senders.length > 0}
      <div class="mt-3">
        <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint">Known senders</span>
        <div class="mt-2 flex flex-wrap gap-1.5">
          {#each data.senders as s (s)}
            <button
              type="button"
              class="font-mono text-[11px] px-2 py-0.5 rounded-sm border border-border-muted text-fg-muted hover:border-accent hover:text-accent transition-colors"
              onclick={() => {
                const current = selfNames.split('\n').map((x: string) => x.trim()).filter(Boolean);
                if (!current.includes(s)) {
                  selfNames = [...current, s].join('\n');
                }
              }}
            >{s}</button>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <!-- Round boundary -->
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <SectionLabel>Bucketing</SectionLabel>
    <h2 class="text-lg font-bold text-fg mt-1 mb-1">Round boundary</h2>
    <p class="text-xs text-fg-dim mb-4">
      Controls which messages get bucketed into each round's chat thread.
    </p>

    <div class="flex gap-3 mb-4">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="radio"
          name="round_boundary"
          value="strict"
          bind:group={roundBoundary}
          class="accent-[var(--color-accent)]"
        />
        <span class="text-sm font-semibold text-fg">Strict</span>
        <span class="text-xs text-fg-dim">Only messages within the exact round window</span>
      </label>
    </div>
    <div class="flex items-start gap-2">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="radio"
          name="round_boundary"
          value="buffer"
          bind:group={roundBoundary}
          class="accent-[var(--color-accent)]"
        />
        <span class="text-sm font-semibold text-fg">With buffer</span>
      </label>
      <span class="text-xs text-fg-dim mt-0.5">Extend the window by ± days to catch adjacent-round chatter</span>
    </div>

    {#if roundBoundary === 'buffer'}
      <div class="mt-4 flex items-center gap-3">
        <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint">Buffer days</span>
        <div class="flex items-center gap-2 bg-bg-elevated border border-border-muted rounded-md px-2 py-1">
          <button
            type="button"
            onclick={() => bufferDays = Math.max(1, bufferDays - 1)}
            class="text-fg-muted hover:text-fg text-lg leading-none w-5 text-center"
          >−</button>
          <input
            type="hidden"
            name="buffer_days"
            value={bufferDays}
          />
          <span class="font-mono text-sm text-fg w-4 text-center">{bufferDays}</span>
          <button
            type="button"
            onclick={() => bufferDays = Math.min(3, bufferDays + 1)}
            class="text-fg-muted hover:text-fg text-lg leading-none w-5 text-center"
          >+</button>
        </div>
        <span class="text-xs text-fg-dim">min 1, max 3</span>
      </div>
    {:else}
      <input type="hidden" name="buffer_days" value={bufferDays} />
    {/if}
  </section>

  <!-- League → group mapping -->
  {#if data.leagues.length > 0}
    <section class="bg-surface border border-border-muted rounded-xl p-6">
      <SectionLabel>Chat groups</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1 mb-1">League → chat group</h2>
      <p class="text-xs text-fg-dim mb-4">
        Map each league to the chat group whose messages belong to it.
        Unmapped leagues show an empty thread with a "chat not linked" note.
      </p>

      <div class="flex flex-col gap-3">
        {#each data.leagues as league (league.id)}
          <div class="flex items-center gap-3">
            <span class="text-sm text-fg flex-shrink-0 w-48 truncate" title={league.name}>{league.name}</span>
            <span class="text-fg-faint">→</span>
            <select
              name="league_group_{league.slug}"
              class="flex-1 bg-bg border border-border-muted focus:border-accent rounded px-2.5 py-1.5 text-sm text-fg outline-none transition-colors"
              bind:value={leagueGroupMap[league.slug]}
            >
              <option value="">(not linked)</option>
              {#each data.groups as g (g.group_name)}
                <option value={g.group_name}>{g.group_name} ({g.platform})</option>
              {/each}
            </select>
          </div>
        {/each}
      </div>

      {#if data.groups.length === 0}
        <p class="text-xs text-fg-dim italic mt-3">No chat groups captured yet — start the relay to ingest messages.</p>
      {/if}
    </section>
  {/if}

  <div class="flex items-center gap-4">
    <button
      type="submit"
      class="bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-5 py-2.5 rounded-md transition-colors"
    >Save</button>
    {#if saved}
      <span class="font-mono text-xs text-health tracking-widest uppercase">Saved</span>
    {/if}
  </div>
</form>

</div>
