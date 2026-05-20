<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import TokenGenerateModal from '$lib/settings/TokenGenerateModal.svelte';
  import type { PageData } from './$types.js';

  let { data }: { data: PageData } = $props();

  let modalOpen = $state(false);
  let busyRow = $state<number | null>(null);
  let toast = $state<{ tone: 'health' | 'warn'; message: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function flashToast(tone: 'health' | 'warn', message: string) {
    toast = { tone, message };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 5000);
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  async function revoke(id: number, label: string) {
    if (busyRow !== null) return;
    if (!confirm(`Revoke token "${label}"? Extensions using this token will stop working.`)) return;
    busyRow = id;
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '');
        throw new Error(`revoke failed (${res.status}) ${text.slice(0, 200)}`);
      }
      flashToast('health', `Revoked "${label}".`);
      await invalidateAll();
    } catch (err) {
      flashToast('warn', err instanceof Error ? err.message : String(err));
    } finally {
      busyRow = null;
    }
  }

  async function onModalGenerated() {
    modalOpen = false;
    flashToast('health', 'Token generated.');
    await invalidateAll();
  }
</script>

<svelte:head><title>API tokens · settings · music-league-bot</title></svelte:head>

<div class="mb-6">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · settings · api tokens
  </div>
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-3xl font-bold text-fg mb-2">API tokens</h1>
      <p class="text-fg-muted max-w-2xl text-sm">
        Bearer tokens for the browser extension and any other clients that POST to
        <code class="font-mono text-fg">/api/ingest/*</code>. Tokens are shown in plaintext
        once at generation time and stored as SHA-256 hashes after that.
      </p>
    </div>
    <a
      href="/settings"
      class="font-mono text-[11px] tracking-widest uppercase text-fg-muted hover:text-fg transition-colors"
    >
      ← back to settings
    </a>
  </div>
</div>

{#if toast}
  <div
    role="status"
    class="mb-4 px-3 py-2 rounded-md border font-mono text-xs tracking-wide
           {toast.tone === 'health' ? 'border-health text-health bg-health/10' : 'border-warn text-warn bg-warn/10'}"
  >
    {toast.message}
  </div>
{/if}

{#if data.loadError}
  <div class="mb-4 px-3 py-2 rounded-md border border-warn text-warn bg-warn/10 font-mono text-xs">
    failed to load tokens · {data.loadError}
    <div class="mt-1 text-fg-dim normal-case">
      (Backend Task 1 may not be deployed yet — page renders empty until it is.)
    </div>
  </div>
{/if}

<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="flex items-center justify-between gap-3 mb-4 flex-wrap">
    <div>
      <SectionLabel>Bearer tokens</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">
        {data.tokens.length} token{data.tokens.length === 1 ? '' : 's'}
      </h2>
    </div>
    <button
      type="button"
      onclick={() => (modalOpen = true)}
      class="bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
    >
      + Generate new token
    </button>
  </header>

  {#if data.tokens.length === 0}
    <p class="text-fg-dim text-sm">
      No API tokens yet. Generate one to enable the browser extension.
    </p>
  {:else}
    <div class="overflow-x-auto -mx-6 px-6">
      <table class="w-full text-sm">
        <thead>
          <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint border-b border-border-muted">
            <th class="text-left py-2 pr-4 font-bold">Label</th>
            <th class="text-left py-2 pr-4 font-bold">Created</th>
            <th class="text-left py-2 pr-4 font-bold">Last used</th>
            <th class="text-left py-2 pr-4 font-bold">Status</th>
            <th class="py-2 text-right font-bold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each data.tokens as t (t.id)}
            {@const isRevoked = t.revokedAt !== null}
            <tr class="border-b border-border-muted last:border-b-0 {isRevoked ? 'opacity-50' : ''}">
              <td class="py-2 pr-4 text-fg">{t.label || '(unlabeled)'}</td>
              <td class="py-2 pr-4 font-mono text-xs text-fg-dim">{fmtDate(t.createdAt)}</td>
              <td class="py-2 pr-4 font-mono text-xs text-fg-dim">{fmtDate(t.lastUsedAt)}</td>
              <td class="py-2 pr-4">
                {#if isRevoked}
                  <StatusChip label="REVOKED" tone="muted" />
                {:else}
                  <StatusChip label="ACTIVE" tone="health" />
                {/if}
              </td>
              <td class="py-2 text-right">
                {#if !isRevoked}
                  <button
                    type="button"
                    onclick={() => revoke(t.id, t.label)}
                    disabled={busyRow === t.id}
                    class="font-mono text-[11px] tracking-widest uppercase text-warn hover:text-accent disabled:opacity-50 transition-colors"
                  >
                    {busyRow === t.id ? 'Revoking…' : 'Revoke'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if modalOpen}
  <TokenGenerateModal onCancel={() => (modalOpen = false)} onGenerated={onModalGenerated} />
{/if}
