<script lang="ts">
  type Props = { artist: string; size?: number };
  let { artist, size = 44 }: Props = $props();

  const initials = $derived(
    artist
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase(),
  );
  const fontSize = $derived(Math.floor(size * 0.36));
</script>

<div
  class="dg-art"
  style:width="{size}px"
  style:height="{size}px"
  style:border-radius="6px"
  style:display="grid"
  style:place-items="center"
  style:font-family="var(--font-mono)"
  style:font-weight="700"
  style:font-size="{fontSize}px"
  style:color="rgba(255,255,255,0.16)"
  style:text-transform="uppercase"
  style:overflow="hidden"
  style:position="relative"
>
  <span style:position="relative" style:z-index="1">{initials}</span>
</div>
