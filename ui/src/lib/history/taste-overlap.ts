// ── History → Player research: taste-overlap bars (viz, sprint-24) ──────────
// Presentation-only enhancement layered on the Player research panel WITHOUT
// editing it (frozen seam: PlayerResearchTab emits, pre-sorted desc,
//   <div class="taste-overlap"> … <div class="taste-overlap-row" data-name data-score> … ).
// We read data-score and write two CSS custom properties per row so
// taste-overlap.css can draw a ranked horizontal bar behind each row:
//   --bar-frac      → bar width, normalised so the strongest overlap fills it
//   --bar-strength  → fill opacity, stronger overlap = bolder (sprint-23 red
//                     hue + "stronger = bolder" convention reused verbatim).
// No refetch — consumes the data the player tab already loaded.
import { browser } from '$app/environment';

const MIN_FRAC = 0.06; // keep the weakest overlap visible as a sliver
const MIN_STRENGTH = 0.18;
const MAX_STRENGTH = 0.78;

/** Size every rendered `.taste-overlap` group's rows relative to its leader. */
function sizeOverlapBars(root: ParentNode = document) {
  const groups = root.querySelectorAll<HTMLElement>('.taste-overlap');
  for (const group of groups) {
    const rows = Array.from(group.querySelectorAll<HTMLElement>('.taste-overlap-row'));
    if (!rows.length) continue;

    const scores = rows.map((r) => Number(r.dataset.score) || 0);
    const max = Math.max(...scores, 0);
    if (max <= 0) continue;

    for (let i = 0; i < rows.length; i++) {
      const ratio = scores[i] / max; // 1.0 for the strongest in this player's set
      const frac = MIN_FRAC + (1 - MIN_FRAC) * ratio;
      const strength = MIN_STRENGTH + (MAX_STRENGTH - MIN_STRENGTH) * ratio;
      rows[i].style.setProperty('--bar-frac', frac.toFixed(4));
      rows[i].style.setProperty('--bar-strength', strength.toFixed(3));
    }
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sizeOverlapBars();
  });
}

/** Mount once (browser only). Observes churn as players are selected. */
export function initTasteOverlap() {
  if (!browser) return;
  const start = () => {
    sizeOverlapBars();
    // childList only — our inline-style writes must not retrigger the observer.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
