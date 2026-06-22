<script lang="ts">
  import { nameToTone, nameInitials } from './tone.js';

  interface Props {
    sender: string;
    text: string;
    ts: string;
    roundId: number;
    roundName: string;
    query?: string;
    platform: string;
    hasMedia?: boolean;
    mediaType?: string | null;
    onclick: () => void;
  }

  let {
    sender,
    text,
    ts,
    roundId,
    roundName,
    query = '',
    platform,
    hasMedia = false,
    mediaType = null,
    onclick,
  }: Props = $props();

  const tone = $derived(nameToTone(sender));
  const initials = $derived(nameInitials(sender));

  function highlight(str: string, q: string): string {
    if (!q) return escapeHtml(str);
    const escaped = escapeHtml(str);
    const escapedQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark>$1</mark>');
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const highlighted = $derived(highlight(text, query));
</script>

<button type="button" class="ch-msg-card w-full text-left" {onclick}>
  <div class="ch-msg-card-header">
    <div class="ch-msg-card-avatar {tone}">{initials}</div>
    <span class="text-sm font-bold {tone} truncate">{sender}</span>
    <span class="font-mono text-[10px] text-fg-faint ml-auto flex-shrink-0">{fmtDate(ts)}</span>
  </div>
  <div class="ch-msg-card-text">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html highlighted.slice(0, 120) + (text.length > 120 ? '…' : '')}
  </div>
  <div class="ch-msg-card-round flex items-center gap-2">
    <span class="ch-pip {platform}"></span>
    r-{roundId} · {roundName}
    {#if hasMedia && mediaType}
      <span class="ch-media-chip {mediaType}">{mediaType}</span>
    {/if}
  </div>
</button>
