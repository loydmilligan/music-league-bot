// ── The style shelf, mounted ─────────────────────────────────────────────────
//
// One component per `style:` on the shelf (see ../regularStyles.ts for the
// contract). StorylinesCast picks a component by `resolveStyle(entry)` and
// renders it with exactly `{ entry, isExport }` — adding a style is a new
// component plus one line here, no `{#if style === …}` in the carrier.

import type { Component } from 'svelte';
import type { RegularEntry, RegularStyle } from '../regularStyles.js';

import Buzzer from './Buzzer.svelte';
import CallResponse from './CallResponse.svelte';
import EditHistory from './EditHistory.svelte';
import QuoteLed from './QuoteLed.svelte';
import Refrain from './Refrain.svelte';
import RosterMap from './RosterMap.svelte';
import Spotlight from './Spotlight.svelte';

/** Props every style component takes — the whole interface, deliberately tiny. */
export type RegularStyleProps = { entry: RegularEntry; isExport: boolean };

export const REGULAR_STYLE_COMPONENTS: Record<RegularStyle, Component<RegularStyleProps>> = {
  'quote-led': QuoteLed,
  spotlight: Spotlight,
  'call-response': CallResponse,
  'edit-history': EditHistory,
  'roster-map': RosterMap,
  refrain: Refrain,
  buzzer: Buzzer,
};
