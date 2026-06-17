<script lang="ts">
  import '../app.css';
  import '$lib/content/content.css';
  import { page } from '$app/state';
  import { fly, fade } from 'svelte/transition';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import DotIndicator from '$lib/components/DotIndicator.svelte';
  import MlAuthBadge from '$lib/components/MlAuthBadge.svelte';
  // Single source of truth for the displayed app version — stays in lockstep
  // with ui/package.json so the footer never drifts from the published version.
  import pkg from '../../package.json';

  const appVersion = pkg.version;

  let { children } = $props();

  // sprint-20 html-share hotfix: bare layout for the public share artifact —
  // ONLY the digest content, none of the app chrome (nav rail, mobile drawer,
  // league list, bot-health footer, links to other routes). Driven by the
  // digest page's inlined load data (`page.data.share`), NOT the live URL, so
  // it stays consistent across SSR (rendered at ?share=1) and client hydration
  // (served at /d/<slug>/). Distinct from ?export=1 — interactivity stays ON.
  const isShare = $derived(Boolean((page.data as { share?: boolean } | undefined)?.share));

  type NavItem = { href: string; label: string; glyph: string; count?: string; badge?: number };
  const chatUnassignedCount = $derived(((page.data as { chatUnassignedCount?: number } | undefined)?.chatUnassignedCount ?? 0));
  const contentPendingCount = $derived(((page.data as { contentPendingCount?: number } | undefined)?.contentPendingCount ?? 0));
  const navItems = $derived<NavItem[]>([
    { href: '/',          label: 'Active round',   glyph: '▸', count: 'r-14' },
    { href: '/shortlist', label: 'Shortlist',      glyph: '▸', count: '11' },
    { href: '/chat',      label: 'Chat watcher',   glyph: '▸', count: chatUnassignedCount > 0 ? String(chatUnassignedCount) : undefined },
    { href: '/content',   label: 'Content',        glyph: '▸', badge: contentPendingCount > 0 ? contentPendingCount : undefined },
    { href: '/history',   label: 'History',        glyph: '▸' },
    { href: '/settings',  label: 'Settings',       glyph: '▸' },
  ]);

  // Opportunistically pull active-leagues data from the home page's loader when
  // we're on /. Other routes get a placeholder. Backend can later supply a
  // dedicated +layout.server.ts for full coverage — flagged in Blockers.
  type ActiveSeason = {
    league: { slug: string; name: string };
    seasonNumber: number;
    currentRound: { id: number; name: string; submissionDeadline: string | null; votingDeadline: string | null } | null;
    researchCount: number;
  };

  const activeLeagues = $derived(((page.data as { activeSeasons?: ActiveSeason[] } | undefined)?.activeSeasons ?? []));

  function leagueStatus(s: ActiveSeason): 'active' | 'voting' | 'open' | 'idle' {
    if (!s.currentRound) return 'idle';
    const now = Date.now();
    const sub = s.currentRound.submissionDeadline ? Date.parse(s.currentRound.submissionDeadline) : null;
    const vote = s.currentRound.votingDeadline ? Date.parse(s.currentRound.votingDeadline) : null;
    if (sub && sub > now) return 'open';
    if (vote && vote > now) return 'voting';
    return 'active';
  }

  function leagueSubline(s: ActiveSeason): string {
    if (!s.currentRound) return 'idle';
    const status = leagueStatus(s);
    const label = status === 'open' ? 'open' : status === 'voting' ? 'voting' : 'active';
    return `r-${s.currentRound.id} · ${label}`;
  }

  function isCurrent(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    // Content nav item is active for both /content and /digest/* routes
    if (href === '/content') return page.url.pathname.startsWith('/content') || page.url.pathname.startsWith('/digest');
    return page.url.pathname.startsWith(href);
  }

  // -------- Mobile / PWA nav (sprint-19 mobile-digest-menu) ----------
  // The desktop rail is `hidden md:flex`, so below md there was no nav at all —
  // phone + installed-PWA users couldn't reach the digest flow. This drawer is
  // an ADDITIVE affordance shown only below md; the desktop sidebar is unchanged.
  let mobileNavOpen = $state(false);
  function closeMobileNav() {
    mobileNavOpen = false;
  }
  // Close the drawer whenever the route changes (tap an item → navigate → close).
  $effect(() => {
    page.url.pathname; // track
    mobileNavOpen = false;
  });
  function onNavKey(e: KeyboardEvent) {
    if (e.key === 'Escape') mobileNavOpen = false;
  }
