<script lang="ts">
  import { page } from '$app/state';

  function isOn(href: string): boolean {
    if (href === '/settings') {
      return (
        page.url.pathname === '/settings' ||
        page.url.pathname.startsWith('/settings/api-tokens')
      );
    }
    return page.url.pathname.startsWith(href);
  }

  const tabs = [
    { href: '/settings',        label: 'App Settings',        glyph: '≡' },
    { href: '/settings/setup',  label: 'Music League Setup',  glyph: '◎' },
    { href: '/settings/models', label: 'Models & AI',         glyph: '∴' },
    { href: '/settings/debug',  label: 'Debug',               glyph: '⚙' },
  ] as const;
</script>

<div class="ct-tabrow">
  <div class="ct-tabs">
    {#each tabs as tab}
      {#if isOn(tab.href)}
        <span class="ct-tab is-on">
          <span class="ct-tab-glyph">{tab.glyph}</span>
          {tab.label}
        </span>
      {:else}
        <a href={tab.href} class="ct-tab">
          <span class="ct-tab-glyph">{tab.glyph}</span>
          {tab.label}
        </a>
      {/if}
    {/each}
  </div>
</div>
