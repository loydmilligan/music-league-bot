<script lang="ts">
  import '$lib/digest/digest.css';
  import { invalidateAll } from '$app/navigation';
  import DigestSection, { type SectionState } from '$lib/digest/DigestSection.svelte';
  import RegenModal from '$lib/digest/RegenModal.svelte';
  import GenerateModal, { type GenerateParams } from '$lib/digest/GenerateModal.svelte';
  import RelContextDiffModal, { type DiffSegment } from '$lib/digest/RelContextDiffModal.svelte';
  import { SECTION_KINDS, type SectionKind } from '$lib/digest/llm.js';
  import { coerceVariant, type SectionVariant, type VisualRegistry } from '$lib/digest/variants.js';
  import AlbumPodium from '$lib/digest/AlbumPodium.svelte';
  import StandingsChart from '$lib/digest/StandingsChart.svelte';
  import ChatMoments from '$lib/digest/ChatMoments.svelte';
  import StatStrip from '$lib/digest/StatStrip.svelte';
  import TastemakerSection from '$lib/digest/TastemakerSection.svelte';
  import NextRoundPreview from '$lib/digest/NextRoundPreview.svelte';
  import NextRoundSection from '$lib/digest/NextRoundSection.svelte';
  import ReconciliationModal from '$lib/digest/ReconciliationModal.svelte';
  import EditableStandingsTable from '$lib/digest/EditableStandingsTable.svelte';
  import type { Reconcile, StandingsResult } from '$lib/db/standings.js';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types.js';
  import type { RoundIndexEntry } from './+page.server.js';

  let { data }: { data: PageData } = $props();

  // Export format. The PNG/PDF renderers load this page with ?format=mobile|wide;
  // when mobile, the .dg-export frame gets the dg-export--mobile reflow class. The
  // on-screen selector (`exportFormat`) drives which artifact the Finalize / Export
  // action requests. Default PDF — the primary phone share artifact this sprint.
  const isMobileExport = $derived(page.url.searchParams.get('format') === 'mobile');
  // `html` (sprint-20) is the one INTERACTIVE export — it publishes the live
  // digest to the public static host and returns a share URL ({ url }), not
  // downloadable files. It's handled by a separate publish path, not downloadFiles.
  type ExportFormat = 'pdf' | 'mobile' | 'wide' | 'png-sections' | 'html';
  const EXPORT_FORMATS: { id: ExportFormat; label: string; title: string }[] = [
    { id: 'pdf',          label: '📄 PDF',      title: 'Phone-portrait, multi-page, crisp/selectable text — primary share' },
    { id: 'mobile',       label: '📱 PNG',      title: 'Phone-portrait single PNG (WhatsApp)' },
    { id: 'wide',         label: '🖥 Wide',     title: 'Wide desktop broadsheet PNG (800px)' },
    { id: 'png-sections', label: '🧩 Sections', title: 'One PNG per section + a podium-only image' },
    { id: 'html',         label: '🔗 Share',    title: 'Publish the interactive digest to a public share link (digest.mattmariani.com) — no login, tap-modal works' },
  ];
  let exportFormat = $state<ExportFormat>('pdf');

  type LeagueGroup = {
    leagueId: number;
    leagueName: string;
    seasons: { seasonId: number; seasonNumber: number; rounds: RoundIndexEntry[] }[];
  };

  const roundGroups = $derived.by<LeagueGroup[]>(() => {
    const byLeague = new Map<number, LeagueGroup>();
    for (const r of data.roundsIndex) {
      let lg = byLeague.get(r.league_id);
      if (!lg) {
        lg = { leagueId: r.league_id, leagueName: r.league_name, seasons: [] };
        byLeague.set(r.league_id, lg);
      }
      let sg = lg.seasons.find((s) => s.seasonId === r.season_id);
      if (!sg) {
        sg = { seasonId: r.season_id, seasonNumber: r.season_number, rounds: [] };
        lg.seasons.push(sg);
      }
      sg.rounds.push(r);
    }
    return [...byLeague.values()];
  });

  const votingStillOpen = $derived.by(() => {
    const cr = data.currentRound;
    if (cr.voting_deadline) {
      const t = Date.parse(cr.voting_deadline);
      if (Number.isFinite(t) && t > Date.now()) return true;
    } else if (cr.season_status === 'active') {
      return true;
    }
    return false;
  });

  function onRoundChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const next = Number(target.value);
    if (Number.isFinite(next) && next !== data.roundId) {
      goto(`/digest/${next}`);
    }
  }

  function roundOptionLabel(r: RoundIndexEntry): string {
    const name = r.name && r.name.trim() ? r.name : `Round ${r.id}`;
    return `r-${r.id} · ${name}`;
  }

  type PipelineStage = 'prepare' | 'draft' | 'refine' | 'finalize';
  const PIPELINE: { id: PipelineStage; label: string }[] = [
    { id: 'prepare',  label: 'Prepare data' },
    { id: 'draft',    label: 'Generate draft' },
    { id: 'refine',   label: 'Refine sections' },
    { id: 'finalize', label: 'Finalize & export' },
  ];

  const SECTION_LABELS: Record<SectionKind, string> = {
    podium: 'A-side · final ranking',
    villain: 'B-side · the downvote',
    flow: 'Credits · notable votes',
    consensus: 'Consensus & controversy',
    quotes: 'Liner quotes',
    chat: 'Back cover · chat notes',
  };

  // When stage === 'finalize' (finalized_at is set), activeIdx advances past
  // the last step so all 4 pipeline pills render as 'done'.
  const activeIdx = $derived(
    data.stage === 'prepare'
      ? 0
      : data.stage === 'refine'
        ? 2
        : data.stage === 'finalize'
          ? 4
          : 0,
  );
  function stepState(i: number): 'done' | 'active' | 'pending' {
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'pending';
  }

  // -------- Prepare stage ----------
  let preparing = $state(false);
  async function rerunPrepare() {
    preparing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/prepare`, { method: 'POST' });
      if (!res.ok) throw new Error(`prepare failed (${res.status})`);
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      preparing = false;
    }
  }

  // -------- Import from CLI (sprint-11 Task B) ----------
  // Backend ships POST /api/digest/:roundId/import-export-zip that triggers
  // the host-side music-league CLI, downloads export.zip, runs it through the
  // existing import pipeline, then returns the refreshed prep checks payload.
  // Backend response shape (per sprint-11.md):
  //   success: { ok: true, imported: { submissions, votes, voteComments },
  //              checks: <prepare-checks payload> }
  //   failure: { ok: false, reason: string, stage: 'auth'|'cli'|'download'|'import'|'other' }
  // Visibility: button shows when any of the export.zip-resolvable checks
  // (Submissions / Votes / Vote comments) is failing.
  let importing = $state(false);
  const exportZipCheckNames = ['Submissions', 'Votes', 'Vote comments'];
  const exportZipChecksFailing = $derived(
    data.stage === 'prepare'
      ? data.checks.some((c) => exportZipCheckNames.includes(c.name) && !c.ok)
      : false,
  );

  async function importFromCli() {
    if (importing) return;
    importing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/import-export-zip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`import failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        stage?: 'auth' | 'cli' | 'download' | 'import' | 'other';
        imported?: { submissions?: number; votes?: number; voteComments?: number };
      };
      if (body.ok === false) {
        if (body.stage === 'auth') {
          showError('Music League auth has expired — click the ml-auth badge to re-login, then retry.');
        } else {
          showError(`Import failed (${body.stage ?? 'unknown'}): ${body.reason ?? 'no detail'}`);
        }
        await invalidateAll();
        return;
      }
      const imp = body.imported ?? {};
      const parts = [
        imp.submissions != null ? `${imp.submissions} submissions` : null,
        imp.votes != null ? `${imp.votes} votes` : null,
        imp.voteComments != null ? `${imp.voteComments} comments` : null,
      ].filter(Boolean);
      showError(parts.length ? `Imported: ${parts.join(', ')}` : 'Import complete.');
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      importing = false;
    }
  }

  // -------- Generate modal (sprint-14) ----------
  // The generate flow opens GenerateModal (per-section enable + style/context/
  // variant + paste-chat). Submit posts the Generation-params contract to
  // /draft, which (with params) regenerates the draft honoring the choices.
  let drafting = $state(false);
  let genModalOpen = $state(false);
  function openGenerate() { genModalOpen = true; }
  function closeGenerate() { if (!drafting) genModalOpen = false; }

  async function submitGenerate(params: GenerateParams) {
    drafting = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`draft failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        standings?: StandingsResult['standings'];
        reconcile?: Reconcile;
      };
      genModalOpen = false;

      // Standings handling (the draft endpoint recomputes + reconciles standings).
      standingsExcluded = !params.standings.include;
      standingsOverride = null; // fall back to the freshly-loaded gospel

      // Other synthetic data sections: include toggles are session-scoped; regen
      // recomputes them automatically — invalidateAll below re-fetches each data
      // endpoint, which recomputes from source (no LLM prompt path).
      statsExcluded = !params.stats.include;
      nextRoundExcluded = !params.nextRound.include;
      discoverabilityExcluded = !params.tastemaker.include;
      // Persist the next-round exclude flag to the draft (fire-and-forget).
      fetch(`/api/digest/${data.roundId}/next-round`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ excluded: nextRoundExcluded }),
      }).catch(() => {});
      if (params.standings.recompute) {
        // "Recompute from votes" → adopt the computed values as the new gospel.
        await adoptStandings();
      } else if (body.reconcile?.status === 'mismatch') {
        // Surface the guardrail: stored table vs the AI's computed values.
        reconcileData = body.reconcile;
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      drafting = false;
    }
  }

  // Adopt computed standings as gospel (used by the "recompute" gen option).
  async function adoptStandings() {
    try {
      const res = await fetch(`/api/digest/${data.roundId}/standings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'adopt' }),
      });
      if (!res.ok) throw new Error(`adopt failed (${res.status})`);
      applyStandings((await res.json()) as StandingsResult);
    } catch (err) {
      showError(err);
    }
  }

  // -------- Unfinalize (sprint-14) ----------
  // Clears finalized_at so a finalized digest re-enters the editable flow.
  let unfinalizing = $state(false);
  async function unfinalize() {
    unfinalizing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/unfinalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`unfinalize failed (${res.status}) ${text.slice(0, 200)}`);
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      unfinalizing = false;
    }
  }

  // -------- Rel-context diff (T13 deferred portion) ----------
  // Two sources, in priority order:
  //   1. data.relContext from +page.server.ts (GET /api/leagues/:leagueId/rel-context),
  //      which gives us refresh-persisted previousContext / context.
  //   2. relContextFromFinalize: $state populated by the latest finalize POST
  //      response when /api/digest/:roundId/finalize returns a fresh
  //      { previous, proposed, updatedAt, leagueId } payload. This takes
  //      precedence so the just-finalized diff surfaces immediately without
  //      waiting for invalidateAll() to roundtrip.
  type FinalizeRelContext = {
    leagueId: number;
    previous: string;
    proposed: string;
    updatedAt?: string | null;
  };
  let relContextFromFinalize = $state<FinalizeRelContext | null>(null);

  const relDiff = $derived.by<{ leagueId: number; previous: string; proposed: string } | null>(() => {
    if (relContextFromFinalize) {
      return {
        leagueId: relContextFromFinalize.leagueId,
        previous: relContextFromFinalize.previous,
        proposed: relContextFromFinalize.proposed,
      };
    }
    const rc = data.relContext;
    if (rc && rc.previousContext != null && rc.context !== rc.previousContext) {
      return { leagueId: rc.leagueId, previous: rc.previousContext, proposed: rc.context };
    }
    return null;
  });

  let relDiffOpen = $state(false);
  function openRelDiff() {
    if (relDiff) relDiffOpen = true;
  }
  function closeRelDiff() {
    relDiffOpen = false;
  }

  // -------- Finalize / export stage ----------
  // Both /finalize and /export return { files: [{ filename, downloadUrl, label }] }
  // (finalize additionally sets finalized_at + returns relContext/warnings). The
  // selected `exportFormat` drives which artifact(s) come back — pdf / mobile /
  // wide PNG = one file; png-sections = one per section + a podium-only image.
  type ExportFileRef = { filename: string; downloadUrl: string; label?: string };

  function downloadFiles(files: ExportFileRef[]) {
    if (!files.length) {
      showError('Export returned no files.');
      return;
    }
    // Stagger the clicks slightly so the browser doesn't drop concurrent
    // downloads (matters for png-sections, which returns several files).
    files.forEach((f, i) => {
      setTimeout(() => triggerDownload(f.downloadUrl, f.filename, false), i * 250);
    });
  }

  let finalizing = $state(false);
  async function finalizeAndDownload() {
    finalizing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: exportFormat }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`finalize failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        files?: ExportFileRef[];
        relContext?: FinalizeRelContext | null;
        warnings?: string[];
      };
      if (body.relContext && typeof body.relContext.previous === 'string' && typeof body.relContext.proposed === 'string') {
        relContextFromFinalize = body.relContext;
      }
      if (body.warnings?.length) {
        showError(`finalize warnings: ${body.warnings.join(' · ')}`);
      }
      downloadFiles(body.files ?? []);
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      finalizing = false;
    }
  }

  // Re-export an already-generated digest in the selected format WITHOUT
  // re-finalizing (no finalized_at / rel-context change).
  let exporting = $state(false);
  async function exportOnly() {
    exporting = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: exportFormat }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`export failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as { files?: ExportFileRef[] };
      downloadFiles(body.files ?? []);
    } catch (err) {
      showError(err);
    } finally {
      exporting = false;
    }
  }

  // -------- HTML share publish (sprint-20 html-export-ui) ----------
  // The `html` format publishes the interactive digest to the public static host
  // and returns a stable share URL ({ url: 'https://digest.mattmariani.com/d/<slug>' }),
  // NOT files. Re-publishing overwrites the same slug → the shared link never breaks.
  let publishing = $state(false);
  let shareUrl = $state<string | null>(null);
  let shareError = $state<string | null>(null);
  let copied = $state(false);

  async function publishHtml() {
    publishing = true;
    // Clear the prior result up-front so a failed re-publish surfaces the error
    // block instead of leaving a stale "published" URL on screen.
    shareError = null;
    shareUrl = null;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'html' }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`publish failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      if (!body.url) throw new Error('publish returned no url');
      shareUrl = body.url;
      copied = false;
    } catch (err) {
      shareError = err instanceof Error ? err.message : String(err);
      showError(err);
    } finally {
      publishing = false;
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard API can be blocked (insecure context / permissions) — the link
      // stays visible and selectable as a fallback.
      showError('Copy failed — select the link to copy it manually.');
    }
  }

  function triggerDownload(href: string, filename: string, isObjectUrl: boolean) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (isObjectUrl) {
      // Revoke after the click; small delay so the download starts.
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    }
  }

  // -------- Refine stage state ----------
  // Each section's UI state. Initialized from DB row state when sections load,
  // and reset on data refresh. Excluded/locked transitions stay local until a
  // backend PATCH endpoint exists for section.state.
  let sectionStates = $state<Record<string, SectionState>>({});
  $effect(() => {
    if (data.stage === 'refine' || data.stage === 'finalize') {
      const next: Record<string, SectionState> = {};
      for (const s of data.sections) next[s.id] = (s.state as SectionState) ?? 'default';
      sectionStates = next;
    } else {
      sectionStates = {};
    }
  });

  let lastInstructions = $state<Record<string, string>>({});
  let lastChips = $state<Record<string, string[]>>({});

  // -------- Variant system (sprint-14, +standings sprint-15) ----------
  // Visual component registry — frontend wires viz's visual components here.
  // Until a kind is registered, its visual slot falls back to VariantPlaceholder.
  //   podium         → AlbumPodium          (LLM section, visual variant)
  //   chat           → ChatMoments          (restructured { summary, moments[] }; web = expandable, PDF = anchor-linked)
  //   standings      → StandingsChart       (synthetic data-driven section, see below)
  //   stats          → StatStrip            (sprint-17 synthetic data-driven)
  //   discoverability→ TastemakerSection    (sprint-18 v2 — replaces v1 leaderboard)
  //   nextRound      → NextRoundPreview     (sprint-17 synthetic data-driven)
  const VISUAL_COMPONENTS: VisualRegistry = {
    podium: AlbumPodium,
    chat: ChatMoments,
    standings: StandingsChart,
    stats: StatStrip,
    discoverability: TastemakerSection,
    nextRound: NextRoundPreview,
  };

  // The standings chart's data slot (StandingsChart reads `data`, not content).
  // null when the round has no vote data / fetch failed → section self-hides.
  // `standingsOverride` lets an adopt/edit update the chart live (no reload);
  // `standingsExcluded` is the modal's include toggle (session-scoped — web view).
  let standingsOverride = $state<StandingsResult | null>(null);
  let standingsExcluded = $state(false);
  const standingsData = $derived(
    standingsOverride ??
      (data.stage === 'refine' || data.stage === 'finalize' ? data.standings : null),
  );
  const StandingsSlot = $derived(VISUAL_COMPONENTS.standings);
  const showStandings = $derived(
    !standingsExcluded && !!standingsData && (standingsData.standings?.length ?? 0) > 0,
  );

  // --- sprint-17 data-driven sections (each reads data via visualData; the
  //     component self-suppresses, but we also gate the wrap so no empty
  //     eyebrow/section renders when the payload is empty/null). Each carries a
  //     GenerateModal include toggle (session-scoped — like standings) + an
  //     availability indicator (sprint-18 integration-audit). ---
  const inDigest = $derived(data.stage === 'refine' || data.stage === 'finalize');

  // sprint-21 season-recap: data-section framing when the active draft is a recap.
  const recap = $derived(inDigest ? data.recap : null);

  const statsData = $derived(inDigest ? data.stats : null);
  let statsExcluded = $state(false);
  const statsAvailable = $derived(!!statsData && Object.values(statsData).some((v) => typeof v === 'number'));
  const showStats = $derived(!statsExcluded && statsAvailable);

  const discoverabilityData = $derived(inDigest ? data.discoverability : null);
  // v2 payload is a TastemakerPayload object (`.players`), not the v1 row array.
  // The backend self-suppresses to null on absent/partial (<80%) coverage, so a
  // non-null payload with players = "coverage ready". `discoverabilityExcluded`
  // is the GenerateModal include toggle (session-scoped — web view).
  let discoverabilityExcluded = $state(false);
  const tastemakerAvailable = $derived((discoverabilityData?.players?.length ?? 0) > 0);
  const showDiscoverability = $derived(!discoverabilityExcluded && tastemakerAvailable);
  const tastemakerCoverage = $derived<'ready' | 'incomplete'>(tastemakerAvailable ? 'ready' : 'incomplete');

  const nextRoundData = $derived(inDigest ? data.nextRound : null);
  // excluded flag loaded from server (persisted in draft) — falls back to false when no draft yet.
  let nextRoundExcluded = $state(data.stage !== 'prepare' ? data.nextRoundMeta.excluded : false);
  const nextRoundAvailable = $derived(
    !!nextRoundData
      && (
        !!nextRoundData.theme
        || !!nextRoundData.submissionDeadline
        || !!nextRoundData.votingDeadline
        || !!nextRoundData.deadline
      )
  );
  const nextRoundHasOverride = $derived(data.stage !== 'prepare' ? data.nextRoundMeta.hasOverride : false);
  // Show the section if the data is available (excluded state is handled by NextRoundSection's own rendering).
  const showNextRound = $derived(nextRoundAvailable);

  // Availability strings for the GenerateModal data-section indicators.
  const statsAvailability = $derived<'ready' | 'incomplete'>(statsAvailable ? 'ready' : 'incomplete');
  const standingsAvailability = $derived<'ready' | 'incomplete'>(
    !!standingsData && (standingsData.standings?.length ?? 0) > 0 ? 'ready' : 'incomplete',
  );
  const nextRoundAvailability = $derived<'ready' | 'incomplete'>(nextRoundAvailable ? 'ready' : 'incomplete');
  const StatSlot = $derived(VISUAL_COMPONENTS.stats);
  const DiscoverabilitySlot = $derived(VISUAL_COMPONENTS.discoverability);
  const NextRoundSlot = $derived(VISUAL_COMPONENTS.nextRound);

  // --- Reconciliation modal (fires on a gen/regen mismatch) + edit table ---
  let reconcileData = $state<Reconcile | null>(null);
  const showReconcile = $derived(reconcileData?.status === 'mismatch');
  let editTableOpen = $state(false);

  function applyStandings(result: StandingsResult) {
    standingsOverride = result; // instant chart re-render from the fresh gospel
  }

  // Per-section variant override set by the in-page variant switcher. Keyed by
  // section id; falls back to the persisted section.variant (set by the modal /
  // backend generation-wiring). Client switch re-renders without a reload.
  let variantOverrides = $state<Record<string, SectionVariant>>({});
  function sectionVariant(id: string, persisted: string | undefined): SectionVariant {
    return variantOverrides[id] ?? coerceVariant(persisted);
  }
  // The restructured chat section ({ summary, moments[] }) has no meaningful
  // textual form — it only renders via ChatMoments (the visual slot). So default
  // chat to 'visual' unless the user explicitly picked a visual mode already.
  function effectiveSectionVariant(kind: string, id: string, persisted: string | undefined): SectionVariant {
    const v = sectionVariant(id, persisted);
    if (kind === 'chat' && v === 'textual') return 'visual';
    return v;
  }
  function changeVariant(id: string, v: SectionVariant) {
    variantOverrides[id] = v; // optimistic — re-renders immediately, no reload
    // Persist so the choice survives reload. Fire-and-forget; on failure the
    // optimistic override still holds for this session.
    void fetch(`/api/digest/${data.roundId}/sections/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: v }),
    }).then((res) => {
      if (!res.ok) showError(`variant save failed (${res.status})`);
    }).catch((err) => showError(err));
  }

  // -------- Inline (non-LLM) section edit ----------
  // PATCH the section's content_json directly (no LLM). On success invalidateAll
  // re-pulls the persisted content so the edit survives reload.
  async function saveInlineEdit(sectionId: string, content: unknown) {
    try {
      const res = await fetch(`/api/digest/${data.roundId}/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`save failed (${res.status}) ${text.slice(0, 200)}`);
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
    }
  }

  // modalTarget: 'whole' or a specific section id
  let modalTarget = $state<string | 'whole' | null>(null);

  function openRegen(sectionId: string) { modalTarget = sectionId; }
  function openWholeRegen() { modalTarget = 'whole'; }
  function closeModal() { modalTarget = null; }

  function toggleExcluded(id: string) {
    sectionStates[id] = sectionStates[id] === 'excluded' ? 'default' : 'excluded';
  }
  function toggleLocked(id: string) {
    sectionStates[id] = sectionStates[id] === 'locked' ? 'default' : 'locked';
  }
  function kebabAction(_id: string, action: 'edit' | 'up' | 'down' | 'delete') {
    console.warn('[digest] kebab action not yet wired:', action);
  }

  async function submitRegen(payload: { chips: string[]; instructions: string }) {
    const target = modalTarget;
    modalTarget = null;
    if (!target || (data.stage !== 'refine' && data.stage !== 'finalize')) return;

    const ids: string[] = target === 'whole'
      ? data.sections
          .filter((s) => sectionStates[s.id] !== 'locked' && sectionStates[s.id] !== 'excluded')
          .map((s) => s.id)
      : [target];

    for (const id of ids) {
      lastChips[id] = payload.chips;
      lastInstructions[id] = payload.instructions;
      sectionStates[id] = 'regenerating';
    }

    try {
      const url = target === 'whole'
        ? `/api/digest/${data.roundId}/regenerate`
        : `/api/digest/${data.roundId}/sections/${target}/regenerate`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`regen failed (${res.status}) ${text.slice(0, 200)}`);
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
      for (const id of ids) {
        if (sectionStates[id] === 'regenerating') sectionStates[id] = 'default';
      }
    }
  }

  // -------- Shared ----------
  let errorToast = $state<string | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  function showError(err: unknown) {
    errorToast = err instanceof Error ? err.message : String(err);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (errorToast = null), 5000);
  }

  // -------- Refine derived ----------
  const sectionsList = $derived(
    data.stage === 'refine' || data.stage === 'finalize' ? data.sections : [],
  );
  const excludedCount = $derived(
    sectionsList.filter((s) => sectionStates[s.id] === 'excluded').length,
  );
  const lockedCount = $derived(
    sectionsList.filter((s) => sectionStates[s.id] === 'locked').length,
  );

  const allChecksOk = $derived(
    data.stage === 'prepare' ? data.checks.every((c) => c.optional || c.ok) : false,
  );

  const modalLabel = $derived(
    modalTarget === 'whole'
      ? 'whole draft · all unlocked sections'
      : modalTarget
        ? labelForSection(modalTarget)
        : '',
  );
  const modalPreview = $derived(
    modalTarget === 'whole'
      ? 'All non-locked, non-excluded sections will regenerate in parallel.'
      : modalTarget
        ? previewForSection(modalTarget)
        : '',
  );
  const modalInitialChips = $derived(
    modalTarget && modalTarget !== 'whole' ? lastChips[modalTarget] ?? [] : [],
  );
  const modalInitialInstructions = $derived(
    modalTarget && modalTarget !== 'whole' ? lastInstructions[modalTarget] ?? '' : '',
  );

  function labelForSection(id: string): string {
    const s = sectionsList.find((x) => x.id === id);
    return s ? SECTION_LABELS[s.kind as SectionKind] : '';
  }
  function previewForSection(id: string): string {
    const s = sectionsList.find((x) => x.id === id);
    if (!s) return '';
    const c = s.content as { title?: string; body?: string; items?: unknown[] };
    if (c?.body) return c.body;
    if (Array.isArray(c?.items) && c.items.length) {
      return c.items.slice(0, 3).map((it) => typeof it === 'string' ? it : JSON.stringify(it)).join(' · ');
    }
    return '(empty)';
  }

  // Section order for rendering — preserve DB position order.
  const renderSections = $derived(
    [...sectionsList].sort((a, b) => a.position - b.position),
  );

  // Make sure unknown section kinds don't crash.
  function kindOrFallback(k: string): SectionKind {
    return (SECTION_KINDS as readonly string[]).includes(k) ? (k as SectionKind) : 'flow';
  }
</script>

<svelte:head>
  <title>Digest preview · r-{data.roundId}</title>
</svelte:head>

<div class="dg-page-head">
  <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0 0 4px;">
    music-league-bot · /digest · r-{data.roundId}
  </p>
  <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
    Round digest preview
  </h1>
  <p class="dg-page-sub">
    Generated when voting closed. LLM analysis cached. Export captures the framed area below as one tall PNG, ready to drop into the league chat.
  </p>

  <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
    <label for="dg-round-select" style="font: 600 11px/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-muted);">
      Round
    </label>
    <select
      id="dg-round-select"
      onchange={onRoundChange}
      value={String(data.roundId)}
      style="font: 500 13px/1.2 var(--font-body); padding: 6px 10px; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: var(--r-2); min-width: 280px;"
    >
      {#each roundGroups as lg (lg.leagueId)}
        {#each lg.seasons as sg (sg.seasonId)}
          <optgroup label="{lg.leagueName} · season {sg.seasonNumber}">
            {#each sg.rounds as r (r.id)}
              <option value={String(r.id)}>{roundOptionLabel(r)}</option>
            {/each}
          </optgroup>
        {/each}
      {/each}
    </select>
  </div>
</div>

{#if votingStillOpen}
  <div role="status" style="margin: 12px 0; padding: 10px 14px; background: var(--amber-soft, rgba(255, 184, 0, 0.12)); border: 1px solid var(--amber, #d29400); color: var(--amber, #d29400); border-radius: var(--r-2); font: 600 12px/1.4 var(--font-mono);">
    ! voting still open for r-{data.currentRound.id}{data.currentRound.voting_deadline ? ` · deadline ${data.currentRound.voting_deadline}` : ' · no deadline set'} — digest may change.
  </div>
{/if}

<div class="dg-pipeline" style="margin: 16px 0;">
  {#each PIPELINE as step, i (step.id)}
    {@const s = stepState(i)}
    <button type="button" class="dg-pipe-step is-{s}" disabled={s !== 'active'}>
      <span class="dg-pipe-num">{s === 'done' ? '✓' : i + 1}</span>
      <span>{step.label}</span>
    </button>
    {#if i < PIPELINE.length - 1}
      <span class="dg-pipe-arrow" aria-hidden="true">→</span>
    {/if}
  {/each}
</div>

{#if errorToast}
  <div role="alert" style="margin: 12px 0; padding: 10px 14px; background: var(--ember-soft); border: 1px solid var(--ember); color: var(--ember); border-radius: var(--r-2); font: 600 12px/1.4 var(--font-mono);">
    {errorToast}
  </div>
{/if}

{#if data.stage === 'prepare'}
  <section class="dg-prepare" style="background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
    <header style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;">
      <h2 style="margin: 0; font: 700 16px/1.2 var(--font-body); color: var(--fg);">
        Prepare data · r-{data.roundId}
      </h2>
      <span style="font: 600 11px/1 var(--font-mono); color: {allChecksOk ? 'var(--moss)' : 'var(--amber)'};">
        {allChecksOk ? '✓ all checks passed · ready to draft' : '! checks pending'}
      </span>
    </header>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      {#each data.checks as check (check.name)}
        <div style="display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: baseline; padding: 8px 10px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);">
          <span style="text-align: center; font: 700 14px/1 var(--font-mono); color: {check.ok ? 'var(--moss)' : check.optional ? 'var(--fg-quiet)' : 'var(--amber)'};">
            {check.ok ? '✓' : check.optional ? '–' : '!'}
          </span>
          <span style="font: 500 13px/1.4 var(--font-body); color: {check.optional && !check.ok ? 'var(--fg-quiet)' : 'var(--fg)'};">
            {check.name}{check.count !== undefined ? ` · ${check.count}` : ''}{check.optional && !check.ok ? ' (optional)' : ''}
          </span>
          <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">{check.src}</span>
        </div>
      {/each}
    </div>

    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={rerunPrepare} disabled={preparing || importing}>
        {preparing ? '…' : '↻'} Re-run checks
      </button>
      {#if exportZipChecksFailing}
        <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={importFromCli} disabled={importing || preparing}>
          {importing ? '… running CLI' : '↓'} Import from CLI
        </button>
      {/if}
      <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" disabled style="opacity: 0.5;">
        ↑ Upload export.zip manually
      </button>
      <span style="flex: 1;"></span>
      {#if allChecksOk}
        <button type="button" class="mash-btn mash-btn--primary" onclick={openGenerate} disabled={drafting}>
          {drafting ? '…' : '✎'} Generate draft…
        </button>
      {/if}
    </div>
  </section>
{:else if data.stage === 'refine' || data.stage === 'finalize'}
  <div class="dg-page-actions">
    <button type="button" class="mash-btn mash-btn--secondary" onclick={openWholeRegen} disabled={finalizing}>
      ↻ Regenerate whole draft
    </button>
    <button type="button" class="mash-btn mash-btn--secondary" onclick={openGenerate} disabled={finalizing || drafting}>
      ✎ Regenerate with options…
    </button>
    <div class="dg-fmt-toggle" role="group" aria-label="Export format">
      {#each EXPORT_FORMATS as fmt (fmt.id)}
        <button
          type="button"
          class:is-on={exportFormat === fmt.id}
          onclick={() => (exportFormat = fmt.id)}
          disabled={finalizing || exporting || publishing}
          title={fmt.title}
        >{fmt.label}</button>
      {/each}
    </div>
    {#if exportFormat === 'html'}
      <!-- HTML share: publishes the interactive digest to a public link (sprint-20).
           Separate path from the file-download formats (returns { url }). -->
      <button type="button" class="mash-btn mash-btn--primary" onclick={publishHtml} disabled={publishing || finalizing || exporting}>
        {publishing ? '… publishing' : '🔗 Publish share link'}
      </button>
    {:else if data.stage === 'refine'}
      <button type="button" class="mash-btn mash-btn--primary" onclick={finalizeAndDownload} disabled={finalizing || exporting}>
        {finalizing ? '…' : '↓'} Finalize &amp; export
      </button>
    {:else if data.stage === 'finalize'}
      <button type="button" class="mash-btn mash-btn--primary" onclick={exportOnly} disabled={exporting || finalizing}>
        {exporting ? '…' : '↓'} Export
      </button>
    {/if}
    {#if data.stage === 'finalize'}
      <span style="font: 600 11px/1 var(--font-mono); color: var(--moss);">
        ✓ finalized {data.draft.finalized_at}
      </span>
      <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={unfinalize} disabled={unfinalizing}>
        {unfinalizing ? '…' : '↩'} Unfinalize
      </button>
    {/if}
    <span class="dg-page-actions-spacer"></span>
    <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">
      draft cached · {excludedCount} excluded · {lockedCount} locked
    </span>
  </div>

  <!-- HTML share result (sprint-20). Shows the published public link + a copy
       control after an `html` export. Only while the `html` format is selected. -->
  {#if exportFormat === 'html' && (shareUrl || shareError)}
    {#if shareUrl}
      <div class="dg-share-result" role="status">
        <span class="dg-share-badge">✓ published</span>
        <a class="dg-share-url" href={shareUrl} target="_blank" rel="noopener noreferrer">{shareUrl}</a>
        <button type="button" class="dg-share-copy" onclick={copyShareLink}>
          {copied ? '✓ Copied' : '⧉ Copy link'}
        </button>
        <span class="dg-share-note">public · no login · interactive · re-publishing keeps this link</span>
      </div>
    {:else if shareError}
      <div class="dg-share-result dg-share-result--err" role="alert">
        <span class="dg-share-badge dg-share-badge--err">✕ publish failed</span>
        <span class="dg-share-url">{shareError}</span>
        <button type="button" class="dg-share-copy" onclick={publishHtml} disabled={publishing}>
          {publishing ? '…' : '↻ Retry'}
        </button>
      </div>
    {/if}
  {/if}

  {#if data.stage === 'finalize'}
    <!-- LLM cost — in-app only (sprint-15 cost-display). Lives OUTSIDE .dg-export
         (the PNG screenshots that element, so this is auto-excluded) AND carries
         data-export-hide="1" so the full-page PDF render hides it too. The
         recipient of the shared artifact never sees the cost. -->
    <div class="dg-cost-banner" data-export-hide="1">
      <span class="dg-cost-tag">llm cost</span>
      <span class="dg-cost-amt">${(data.draft.llm_cost_usd ?? 0).toFixed(4)}</span>
      <span class="dg-cost-note">in-app only · excluded from the shared export</span>
    </div>
  {/if}

  <div class="dg-export dgC-bg" class:dg-export--mobile={isMobileExport}>
    <header class="dgC-mast">
      <div class="dgC-mast-row1" data-export-hide="1">
        <span>m/l</span>
        <span class="sep">/</span>
        <span>r-{data.roundId}</span>
        <span class="sep">/</span>
        <span class="pulp">generated {data.draft.generated_at}</span>
      </div>
      <h1 class="dgC-mast-title">{recap ? (recap.final ? `Season recap · ${recap.seasonLabel}` : `Season recap so far · through R${recap.throughRound}`) : 'Round digest'}</h1>
      <p class="dgC-mast-deck" data-export-hide="1">
        {data.sections.length} sections · whole-regen count {data.draft.whole_regen_count}
      </p>
    </header>

    <!-- By-the-numbers stat strip (sprint-17) — synthetic data-driven section,
         near the top. Reads data.stats; self-suppresses when empty. -->
    {#if showStats && StatSlot}
      <div class="dg-section-wrap" data-section-kind="stats">
        <section class="dg-section">
          <p class="dg-section-eyebrow">{recap ? 'By the numbers · season' : 'By the numbers'}</p>
          <StatSlot kind="stats" content={{}} data={statsData} variant="visual" />
        </section>
      </div>
    {/if}

    {#each renderSections as section (section.id)}
      <DigestSection
        kind={kindOrFallback(section.kind)}
        label={SECTION_LABELS[kindOrFallback(section.kind)]}
        sectionState={sectionStates[section.id] ?? 'default'}
        content={section.content}
        variant={effectiveSectionVariant(section.kind, section.id, section.variant)}
        visualComponent={VISUAL_COMPONENTS[kindOrFallback(section.kind)]}
        onToggleExcluded={() => toggleExcluded(section.id)}
        onToggleLocked={() => toggleLocked(section.id)}
        onRegen={() => openRegen(section.id)}
        onVariantChange={(v) => changeVariant(section.id, v)}
        onEditSave={(content) => saveInlineEdit(section.id, content)}
        onKebabAction={(action) => kebabAction(section.id, action)}
      />
    {/each}

    <!-- Synthetic, data-driven standings section (sprint-15 standings-wire).
         NOT an LLM/DB section — it reads the Standings payload (data.standings)
         and mounts viz's StandingsChart via the registry. Lives inside .dg-export
         so it renders in the web view AND the PDF/PNG export; carries
         data-section-kind="standings" so png-per-section picks it up. -->
    {#if showStandings && StandingsSlot}
      <div class="dg-section-wrap" data-section-kind="standings">
        <section class="dg-section">
          <div class="dg-standings-head">
            <p class="dg-section-eyebrow" style="margin: 0;">{recap ? (recap.final ? `Final standings${recap.champion ? ` · Champion: ${recap.champion}` : ''}` : `Standings through R${recap.throughRound}`) : 'Season standings'}</p>
            <button
              type="button"
              class="dg-standings-edit"
              data-export-hide="1"
              onclick={() => (editTableOpen = true)}
              title="Edit the gospel standings figures"
            >✎ edit figures</button>
          </div>
          <StandingsSlot kind="standings" content={{}} data={standingsData} variant="visual" />
        </section>
      </div>
    {/if}

    <!-- Tastemaker section (discoverability v2, sprint-18) — replaces the v1
         leaderboard. Reads data.discoverability (TastemakerPayload); the component
         self-suppresses on null/empty and renders its static fallback in the
         export path (?export=1). Lives inside .dg-export → web + PNG export. -->
    {#if showDiscoverability && DiscoverabilitySlot}
      <div class="dg-section-wrap" data-section-kind="discoverability">
        <section class="dg-section">
          <p class="dg-section-eyebrow">{recap ? (recap.final ? 'Tastemaker · final season' : 'Tastemaker · season so far') : 'Tastemaker'}</p>
          <DiscoverabilitySlot kind="discoverability" content={{}} data={discoverabilityData} variant="visual" />
        </section>
      </div>
    {/if}

    <!-- Next-round preview (sprint-25 next-round-edit): wrapped in NextRoundSection
         for persistent exclude + inline theme/deadline override editing. -->
    {#if showNextRound}
      <NextRoundSection
        roundId={data.roundId}
        data={nextRoundData ?? null}
        initialExcluded={nextRoundExcluded}
        hasOverride={nextRoundHasOverride}
        onExcludedChange={(v) => { nextRoundExcluded = v; }}
      />
    {/if}

    <footer class="dgC-foot">
      <div>m/l · liner notes · r-{data.roundId}</div>
      <div>generated {data.draft.generated_at}{data.draft.finalized_at ? ` · finalized ${data.draft.finalized_at}` : ''}</div>
    </footer>
  </div>

  {#if relDiff}
    <div class="dg-relctx-footer">
      <span class="dg-relctx-tag">rel context updated</span>
      <button type="button" class="dg-relctx-link" onclick={openRelDiff}>view diff →</button>
    </div>
  {/if}
{/if}

{#if genModalOpen}
  <GenerateModal
    sectionLabels={SECTION_LABELS}
    busy={drafting}
    {statsAvailability}
    {standingsAvailability}
    {nextRoundAvailability}
    {tastemakerCoverage}
    onCancel={closeGenerate}
    onSubmit={submitGenerate}
  />
{/if}

{#if showReconcile && reconcileData}
  <ReconciliationModal
    roundId={data.roundId}
    reconcile={reconcileData}
    onClose={() => (reconcileData = null)}
    onAdopted={(result) => { applyStandings(result); reconcileData = null; }}
    onError={(msg) => showError(msg)}
  />
{/if}

<EditableStandingsTable
  roundId={data.roundId}
  open={editTableOpen}
  initial={standingsData as StandingsResult | null}
  onClose={() => (editTableOpen = false)}
  onSaved={(result) => applyStandings(result)}
/>

{#if modalTarget !== null}
  <RegenModal
    sectionLabel={modalLabel}
    sectionPreview={modalPreview}
    initialChips={modalInitialChips}
    initialInstructions={modalInitialInstructions}
    onCancel={closeModal}
    onSubmit={submitRegen}
  />
{/if}

{#if relDiffOpen && relDiff}
  <RelContextDiffModal
    previous={relDiff.previous}
    proposed={relDiff.proposed}
    leagueId={relDiff.leagueId}
    onClose={closeRelDiff}
    onSaved={async (newContext) => {
      relContextFromFinalize = null;
      relDiffOpen = false;
      await invalidateAll();
      showError(`rel context saved (${newContext.length} chars)`);
    }}
    onPatchError={(msg) => showError(msg)}
  />
{/if}

<style>
  .dg-fmt-toggle {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .dg-fmt-toggle button {
    background: var(--surface);
    border: 0;
    padding: 7px 11px;
    font: 600 11px/1 var(--font-mono);
    color: var(--fg-muted);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .dg-fmt-toggle button + button {
    border-left: 1px solid var(--line);
  }
  .dg-fmt-toggle button:hover:not(:disabled) {
    color: var(--fg);
  }
  .dg-fmt-toggle button.is-on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
  }
  .dg-fmt-toggle button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  /* HTML share-link result (sprint-20) */
  .dg-share-result {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin: 10px 0 0;
    padding: 9px 14px;
    background: var(--mash-pulp-soft);
    border: 1px solid var(--mash-pulp-edge, var(--line-strong));
    border-radius: var(--r-2);
  }
  .dg-share-result--err {
    background: var(--surface);
    border-color: var(--line-strong);
  }
  .dg-share-badge {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--mash-pulp);
    white-space: nowrap;
  }
  .dg-share-badge--err {
    color: var(--rust, #e0533a);
  }
  .dg-share-url {
    font: 600 12px/1.3 var(--font-mono);
    color: var(--fg);
    text-decoration: none;
    word-break: break-all;
    flex: 1 1 220px;
    min-width: 0;
  }
  a.dg-share-url:hover {
    color: var(--mash-pulp);
    text-decoration: underline;
  }
  .dg-share-copy {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    color: var(--fg);
    cursor: pointer;
    padding: 6px 11px;
    font: 600 11px/1 var(--font-mono);
    white-space: nowrap;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .dg-share-copy:hover:not(:disabled) {
    color: var(--mash-pulp);
    border-color: var(--mash-pulp);
  }
  .dg-share-copy:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .dg-share-note {
    font: 500 10px/1.4 var(--font-mono);
    color: var(--fg-quiet);
    flex: 1 1 100%; /* own line — never clips on narrow phones */
  }

  .dg-standings-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .dg-standings-edit {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    color: var(--fg-muted);
    cursor: pointer;
    padding: 4px 9px;
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
  }
  .dg-standings-edit:hover { color: var(--fg); border-color: var(--mash-pulp); }

  .dg-cost-banner {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 0 10px;
    padding: 8px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
  }
  .dg-cost-tag {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .dg-cost-amt {
    font: 700 14px/1 var(--font-mono);
    color: var(--mash-pulp);
  }
  .dg-cost-note {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .dg-relctx-footer {
    margin-top: 16px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    display: flex;
    align-items: center;
    gap: 10px;
    font: 600 11px/1 var(--font-mono);
  }
  .dg-relctx-tag {
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--moss, #7ea864);
  }
  .dg-relctx-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--mash-pulp, var(--fg));
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    font: inherit;
  }
  .dg-relctx-link:hover { color: var(--fg); }
</style>
