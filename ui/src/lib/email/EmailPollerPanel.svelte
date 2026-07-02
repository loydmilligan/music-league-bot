<script lang="ts">
  import { statusLine, outcomeGlyph, relativeTime, type PollStatus } from './emailPollerView.js';
  import type { EmailPollerData, RecentEmail } from './emailPollerQuery.js';

  let { initial }: { initial: EmailPollerData } = $props();

  let poll = $state<PollStatus | null>(initial.poll);
  let recent = $state<RecentEmail[]>(initial.recent);
  let refreshing = $state(false);
  let now = $state(Date.now());

  const status = $derived(statusLine(poll, now));

  const TONE_COLOR: Record<string, string> = {
    ok: '#22c55e',
    error: '#ef4444',
    warn: '#f59e0b',
    idle: 'var(--color-fg-faint)',
    muted: 'var(--color-fg-faint)',
  };

  const TYPE_LABEL: Record<string, string> = {
    round_starting: 'round-starting',
    new_playlist: 'new-playlist',
    votes_are_in: 'votes-are-in',
    other: 'other',
    error: 'error',
  };

  async function refresh() {
    refreshing = true;
    try {
      const r = await fetch('/api/email-poller/status');
      if (r.ok) {
        const d = (await r.json()) as EmailPollerData;
        poll = d.poll;
        recent = d.recent;
        now = Date.now();
      }
    } catch {
      /* keep current data on failure */
    } finally {
      refreshing = false;
    }
  }
</script>

<div>
  <div class="flex justify-end mb-3">
    <button
      type="button"
      onclick={refresh}
      disabled={refreshing}
      class="font-mono text-[11px] px-2.5 py-1 rounded-md border border-border-muted text-fg-dim hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
    >
      {refreshing ? 'refreshing…' : '↻ Refresh'}
    </button>
  </div>

  <!-- Large status indicator -->
  <div class="flex items-center gap-3 mb-5 px-3 py-3 rounded-lg bg-bg-elevated border border-border-muted">
    <span
      class="inline-block w-3.5 h-3.5 rounded-full shrink-0"
      style="background: {TONE_COLOR[status.tone]}; {status.tone === 'ok' ? 'box-shadow: 0 0 8px ' + TONE_COLOR.ok + '66;' : ''}"
    ></span>
    <span class="text-sm font-medium text-fg">{status.text}</span>
  </div>

  <!-- Recent ingested emails -->
  {#if recent.length === 0}
    <div class="font-mono text-xs text-fg-faint italic px-1 py-2">No emails ingested yet.</div>
  {:else}
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Recent activity</div>
    <ul class="space-y-1.5">
      {#each recent as e (e.sentAt + e.subject)}
        {@const g = outcomeGlyph(e.actionStatus)}
        <li class="flex items-start gap-2.5 px-2.5 py-2 rounded-md border border-border-muted/60 bg-bg">
          <span class="shrink-0 text-sm" style="color: {TONE_COLOR[g.tone]};" title={e.actionStatus ?? ''}>{g.glyph}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-[9px] px-1.5 py-0.5 rounded border border-border-muted text-fg-dim uppercase tracking-wider">
                {TYPE_LABEL[e.type] ?? e.type}
              </span>
              <span class="text-xs text-fg truncate">{e.subject ?? '(no subject)'}</span>
              <span class="ml-auto font-mono text-[9px] text-fg-faint shrink-0">{relativeTime(e.sentAt, now)}</span>
            </div>
            {#if e.actionDetail}
              <div class="text-[11px] mt-0.5" style="color: {TONE_COLOR[g.tone]};">{e.actionDetail}</div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
