// ── History → Theme research: cross-season pattern encoding (viz, sprint-24) ─
// A presentation-only enhancement layered on the Theme research tab WITHOUT
// editing it (frozen seam: ThemeResearchTab emits, per pick row,
//   <li class="theme-pick" data-artist data-submitter data-points>).
// We read those data-attributes and write the SAME data-history-status the
// sprint-23 SongSearchCard emits, so the existing history-coloring.css styles
// theme picks with zero new colour rules — true reuse of the me-vs-others
// encoding:
//   • the current user's own picks  → "submitted-mine"  (bold solid red)
//   • a recurring artist in a theme → "artist-mine"      (orange)
//   • a recurring artist the user also picked → submitted-mine + the
//     orange secondary ring (data-artist-mine), exactly the multi-signal
//     stacking sprint-23 defined.
//
// "Recurring artist across a theme" = an artist appearing on 2+ picks within
// the same expanded theme (two submitters reaching for the same artist on one
// prompt — a real cross-season tell). Only one theme is expanded at a time, so
// the seam exposes one theme's picks at once; we intentionally do NOT refetch
// or re-wire data to reach across themes (viz lane contract).
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

// Who "me" is, mirroring the server-side MY_COMPETITOR_ID → competitor.name.
// Single-owner private bot, so a configurable default is sufficient; override
// with PUBLIC_OWNER_NAME if the corpus owner ever changes.
const OWNER = (env.PUBLIC_OWNER_NAME ?? 'Mashew').trim().toLowerCase();

const norm = (s: string | null) => (s ?? '').trim().toLowerCase();

/** Re-tag every rendered `.theme-pick` with its sprint-23 history-status. */
function tagThemePicks(root: ParentNode = document) {
  const picks = root.querySelectorAll<HTMLElement>('.theme-pick');
  if (!picks.length) return;

  // Group picks by their owning list (one expanded theme = one <ul>), so a
  // "recurring artist" is counted within a theme, not across the document.
  const byList = new Map<Element, HTMLElement[]>();
  for (const pick of picks) {
    const list = pick.closest('ul') ?? pick.parentElement ?? document.body;
    (byList.get(list) ?? byList.set(list, []).get(list)!).push(pick);
  }

  for (const group of byList.values()) {
    const artistCount = new Map<string, number>();
    for (const pick of group) {
      const a = norm(pick.dataset.artist ?? null);
      if (a) artistCount.set(a, (artistCount.get(a) ?? 0) + 1);
    }

    for (const pick of group) {
      const mine = norm(pick.dataset.submitter ?? null) === OWNER;
      const artist = norm(pick.dataset.artist ?? null);
      const recurringArtist = artist !== '' && (artistCount.get(artist) ?? 0) >= 2;

      // Strongest single signal drives the border (sprint-23 precedence:
      // mine > artist). In a full pick list every row is "submitted", so we
      // deliberately surface only MINE (red) and RECURRING ARTIST (orange) —
      // everything else stays neutral and the patterns pop.
      const status = mine ? 'submitted-mine' : recurringArtist ? 'artist-mine' : 'none';

      if (status === 'none') {
        delete pick.dataset.historyStatus;
        delete pick.dataset.submittedByMe;
        delete pick.dataset.artistMine;
        continue;
      }
      pick.dataset.historyStatus = status;
      if (mine) pick.dataset.submittedByMe = 'true';
      else delete pick.dataset.submittedByMe;
      // A pick that is both mine AND a recurring artist keeps the red border
      // and gains the orange secondary ring (sprint-23 stacking).
      if (mine && recurringArtist) pick.dataset.artistMine = 'true';
      else delete pick.dataset.artistMine;
    }
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    tagThemePicks();
  });
}

/** Mount once (browser only). Observes childList churn as themes expand. */
export function initThemePatterns() {
  if (!browser) return;
  const start = () => {
    tagThemePicks();
    // Observe structure only (not attributes) so our own data-* writes never
    // retrigger the observer — no feedback loop.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
