<script lang="ts">
  import { nameToTone, nameInitials } from './tone.js';
  import { detectMedia } from '../historyQuery.js';

  interface Message {
    id: string;
    sender: string;
    text: string;
    ts: string;
    isBuffer?: boolean;
  }

  interface Props {
    messages: Message[];
    hitId?: string | null;
    filterSender?: string | null;
    filterSelf?: boolean;
    selfNames?: string[];
    viewerEl?: HTMLDivElement | null;
  }

  let {
    messages,
    hitId = null,
    filterSender = null,
    filterSelf = false,
    selfNames = [],
    viewerEl = $bindable(null),
  }: Props = $props();

  interface BubbleGroup {
    sender: string;
    dateKey: string;
    messages: Message[];
  }

  interface DayBlock {
    date: string;
    groups: BubbleGroup[];
  }

  function isoDateKey(ts: string): string {
    return ts.slice(0, 10);
  }

  function fmtDay(dateKey: string): string {
    return new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  function fmtTime(ts: string): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const filtered = $derived.by(() => {
    if (!filterSender && !filterSelf) return messages;
    return messages.filter(m => {
      if (filterSender && filterSelf) {
        return m.sender === filterSender || selfNames.some(n => n.toLowerCase() === m.sender.toLowerCase());
      }
      if (filterSender) return m.sender === filterSender;
      return false;
    });
  });

  const dayBlocks = $derived.by<DayBlock[]>(() => {
    const blocks: DayBlock[] = [];
    for (const msg of filtered) {
      const dateKey = isoDateKey(msg.ts);
      let day = blocks.at(-1);
      if (!day || day.date !== dateKey) {
        day = { date: dateKey, groups: [] };
        blocks.push(day);
      }
      const lastGroup = day.groups.at(-1);
      if (!lastGroup || lastGroup.sender !== msg.sender) {
        day.groups.push({ sender: msg.sender, dateKey, messages: [msg] });
      } else {
        lastGroup.messages.push(msg);
      }
    }
    return blocks;
  });

  // Scroll to the hit message after render
  $effect(() => {
    if (!hitId || !viewerEl) return;
    const el = viewerEl.querySelector(`[data-msgid="${hitId}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
</script>

{#if filtered.length === 0}
  <div class="ch-empty">No messages to show.</div>
{:else}
  <div class="ch-thread" bind:this={viewerEl}>
    {#each dayBlocks as day (day.date)}
      <div class="ch-daysep">
        <div class="ch-daysep-line"></div>
        <span class="ch-daysep-label">{fmtDay(day.date)}</span>
        <div class="ch-daysep-line"></div>
      </div>
      {#each day.groups as group (group.sender + group.messages[0].ts)}
        {@const tone = nameToTone(group.sender)}
        {@const initials = nameInitials(group.sender)}
        <div class="ch-group">
          <div class="ch-group-avatar {tone}">{initials}</div>
          <div class="ch-group-body">
            <div class="ch-group-name {tone}">{group.sender}</div>
            <div class="ch-bubbles">
              {#each group.messages as msg (msg.id)}
                {@const media = detectMedia(msg.text)}
                <div
                  class="ch-bub"
                  class:is-hit={msg.id === hitId}
                  class:is-buffer={msg.isBuffer}
                  data-msgid={msg.id}
                >
                  {msg.text}
                  {#if media.hasMedia}
                    <span class="ch-media-chip {media.mediaType}">{media.mediaType}</span>
                  {/if}
                  <span class="ch-bub-tm">{fmtTime(msg.ts)}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    {/each}
  </div>
{/if}
