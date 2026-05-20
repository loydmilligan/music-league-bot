<script lang="ts">
  // Two-phase modal: 'input' (label entry) → 'reveal' (one-time plaintext token
  // + Copy button). The reveal phase is the only chance to see the token —
  // closing it after reveal triggers onGenerated() so the parent list refreshes.

  type Props = {
    onCancel: () => void;
    onGenerated: () => void;
  };
  let { onCancel, onGenerated }: Props = $props();

  type Phase = 'input' | 'reveal';
  let phase = $state<Phase>('input');

  let label = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  let revealedToken = $state<string | null>(null);
  let revealedLabel = $state<string>('');
  let copyStatus = $state<'idle' | 'ok' | 'fail'>('idle');

  let labelInput = $state<HTMLInputElement | undefined>();
  $effect(() => {
    if (phase === 'input' && labelInput) labelInput.focus();
  });

  function handleScrim(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    if (submitting) return;
    safeClose();
  }
  function handleScrimKey(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (submitting) return;
    if (e.key === 'Enter' || e.key === ' ') safeClose();
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) safeClose();
  }

  function safeClose() {
    if (phase === 'reveal') {
      // Reveal phase close → still treat as "generated" so the list refreshes.
      onGenerated();
    } else {
      onCancel();
    }
  }

  async function submit() {
    if (submitting) return;
    const trimmed = label.trim();
    if (!trimmed) {
      error = 'Label is required.';
      return;
    }
    submitting = true;
    error = null;
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      const body = (await res.json()) as { token?: string; label?: string };
      if (!body.token) throw new Error('Server response missing plaintext token.');
      revealedToken = body.token;
      revealedLabel = body.label ?? trimmed;
      phase = 'reveal';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function copyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      copyStatus = 'ok';
      setTimeout(() => (copyStatus = 'idle'), 2000);
    } catch {
      copyStatus = 'fail';
      setTimeout(() => (copyStatus = 'idle'), 3000);
    }
  }

  function dismissReveal() {
    onGenerated();
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="dg-modal-scrim"
  onclick={handleScrim}
  onkeydown={handleScrimKey}
  role="dialog"
  aria-modal="true"
  aria-label={phase === 'input' ? 'Generate API token' : 'Copy new API token'}
  tabindex="-1"
>
  <div class="dg-modal tk-modal">
    <header class="dg-modal-head">
      <h3>
        {#if phase === 'input'}
          Generate API token
        {:else}
          New token · <span style="color: var(--mash-pulp);">{revealedLabel}</span>
        {/if}
      </h3>
      {#if phase === 'input'}
        <button type="button" class="x" onclick={onCancel} aria-label="Close" disabled={submitting}>✕</button>
      {/if}
    </header>

    <div class="dg-modal-body">
      {#if phase === 'input'}
        <span class="dg-modal-eyebrow">Label</span>
        <input
          type="text"
          class="tk-input"
          bind:value={label}
          bind:this={labelInput}
          placeholder="e.g. chrome extension · laptop"
          maxlength="64"
          disabled={submitting}
          onkeydown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <p class="dg-modal-hint">
          Used for your own bookkeeping — pick something that tells you where this token will live.
        </p>
        {#if error}
          <p class="tk-error">{error}</p>
        {/if}
      {:else if phase === 'reveal' && revealedToken}
        <div class="tk-warn">
          <strong>This is the only time you will see this token.</strong>
          Copy it now — it cannot be retrieved later. If you lose it, generate a new one and revoke this one.
        </div>
        <span class="dg-modal-eyebrow">Token</span>
        <div class="tk-token-row">
          <code class="tk-token">{revealedToken}</code>
          <button
            type="button"
            class="mash-btn mash-btn--secondary mash-btn--sm"
            onclick={copyToken}
          >
            {copyStatus === 'ok' ? '✓ Copied' : copyStatus === 'fail' ? '! Failed' : '⧉ Copy'}
          </button>
        </div>
        <p class="dg-modal-hint">
          Paste into the browser extension's settings panel (or wherever else this token is needed).
        </p>
      {/if}
    </div>

    <footer class="dg-modal-foot">
      {#if phase === 'input'}
        <span class="cost">{submitting ? 'generating…' : `${label.trim().length}/64 chars`}</span>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel} disabled={submitting}>Cancel</button>
          <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit} disabled={submitting || !label.trim()}>
            {submitting ? '…' : '↻'} Generate
          </button>
        </div>
      {:else}
        <span class="cost">close to acknowledge · token will not be shown again</span>
        <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={dismissReveal}>
          I've saved it — close
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .tk-modal {
    max-width: 560px;
    width: min(94vw, 560px);
  }
  .tk-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--ink-0);
    color: var(--fg);
    font: 500 14px/1.3 var(--font-body);
  }
  .tk-input:focus {
    outline: none;
    border-color: var(--mash-pulp, var(--fg));
  }
  .tk-error {
    margin: 8px 0 0;
    font: 600 12px/1.4 var(--font-mono);
    color: var(--ember, #d05a46);
  }
  .tk-warn {
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid var(--amber, #d29400);
    background: rgba(210, 148, 0, 0.1);
    border-radius: var(--r-2);
    font: 500 12.5px/1.5 var(--font-body);
    color: var(--fg);
  }
  .tk-warn strong { display: block; margin-bottom: 4px; color: var(--amber, #d29400); }
  .tk-token-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .tk-token {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid var(--line);
    background: var(--ink-0);
    border-radius: var(--r-2);
    font: 500 12.5px/1.4 var(--font-mono);
    color: var(--fg);
    word-break: break-all;
    user-select: all;
  }
</style>