</script>

<!-- Shared primary-nav list — rendered by the desktop rail AND the mobile drawer
     so the two never drift (sprint-19). -->
{#snippet navList()}
  <ul class="flex flex-col gap-0.5">
    {#each navItems as item}
      {@const current = isCurrent(item.href)}
      <li>
        <a
          href={item.href}
          class="flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm rounded-sm border-l-2 transition-colors"
          class:border-accent={current}
          class:bg-accent-bg={current}
          class:text-accent={current}
          class:border-transparent={!current}
          class:text-fg-muted={!current}
          class:hover:text-fg={!current}
          class:hover:bg-surface={!current}
        >
          <span class="text-fg-faint text-xs flex-shrink-0" aria-hidden="true">{item.glyph}</span>
          <span class="flex-1 truncate">{item.label}</span>
          {#if item.badge}
            <span class="ml-nav-badge">{item.badge}</span>
          {:else if item.count}
            <StatusChip label={item.count} tone="muted" />
          {/if}
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

{#if isShare}
  <!-- Bare share layout — digest content only, zero app chrome.
       No horizontal padding below sm (640px) so the digest card fills the
       phone viewport edge-to-edge. px-6/md:px-10 kick in at tablet+. -->
  <div class="min-h-screen bg-bg text-fg">
    <main class="px-0 sm:px-6 md:px-10 py-8">
      <div class="max-w-5xl mx-auto">
        {@render children?.()}
      </div>
    </main>
  </div>
{:else}
<div class="min-h-screen flex flex-col md:flex-row bg-bg text-fg">
  <!-- Mobile top bar — additive nav affordance below md (sprint-19). The desktop
       rail is `hidden md:flex`; in the installed PWA (display: standalone) there
       is no browser chrome, so this bar is the only way to reach the nav/digest. -->
  <header
    class="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border-muted bg-bg-elevated"
  >
    <a href="/" class="flex items-baseline gap-1.5 group">
      <span class="ml-mark leading-none transition-colors">m/l</span>
      <span class="font-mono text-xs text-fg-muted">music-league-bot</span>
    </a>
    <button
      type="button"
      class="flex items-center justify-center w-10 h-10 -mr-2 rounded-sm text-fg-muted hover:text-fg hover:bg-surface transition-colors"
      aria-label="Open navigation menu"
      aria-expanded={mobileNavOpen}
      aria-controls="mobile-nav-drawer"
      onclick={() => (mobileNavOpen = true)}
    >
      <span class="text-xl leading-none" aria-hidden="true">☰</span>
    </button>
  </header>

  <!-- Left rail -->
  <aside class="hidden md:flex flex-col w-[232px] flex-shrink-0 border-r border-border-muted bg-bg-elevated sticky top-0 h-screen overflow-y-auto">
    <!-- Header / wordmark -->
    <header class="px-5 pt-6 pb-5 border-b border-border-muted">
      <SectionLabel>Mash co.</SectionLabel>
      <a href="/" class="flex items-baseline gap-1.5 mt-2 group">
        <span class="ml-mark leading-none transition-colors">m/l</span>
        <span class="font-mono text-xs text-fg-muted truncate">music-league-bot</span>
      </a>
      <div class="mt-2">
        <MlAuthBadge />
      </div>
    </header>

    <!-- Primary nav -->
    <nav class="px-2 py-4">
      {@render navList()}
    </nav>

    <!-- Leagues -->
    <section class="px-5 pt-2 pb-4">
      <SectionLabel>Leagues</SectionLabel>
      <ul class="flex flex-col gap-3 mt-3">
        {#each activeLeagues as s (s.league.slug + s.seasonNumber)}
          <li>
            <a
              href="/league/{s.league.slug}/season/{s.seasonNumber}"
              class="flex items-start gap-2 group"
            >
              <span class="mt-1.5"><DotIndicator status={leagueStatus(s)} /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold text-fg group-hover:text-accent transition-colors truncate">
                  {s.league.name}
                </span>
                <span class="block text-[11px] font-mono text-fg-dim truncate">
                  {leagueSubline(s)}
                </span>
              </span>
            </a>
          </li>
        {:else}
          <li class="text-xs font-mono text-fg-faint italic">No active leagues.</li>
        {/each}
      </ul>
    </section>

    <!-- Cross-league next -->
    <section class="px-5 pt-2 pb-4">
      <SectionLabel>Cross-league next</SectionLabel>
      <!-- TODO: backend loader for cross-league upcoming actions (round deadlines across
           all active leagues, sorted by soonest). Layout has no dedicated +layout.server.ts
           yet — see sprint-2 Blockers. -->
      <p class="text-xs font-mono text-fg-faint italic mt-3">No upcoming actions.</p>
    </section>

    <!-- Spacer pushes footer to bottom -->
    <div class="flex-1"></div>

    <!-- Footer health -->
    <footer class="px-5 pt-4 pb-5 border-t border-border-muted space-y-1.5">
      <!-- TODO: real watcher uptime + db size + last-poll timestamp from a backend loader. -->
      <StatusChip label="WATCHER LIVE · 4D UPTIME" tone="health" />
      <div class="font-mono text-[11px] text-fg-dim">sqlite ml-bot.db · 12.4 MB</div>
      <div class="font-mono text-[11px] text-fg-faint">last poll 6:32:14 PM</div>
      <div class="font-mono text-[11px] text-fg-faint">mash co. · v{appVersion}</div>
    </footer>
  </aside>

  <!-- Main column -->
  <main class="flex-1 min-w-0 px-6 md:px-10 py-8">
    <div class="max-w-5xl mx-auto">
      {@render children?.()}
    </div>
  </main>

  <!-- Mobile nav drawer + scrim (below md only; under the z-50 digest modals so
       a modal opened from a page still sits on top). Closes on tap-outside, Esc,
       or route change. -->
  {#if mobileNavOpen}
    <button
      type="button"
      class="md:hidden fixed inset-0 z-40 bg-black/60"
      aria-label="Close navigation menu"
      onclick={closeMobileNav}
      transition:fade={{ duration: 150 }}
    ></button>
    <aside
      id="mobile-nav-drawer"
      class="md:hidden fixed inset-y-0 left-0 z-40 w-[260px] max-w-[80vw] flex flex-col border-r border-border-muted bg-bg-elevated overflow-y-auto"
      transition:fly={{ x: -280, duration: 200 }}
    >
      <header class="px-5 pt-6 pb-5 border-b border-border-muted flex items-start justify-between gap-2">
        <div class="min-w-0">
          <SectionLabel>Mash co.</SectionLabel>
          <a href="/" class="flex items-baseline gap-1.5 mt-2 group">
            <span class="ml-mark leading-none transition-colors">m/l</span>
            <span class="font-mono text-xs text-fg-muted truncate">music-league-bot</span>
          </a>
          <div class="mt-2">
            <MlAuthBadge />
          </div>
        </div>
        <button
          type="button"
          class="flex items-center justify-center w-9 h-9 -mr-1 flex-shrink-0 rounded-sm text-fg-muted hover:text-fg hover:bg-surface transition-colors"
          aria-label="Close navigation menu"
          onclick={closeMobileNav}
        >
          <span class="text-lg leading-none" aria-hidden="true">✕</span>
        </button>
      </header>

      <nav class="px-2 py-4">
        {@render navList()}
      </nav>

      <div class="flex-1"></div>

      <footer class="px-5 pt-4 pb-5 border-t border-border-muted">
        <div class="font-mono text-[11px] text-fg-faint">mash co. · v{appVersion}</div>
      </footer>
    </aside>
  {/if}
</div>
{/if}

<svelte:window onkeydown={onNavKey} />

<style>
  /* Canonical pulp m/l mark — recipe from
     data/Mash Co. Design System-handoff/.../brand/m-l-mark.html.
     Scoped to the layout for now; promote to a shared component or
     app.css utility when a second consumer appears. */
  .ml-mark {
    font-family: var(--font-display), system-ui, sans-serif;
    font-weight: 800;
    font-style: italic;
    letter-spacing: -0.06em;
    font-size: 28px;
    color: var(--color-accent);
    -webkit-text-stroke: 2.5px var(--color-accent-deep);
    paint-order: stroke fill;
    transform: translateY(-4%);
    text-shadow:
      0 0.25px 0 var(--color-accent-deep),
      0 0.5px  0 var(--color-accent-deep),
      0 0.75px 0 var(--color-accent-deep),
      0 1px    0 var(--color-accent-deep),
      0 1.25px 0 var(--color-accent-deep),
      0 1.5px  0 var(--color-accent-deep),
      0 2px    3px rgba(0, 0, 0, 0.45);
  }
  .group:hover .ml-mark {
    color: var(--color-accent-strong);
  }
</style>
