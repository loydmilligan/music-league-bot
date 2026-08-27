<script lang="ts">
  import { summarizeRun, type RunSummaryView } from './runView.js';
  import type { Rollout, RunState } from './types.js';

  let { leagueId }: { leagueId: number } = $props();

  let runs = $state<{ runId: string; roundId: number; roundName: string; state: string }[]>([]);
  let selected = $state<RunSummaryView | null>(null);
  let resumeToken = $state('');

  async function loadRuns() {
    const r = await fetch(`/api/rollout/runs?leagueId=${leagueId}`);
    if (r.ok) runs = (await r.json()).runs;
  }
  $effect(() => { if (leagueId) void loadRuns(); });

  async function open(runId: string) {
    const r = await fetch(`/api/rollout/runs?runId=${runId}`);
    if (!r.ok) return;
    const { run } = (await r.json()) as { run: RunState };
    const cfg = await (await fetch(`/api/rollout/config?leagueId=${leagueId}`)).json() as { rollout: Rollout };
    selected = summarizeRun(run, cfg.rollout);
  }

  async function resume() {
    const r = await fetch('/api/rollout/resume', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: resumeToken }),
    });
    if (r.ok) { resumeToken = ''; await loadRuns(); }
  }
</script>

<div class="rlt-runs">
  <ul class="rlt-runlist">
    {#each runs as r (r.runId)}
      <li><button class="mash-btn mash-btn--secondary" onclick={() => open(r.runId)}>{r.roundName} — {r.state}</button></li>
    {:else}
      <li class="rlt-runs-empty">No runs yet.</li>
    {/each}
  </ul>

  {#if selected}
    <div class="rlt-run-detail">
      <h4 class="rlt-run-head">Run {selected.runId.slice(0, 8)} — {selected.state}
        ({selected.progress.done}/{selected.progress.total})</h4>
      {#if selected.waitingOn}<p class="rlt-run-waiting">Waiting on: <strong>{selected.waitingOn}</strong></p>{/if}
      {#if selected.error}<p class="rlt-run-error">{selected.error}</p>{/if}
      <ol class="rlt-run-cuts">
        {#each selected.cuts as c (c.cutId)}
          <li class="rlt-run-cut">
            <span class="rlt-run-cut-ep">EP{c.ep}</span> <strong>{c.label}</strong>
            <span class="rlt-run-status rlt-run-status--{c.status}">{c.status}</span>
            {#if c.note}<em class="rlt-run-note">{c.note}</em>{/if}
            {#if c.outputJson}<details class="rlt-run-output"><summary>output</summary><pre>{c.outputJson}</pre></details>{/if}
          </li>
        {/each}
      </ol>
      {#if selected.resumable}
        <div class="rlt-resume-row">
          <label class="rlt-field">
            <span>Resume token</span>
            <input class="ml-input" bind:value={resumeToken} />
          </label>
          <button class="mash-btn mash-btn--primary" onclick={resume} disabled={!resumeToken}>Resume</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .rlt-runs { display: flex; flex-direction: column; gap: 14px; }
  .rlt-runlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .rlt-runs-empty { color: var(--fg-muted); font: 500 12px/1.3 var(--font-body); }

  .rlt-run-detail {
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 12px 14px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rlt-run-head { margin: 0; font: 700 14px/1.2 var(--font-body); color: var(--fg); }
  .rlt-run-waiting { margin: 0; font: 500 12px/1.3 var(--font-body); color: var(--fg-muted); }
  .rlt-run-error { margin: 0; font: 500 12px/1.3 var(--font-body); color: var(--amber); }

  .rlt-run-cuts { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .rlt-run-cut { font: 500 12px/1.4 var(--font-body); color: var(--fg); }
  .rlt-run-cut-ep { color: var(--fg-muted); font: 500 11px/1.2 var(--font-mono); }
  .rlt-run-note { color: var(--fg-muted); }
  .rlt-run-output pre { font: 500 11px/1.4 var(--font-mono); white-space: pre-wrap; word-break: break-word; }

  .rlt-run-status {
    display: inline-block;
    padding: 2px 6px;
    border-radius: var(--r-2);
    font: 600 10px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rlt-run-status--passed, .rlt-run-status--repaired { background: var(--moss-soft); color: var(--moss); }
  .rlt-run-status--failed-check, .rlt-run-status--failed-transient { background: var(--ember-soft); color: var(--ember); }
  .rlt-run-status--pending, .rlt-run-status--skipped { background: var(--surface); color: var(--fg-muted); }
  .rlt-run-status--running { background: var(--amber-soft); color: var(--amber); }

  .rlt-resume-row { display: flex; align-items: flex-end; gap: 8px; }
  .rlt-field { display: flex; flex-direction: column; gap: 4px; font: 500 11px/1.2 var(--font-mono); color: var(--fg-muted); }
</style>
