// Client hooks — the browser-only mount point for the History viz enhancements
// (sprint-24, viz lane). These layer visual encoding onto the Theme/Player tabs
// purely off the data-attributes those tabs emit; they never edit the tab
// components and never refetch data. Mounting here (rather than in a component)
// keeps the viz lane out of the frontend's files entirely.
import { initThemePatterns } from '$lib/history/theme-patterns';
import { initTasteOverlap } from '$lib/history/taste-overlap';

initThemePatterns();
initTasteOverlap();
