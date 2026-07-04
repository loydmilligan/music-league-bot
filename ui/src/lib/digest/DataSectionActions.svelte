<script lang="ts">
  type Props = {
    excluded: boolean;
    state: 'default' | 'locked' | 'queued' | 'regenerating';
    onToggleExcluded: () => void;
    onToggleLocked: () => void;
    onRegen: () => void;
  };
  let { excluded, state, onToggleExcluded, onToggleLocked, onRegen }: Props = $props();
</script>

<div class="dg-section-actions">
  <button
    type="button"
    class="dg-sa-btn"
    onclick={onToggleExcluded}
    title={excluded ? 'Include in final' : 'Exclude from final'}
    aria-pressed={!excluded}
    disabled={state === 'regenerating'}
  >{excluded ? '+' : '⊘'}</button>
  <button
    type="button"
    class="dg-sa-btn"
    onclick={onRegen}
    title="Recompute this section…"
    disabled={state === 'regenerating' || excluded}
  >↻</button>
  <button
    type="button"
    class="dg-sa-btn"
    class:is-locked={state === 'locked'}
    onclick={onToggleLocked}
    title={state === 'locked' ? 'Unlock · allow batch regen' : 'Lock · pin this version'}
    aria-pressed={state === 'locked'}
    disabled={state === 'regenerating'}
  >{state === 'locked' ? '🔒' : '🔓'}</button>
</div>
