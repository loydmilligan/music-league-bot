<!--
  DotIndicator — colored dot prefix used in the leagues list and elsewhere.
  Example:
    <DotIndicator status="active" />
    <DotIndicator status="voting" size="md" />
-->
<script lang="ts">
  type Status = 'active' | 'voting' | 'open' | 'idle';
  type Size = 'sm' | 'md';

  let { status, size = 'sm' }: { status: Status; size?: Size } = $props();

  const colors: Record<Status, string> = {
    active: 'bg-accent',
    voting: 'bg-warn',
    open:   'bg-health',
    idle:   'bg-fg-faint',
  };

  const sizes: Record<Size, string> = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2.5 h-2.5',
  };
</script>

<span
  aria-label={status}
  class="inline-block rounded-full flex-shrink-0 {colors[status]} {sizes[size]}"
></span>
