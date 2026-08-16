<script lang="ts">
  // HiL lede review — one visit: rate every lede, one free-text box, save.
  // Mobile-first: Matt opens this from a ntfy tap on his phone.
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types.js';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const CHOICES = [
    { value: 'love', label: '🔥 love' },
    { value: 'keep', label: '👍 keep' },
    { value: 'kill', label: '👎 kill' },
  ] as const;

  const prior = $derived(data.ratings?.ratings ?? {});
</script>

<svelte:head><title>HiL · {data.round.name}</title></svelte:head>

<main class="hil">
  <header>
    <p class="kicker">digest hil review</p>
    <h1>{data.round.name}</h1>
    {#if data.generatedAt}<p class="meta">ledes generated {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC</p>{/if}
  </header>

  {#if !data.ledes.length}
    <p class="empty">No ledes generated for this round yet.</p>
  {:else}
    <form method="POST" action="?/save" use:enhance>
      {#each data.ledes as lede (lede.id)}
        <section class="lede">
          <h2>{lede.title}</h2>
          <p class="angle">{lede.angle}</p>
          {#if lede.evidence?.length}
            <ul class="evidence">
              {#each lede.evidence as ev, i (i)}<li>"{ev}"</li>{/each}
            </ul>
          {/if}
          <div class="choices" role="radiogroup" aria-label={`Rate: ${lede.title}`}>
            {#each CHOICES as c (c.value)}
              <label class="choice">
                <input
                  type="radio"
                  name={`rating:${lede.id}`}
                  value={c.value}
                  checked={prior[lede.id] === c.value}
                />
                <span>{c.label}</span>
              </label>
            {/each}
          </div>
        </section>
      {/each}

      <section class="lede">
        <h2>Anything else</h2>
        <p class="angle">Direction the ledes missed — inside jokes, things you noticed this week, tone notes.</p>
        <textarea name="notes" rows="5" placeholder="e.g. Johanna keeps calling me Timmy…">{data.ratings?.notes ?? ''}</textarea>
      </section>

      <button type="submit" class="save">Save review</button>
      {#if form?.saved}<p class="saved">Saved — the punch-up pass will pick this up.</p>{/if}
      {#if data.ratings?.saved_at}<p class="meta">last saved {data.ratings.saved_at.slice(0, 16).replace('T', ' ')} UTC</p>{/if}
    </form>
  {/if}
</main>

<style>
  :global(body) { background: #101215; }
  .hil {
    max-width: 640px;
    margin: 0 auto;
    padding: 24px 16px 64px;
    color: #d7dae0;
    font: 400 15px/1.55 system-ui, sans-serif;
  }
  header { margin-bottom: 20px; }
  .kicker {
    margin: 0;
    font: 600 11px/1 ui-monospace, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #8b93a1;
  }
  h1 { margin: 6px 0 2px; font-size: 22px; line-height: 1.2; color: #f2f4f7; }
  .meta { margin: 4px 0 0; font: 400 11px/1.4 ui-monospace, monospace; color: #737b89; }
  .empty { color: #8b93a1; font-style: italic; }

  .lede {
    background: #171a1f;
    border: 1px solid #262b33;
    border-radius: 10px;
    padding: 14px 16px;
    margin: 0 0 12px;
  }
  .lede h2 { margin: 0 0 6px; font-size: 16px; color: #f2f4f7; }
  .angle { margin: 0 0 10px; color: #aab1bd; }
  .evidence { margin: 0 0 12px; padding: 0 0 0 16px; color: #8b93a1; font-size: 13px; }
  .evidence li { margin: 3px 0; }

  .choices { display: flex; gap: 8px; }
  .choice input { position: absolute; opacity: 0; }
  .choice span {
    display: inline-block;
    padding: 8px 14px;
    border: 1px solid #333a45;
    border-radius: 999px;
    font-size: 14px;
    cursor: pointer;
    user-select: none;
  }
  .choice input:checked + span { background: #2b3442; border-color: #5b8dd6; color: #fff; }
  .choice input:focus-visible + span { outline: 2px solid #5b8dd6; outline-offset: 2px; }

  textarea {
    width: 100%;
    box-sizing: border-box;
    background: #101215;
    border: 1px solid #333a45;
    border-radius: 8px;
    color: #d7dae0;
    padding: 10px;
    font: inherit;
    resize: vertical;
  }
  .save {
    width: 100%;
    padding: 13px;
    margin-top: 4px;
    background: #5b8dd6;
    color: #0d1117;
    font: 700 15px/1 system-ui, sans-serif;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  .save:hover { filter: brightness(1.08); }
  .saved { color: #7dc98f; font-size: 13px; margin: 8px 0 0; }
</style>
