#!/usr/bin/env node
/**
 * Seed / re-seed theme property-tags for existing rounds (sprint-22 theme-tagging).
 *
 * This is the DOCUMENTED way to add or edit theme tags. It is a manual,
 * hand-authored pass (NO LLM) keyed by round id, driving the live theme-tags
 * API (db/themeTags.ts). It is idempotent — each round's tag set is REPLACED on
 * every run (PUT semantics), so re-running after an edit converges.
 *
 *   HOW TO ADD / EDIT TAGS LATER:
 *     1. Edit ROUND_TAGS below (key = round id; value = ["category:value", ...]).
 *        Unknown (category,value) pairs are auto-created in the vocabulary;
 *        unknown categories are auto-created too (taxonomy is extensible).
 *        Categories in use: semantic · musicality · energy-feel · instrument · artist.
 *     2. Run:  node scripts/seed-theme-tags.mjs [baseUrl]
 *        baseUrl defaults to the prod box. Examples:
 *          node scripts/seed-theme-tags.mjs                       # → prod
 *          node scripts/seed-theme-tags.mjs http://localhost:5173 # → a dev server
 *     3. To tag a NEW round, add its id + tags here and re-run (only that round
 *        changes; others are replaced with their same set = no-op).
 *
 * Round ids are stable PKs from the league DB. Names are in comments for editing.
 * To add a brand-new ad-hoc tag to a single round without a full replace, the
 * API also supports POST /api/rounds/:id/tags {category,value} and
 * DELETE /api/rounds/:id/tags/:tagId.
 */

const BASE = (process.argv[2] ?? 'http://192.168.4.217:3002').replace(/\/$/, '');

