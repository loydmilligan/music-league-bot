<script lang="ts">
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import type { PageData } from './$types.js';
  import type { AlertType, ChannelId } from '$lib/notifications/config.js';

  let { data }: { data: PageData } = $props();

  let config = $state(structuredClone(data.config));
  let hasNtfyToken = $state(data.hasNtfyToken);
  let testResult = $state<Record<string, string>>({});

  let saving = $state(false);
  let toast = $state<{ tone: 'health' | 'warn'; message: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function flashToast(tone: 'health' | 'warn', message: string) {
    toast = { tone, message };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 5000);
  }

  const CHANNEL_LABELS: Record<ChannelId, string> = { ntfy: 'ntfy', whatsapp: 'WhatsApp' };
  const ALERT_LABELS: Record<AlertType, string> = {
    pipeline_failure: 'Pipeline failure',
    ml_auth_expired: 'Music League auth expired',
    digest_ready: 'Digest ready',
    digest_sent: 'Digest sent',
  };

  function isConfigured(ch: ChannelId): boolean {
    if (ch === 'ntfy') return !!config.channels.ntfy.url && !!config.channels.ntfy.topic;
    if (ch === 'whatsapp') return !!config.channels.whatsapp.ownerNumber;
    return false;
  }

  async function save() {
    if (saving) return;
    saving = true;
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && body.ok) {
        flashToast('health', 'Saved.');
        // Reload from the server so local state reflects what's actually stored.
        // The ntfy token itself never comes back — the GET endpoint redacts it —
        // so the token input stays blank; hasNtfyToken drives the placeholder.
        const fresh = await fetch('/api/notifications').then((r) => r.json()) as
          { config: typeof data.config; hasNtfyToken: boolean };
        config = structuredClone(fresh.config);
        hasNtfyToken = fresh.hasNtfyToken;
      } else {
        flashToast('warn', body.reason ?? 'Save failed');
      }
    } catch (err) {
      flashToast('warn', err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }

  async function test(ch: ChannelId) {
    testResult = { ...testResult, [ch]: 'sending…' };
    try {
      const r = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: ch }),
      }).then((x) => x.json()) as { ok: boolean; error?: string; reason?: string };
      testResult = { ...testResult, [ch]: r.ok ? 'sent ✓' : `failed: ${r.error ?? r.reason ?? 'error'}` };
    } catch (err) {
      testResult = { ...testResult, [ch]: `failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
</script>

<svelte:head><title>Notifications · settings · music-league-bot</title></svelte:head>

<div class="mb-6">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · settings · notifications
  </div>
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-3xl font-bold text-fg mb-2">Notifications</h1>
      <p class="text-fg-muted max-w-2xl text-sm">
        Channels and routing for pipeline alerts and the approval gate. Route each alert type to
        one or more channels; a channel must be configured below before it can be routed or tested.
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

<div class="flex flex-col gap-6 max-w-3xl">

  <!-- ntfy channel card -->
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
      <div>
        <SectionLabel>Channel</SectionLabel>
        <h2 class="text-lg font-bold text-fg mt-1">ntfy</h2>
      </div>
      {#if isConfigured('ntfy')}
        <StatusChip label="CONFIGURED" tone="health" />
      {:else}
        <StatusChip label="NOT CONFIGURED" tone="muted" />
      {/if}
    </header>
    <p class="text-xs text-fg-dim mb-4">Push notifications via a self-hosted or public ntfy topic.</p>

    <div class="flex flex-col gap-3">
      <label class="block">
        <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint block mb-1">Server URL</span>
        <input
          type="text"
          bind:value={config.channels.ntfy.url}
          placeholder="https://ntfy.sh"
          class="w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors font-mono"
        />
      </label>
      <label class="block">
        <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint block mb-1">Topic</span>
        <input
          type="text"
          bind:value={config.channels.ntfy.topic}
          placeholder="music-league-bot-alerts"
          class="w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors font-mono"
        />
      </label>
      <label class="block">
        <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint block mb-1">Access token (optional)</span>
        <input
          type="password"
          bind:value={config.channels.ntfy.token}
          placeholder={hasNtfyToken ? '•••••• (stored — leave blank to keep)' : 'no token set'}
          class="w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors font-mono"
        />
        <span class="text-[11px] text-fg-dim mt-1 block">Leave blank to keep the currently stored token.</span>
      </label>
    </div>

    <div class="flex items-center gap-3 mt-4">
      <button
        type="button"
        onclick={() => test('ntfy')}
        disabled={!isConfigured('ntfy') || testResult.ntfy === 'sending…'}
        class="border border-border text-fg-muted hover:text-fg hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase px-4 py-2 rounded-md transition-colors"
      >
        Send test
      </button>
      {#if testResult.ntfy}
        <span class="font-mono text-xs {testResult.ntfy.startsWith('failed') ? 'text-warn' : 'text-health'}">
          {testResult.ntfy}
        </span>
      {/if}
    </div>
  </section>

  <!-- whatsapp channel card -->
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
      <div>
        <SectionLabel>Channel</SectionLabel>
        <h2 class="text-lg font-bold text-fg mt-1">WhatsApp</h2>
      </div>
      {#if isConfigured('whatsapp')}
        <StatusChip label="CONFIGURED" tone="health" />
      {:else}
        <StatusChip label="NOT CONFIGURED" tone="muted" />
      {/if}
    </header>
    <p class="text-xs text-fg-dim mb-4">Sends alerts (and, for review/approve alerts, the approval gate) to the owner via the bot's WhatsApp connection.</p>

    <label class="block">
      <span class="font-mono text-[11px] tracking-widest uppercase text-fg-faint block mb-1">Owner number</span>
      <input
        type="text"
        bind:value={config.channels.whatsapp.ownerNumber}
        placeholder="16175551234@c.us"
        class="w-full bg-bg border border-border-muted focus:border-accent rounded px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors font-mono"
      />
    </label>

    <div class="flex items-center gap-3 mt-4">
      <button
        type="button"
        onclick={() => test('whatsapp')}
        disabled={!isConfigured('whatsapp') || testResult.whatsapp === 'sending…'}
        class="border border-border text-fg-muted hover:text-fg hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase px-4 py-2 rounded-md transition-colors"
      >
        Send test
      </button>
      {#if testResult.whatsapp}
        <span class="font-mono text-xs {testResult.whatsapp.startsWith('failed') ? 'text-warn' : 'text-health'}">
          {testResult.whatsapp}
        </span>
      {/if}
    </div>
  </section>

  <!-- routing grid -->
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <SectionLabel>Routing</SectionLabel>
    <h2 class="text-lg font-bold text-fg mt-1 mb-1">Alert routing</h2>
    <p class="text-xs text-fg-dim mb-4">
      Which channels receive each alert type. A checkbox is disabled until its channel is configured above.
    </p>

    <div class="overflow-x-auto -mx-6 px-6">
      <table class="w-full text-sm">
        <thead>
          <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint border-b border-border-muted">
            <th class="text-left py-2 pr-4 font-bold">Alert type</th>
            {#each data.channelIds as ch (ch)}
              <th class="text-center py-2 px-4 font-bold">{CHANNEL_LABELS[ch]}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.alertTypes as alertType (alertType)}
            <tr class="border-b border-border-muted last:border-b-0">
              <td class="py-2 pr-4 text-fg">{ALERT_LABELS[alertType]}</td>
              {#each data.channelIds as ch (ch)}
                <td class="py-2 px-4 text-center">
                  <input
                    type="checkbox"
                    bind:checked={config.routing[alertType][ch]}
                    disabled={!isConfigured(ch)}
                    class="w-4 h-4 accent-[var(--color-accent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <div class="flex items-center gap-4">
    <button
      type="button"
      onclick={save}
      disabled={saving}
      class="bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-5 py-2.5 rounded-md transition-colors"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>

</div>