// id → ["category:value", ...].  category ∈ {semantic, musicality, energy-feel, instrument, artist}
const ROUND_TAGS = {
  // ── Fam-Jam ───────────────────────────────────────────────────────────────
  1:   ['semantic:live-music', 'semantic:performance'],                       // Show Off (seen live)
  4:   ['semantic:nostalgia', 'semantic:teenage'],                            // It's Not a Phase!
  6:   ['semantic:weather'],                                                  // Weatherbug
  8:   ['semantic:guilty-pleasure', 'semantic:surprise'],                     // Surprise!
  10:  ['semantic:place', 'semantic:hometown'],                               // Hometown Hero
  12:  ['energy-feel:hype', 'semantic:motivation'],                           // Get Pumped
  14:  ['semantic:recent-release', 'artist:recent'],                          // No Vault Shit (2021+)
  16:  ['semantic:sing-along', 'energy-feel:uplifting'],                      // Shower Power
  18:  ['semantic:food'],                                                     // Feast For Your Ears
  20:  ['semantic:soundtrack', 'semantic:movies', 'musicality:instrumental'], // Scorekeepers (movie score)
  22:  ['semantic:deep-cut', 'semantic:discovery'],                           // Deep Cuts
  25:  ['semantic:cars'],                                                     // Get In Gear
  27:  ['semantic:heartbreak', 'energy-feel:melancholy'],                     // Broken Hearts Club
  29:  ['semantic:nostalgia', 'artist:specific-era'],                         // Respect Your Elders (60s/70s)
  31:  ['musicality:bass-heavy', 'instrument:bass'],                          // Unsung Heroes (basslines)
  33:  ['semantic:storytelling'],                                             // Plots So Thicc
  35:  ['semantic:guilty-pleasure'],                                          // Saved For The Headphones
  37:  ['semantic:enemy', 'energy-feel:angry'],                               // They Deserve A Slap
  39:  ['semantic:non-english'],                                              // Nada de Ingles
  41:  ['energy-feel:dance', 'energy-feel:hype'],                             // ants-in-pants (makes you dance)
  43:  ['semantic:birth-year', 'semantic:nostalgia'],                         // What's My Age Again?
  45:  ['semantic:men', 'artist:male-artist'],                                // Boyyyy Powerrr
  47:  ['semantic:short-song'],                                               // I'm a 2th (≤2 min)
  50:  ['energy-feel:chill', 'semantic:calming', 'semantic:travel'],          // Flying High (doze off on plane)
  52:  ['semantic:duet', 'artist:collaboration'],                            // Twofer (duets)
  54:  ['semantic:current-favorite'],                                         // My Current Jam
  56:  ['artist:non-american'],                                               // The Import Market
  58:  ['semantic:memory', 'semantic:nostalgia'],                             // Permanent Record (specific moment)
  60:  ['semantic:soundtrack', 'semantic:movies'],                            // OST-erity Measures
  100: ['semantic:problematic-artist', 'artist:controversial'],              // Bangers by Trash
  101: ['semantic:self-anthem'],                                              // Did I Make Myself Clear? (your theme song)
  118: ['energy-feel:dance', 'energy-feel:hype'],                             // PRACTICE: Dance like no one's listening
  119: ['artist:cover'],                                                      // They covered that?
  120: ['energy-feel:hype', 'semantic:motivation', 'semantic:workout'],       // Pick Me Up
  121: ['musicality:electronic', 'musicality:remix'],                         // EDM 'em
  122: ['semantic:travel', 'semantic:road-trip', 'energy-feel:hype'],         // Windows Down, Volume Up
  123: ['musicality:instrumental'],                                           // Speechless (instrumental)
  124: ['energy-feel:hype', 'semantic:confidence'],                           // Beats That Don't Taste Like Dirt
  125: ['semantic:partner', 'semantic:love', 'energy-feel:romantic'],         // Favorite Song about my Favorite Person
  126: ['energy-feel:chill', 'semantic:calming'],                            // DJ Ben Zo (lowers blood pressure)
  127: ['semantic:defend-taste', 'semantic:guilty-pleasure'],                // Don't Stan So Close To Me
  128: ['energy-feel:melancholy', 'semantic:self-pity', 'semantic:sad'],      // Crylight Reel
  129: ['semantic:discovery', 'semantic:meta'],                               // Finding the Muse in Music League

  // ── Hip-Jammers ───────────────────────────────────────────────────────────
  62:  ['semantic:guilty-pleasure', 'energy-feel:dance'],                     // Dance IF nobody's watching
  63:  ['semantic:movies'],                                                   // Movie Stars
  64:  ['artist:one-hit-wonder'],                                             // Hit then quit it
  65:  ['semantic:emo', 'artist:specific-era', 'energy-feel:melancholy'],     // Finding Emos (early 2000s)
  66:  ['semantic:humor'],                                                    // I like big butts (wrong lyrics)
  67:  ['semantic:anti-favorite'],                                            // Turn that Sh!# down
  68:  ['semantic:nostalgia', 'semantic:graduation'],                         // Most likely to (graduation year)
  69:  ['semantic:non-english'],                                              // Nada de ingles
  70:  ['semantic:anti-favorite'],                                            // Eh for effort (wish you liked)
  71:  ['semantic:tv'],                                                       // Primetime (TV shows)
  74:  ['semantic:numbers'],                                                  // Easy as 1,2,3 (numbers in title)
  76:  ['artist:side-project'],                                               // The Side Quest
  83:  ['semantic:place'],                                                    // Geography Discography (city/state)
  85:  ['semantic:video-game', 'instrument:guitar', 'musicality:rock'],       // Shred Dead Redemption (Guitar Hero)
  87:  ['musicality:instrumental'],                                           // Speechless (instrumental)
  89:  ['artist:specific-artist'],                                            // Any from the block (J-Lo related)
  91:  ['artist:cover', 'semantic:parody'],                                   // Copy, Right?
  93:  ['musicality:intro-driven'],                                           // Let's Get it Started (best intro)
  95:  ['energy-feel:hype', 'semantic:motivation'],                           // Just My Hype
  102: ['semantic:memory', 'semantic:nostalgia'],                             // Your Permanent Record
  103: ['semantic:love', 'energy-feel:romantic'],                             // Must be love on the brain
  104: ['semantic:school'],                                                   // Department of Education
  105: ['energy-feel:hype', 'semantic:workout', 'semantic:motivation'],       // Pump Up The Sasha (walk-up)
  106: ['semantic:storytelling'],                                             // Plots so thicc
  107: ['energy-feel:dance', 'energy-feel:hype'],                             // ants-in-pants (dance/air drums)
  108: ['semantic:karaoke', 'semantic:sing-along'],                           // Don't Make Me Sing (karaoke)
  116: ['semantic:animals'],                                                  // Wild Thing
  117: ['semantic:discovery', 'semantic:obscure'],                            // Listen To This (no one's heard)

  // ── Nostalgia Pit (active — punk artist rounds) ───────────────────────────
  113: ['artist:specific-artist', 'semantic:punk', 'musicality:punk'],        // Lagwagon
  114: ['artist:specific-artist', 'semantic:punk', 'musicality:punk'],        // Strung Out
  115: ['artist:specific-artist', 'semantic:punk', 'musicality:punk'],        // NoFX
};

function parseTags(list) {
  return list.map(s => {
    const i = s.indexOf(':');
    if (i < 0) throw new Error(`bad tag "${s}" (want "category:value")`);
    return { category: s.slice(0, i), value: s.slice(i + 1) };
  });
}

async function main() {
  const ids = Object.keys(ROUND_TAGS).map(Number);
  let ok = 0, failed = 0, totalTags = 0;
  for (const id of ids) {
    const tags = parseTags(ROUND_TAGS[id]);
    try {
      const res = await fetch(`${BASE}/api/rounds/${id}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) { failed++; console.error(`✗ round ${id}: HTTP ${res.status} ${await res.text()}`); continue; }
      const body = await res.json();
      ok++; totalTags += body.tags.length;
      console.log(`✓ round ${id}: ${body.tags.map(t => `${t.category}:${t.value}`).join(', ')}`);
    } catch (e) {
      failed++; console.error(`✗ round ${id}: ${e.message}`);
    }
  }
  console.log(`\nDONE — ${ok}/${ids.length} rounds tagged (${failed} failed), ${totalTags} tag-attachments total.`);
  if (failed) process.exit(1);
}

main();
