#!/usr/bin/env node
/**
 * Generate a single-file HTML rating tool from the league DB.
 * Output: tools/theme-rating-tool.html.
 *
 * Bakes ALL rounds with their songs + vote totals into the HTML as a JSON
 * blob. The page lets you pick league → season → round, view the songs and
 * scores, rate the theme thumbs up/down/meh + free-text comment, and export
 * everything as CSV.
 */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB = process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db');
const OUT = resolve(REPO_ROOT, 'tools/theme-rating-tool.html');

const db = new Database(DB, { readonly: true });

const leagues = db.prepare('SELECT id, slug, name FROM leagues ORDER BY name').all();

const data = leagues.map((l) => {
	const seasons = db
		.prepare('SELECT id, season_number, status FROM seasons WHERE league_id = ? ORDER BY season_number')
		.all(l.id)
		.map((s) => {
			const rounds = db
				.prepare(
					`SELECT id, name, description, spotify_playlist_url, submission_deadline, voting_deadline
					 FROM rounds WHERE season_id = ? ORDER BY id`
				)
				.all(s.id)
				.map((r, idx) => {
					const submissions = db
						.prepare(
							`SELECT s.spotify_uri, s.title, s.artists, s.album, s.comment,
							        c.name AS submitter,
							        COALESCE((SELECT SUM(points) FROM votes v WHERE v.round_id = s.round_id AND v.spotify_uri = s.spotify_uri), 0) AS total_votes
							 FROM ml_submissions s
							 LEFT JOIN competitors c ON c.id = s.competitor_id
							 WHERE s.round_id = ?
							 ORDER BY total_votes DESC, s.title`
						)
						.all(r.id);
					return {
						idx: idx + 1,
						name: r.name || '(no theme)',
						description: r.description || '',
						submission_deadline: r.submission_deadline,
						voting_deadline: r.voting_deadline,
						playlist: r.spotify_playlist_url,
						songs: submissions
					};
				});
			return {
				season_number: s.season_number,
				status: s.status,
				rounds
			};
		});
	return { slug: l.slug, name: l.name, seasons };
});

const json = JSON.stringify(data);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Music League — Theme Rating Tool</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 1.5rem; max-width: 960px; background: #0f1116; color: #e6e8eb; }
    h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
    .meta { color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem; }
    .picker { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.75rem; background: #1a1f2b; border-radius: 6px; }
    .picker label { display: flex; flex-direction: column; font-size: 0.75rem; color: #94a3b8; }
    select, button, input, textarea { font: inherit; background: #232938; color: #e6e8eb; border: 1px solid #334155; border-radius: 4px; padding: 0.4rem 0.6rem; }
    button { cursor: pointer; }
    button:hover { background: #2d3548; }
    button.active { background: #3b82f6; border-color: #3b82f6; }
    .theme-card { background: #1a1f2b; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .theme-title { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.25rem; }
    .theme-desc { color: #cbd5e1; white-space: pre-wrap; margin: 0.25rem 0 0.75rem; }
    .deadlines { font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.75rem; }
    .rating { display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0 0.75rem; }
    .rating button { font-size: 1.2rem; padding: 0.3rem 0.7rem; }
    textarea { width: 100%; min-height: 60px; resize: vertical; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #232938; vertical-align: top; }
    th { font-size: 0.7rem; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
    td.votes { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .toolbar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
    .toolbar .spacer { flex: 1; }
    .progress { font-size: 0.85rem; color: #94a3b8; }
    a { color: #93c5fd; }
    .empty { color: #94a3b8; font-style: italic; padding: 2rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Music League · Theme Rating</h1>
  <div class="meta">Pick a league → season → round, eyeball the songs &amp; scores, then thumbs the theme. Ratings save in your browser. <button id="export">Export CSV</button> <button id="reset">Reset all</button> <span class="progress" id="progress"></span></div>

  <div class="picker">
    <label>League <select id="leagueSel"></select></label>
    <label>Season <select id="seasonSel"></select></label>
    <label>Round <select id="roundSel"></select></label>
  </div>

  <div id="content"></div>

<script>
const DATA = ${json};
const STORAGE_KEY = 'mlb-theme-ratings-v1';
let ratings = loadRatings();

const leagueSel = document.getElementById('leagueSel');
const seasonSel = document.getElementById('seasonSel');
const roundSel  = document.getElementById('roundSel');
const content   = document.getElementById('content');
const progress  = document.getElementById('progress');

function loadRatings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function saveRatings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  updateProgress();
}
function key(leagueSlug, season, round) {
  return leagueSlug + '|' + season + '|' + round;
}
function getRating(leagueSlug, season, round) {
  return ratings[key(leagueSlug, season, round)] || { rating: '', comment: '' };
}
function setRating(leagueSlug, season, round, partial) {
  const k = key(leagueSlug, season, round);
  const existing = ratings[k] || { rating: '', comment: '' };
  ratings[k] = { ...existing, ...partial };
  saveRatings();
}

function updateProgress() {
  const total = DATA.reduce((acc, l) =>
    acc + l.seasons.reduce((a, s) => a + s.rounds.length, 0), 0);
  const rated = Object.values(ratings).filter(r => r.rating).length;
  progress.textContent = rated + ' / ' + total + ' themes rated';
}

function fillSelect(sel, options, getValue, getLabel) {
  sel.innerHTML = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = getValue(o);
    opt.textContent = getLabel(o);
    sel.appendChild(opt);
  }
}

function renderLeagues() {
  fillSelect(leagueSel, DATA, l => l.slug, l => l.name + ' (' + l.seasons.length + ' season' + (l.seasons.length === 1 ? '' : 's') + ')');
  renderSeasons();
}

function currentLeague() { return DATA.find(l => l.slug === leagueSel.value); }
function currentSeason() {
  const l = currentLeague();
  return l && l.seasons.find(s => String(s.season_number) === seasonSel.value);
}
function currentRound() {
  const s = currentSeason();
  return s && s.rounds.find(r => String(r.idx) === roundSel.value);
}

function renderSeasons() {
  const l = currentLeague();
  if (!l) return;
  fillSelect(seasonSel, l.seasons, s => s.season_number,
    s => 'Season ' + s.season_number + ' (' + s.status + ', ' + s.rounds.length + ' rounds)');
  renderRounds();
}

function renderRounds() {
  const s = currentSeason();
  if (!s) return;
  fillSelect(roundSel, s.rounds, r => r.idx, r => '#' + r.idx + ' — ' + r.name);
  renderContent();
}

function renderContent() {
  const l = currentLeague();
  const s = currentSeason();
  const r = currentRound();
  if (!r) {
    content.innerHTML = '<div class="empty">No rounds in this season.</div>';
    return;
  }
  const existing = getRating(l.slug, s.season_number, r.idx);

  const ratingButtons = ['up', 'meh', 'down'].map(opt => {
    const label = opt === 'up' ? '👍 up' : opt === 'down' ? '👎 down' : '🤷 meh';
    const active = existing.rating === opt ? 'active' : '';
    return '<button class="' + active + '" data-rate="' + opt + '">' + label + '</button>';
  }).join(' ');

  const songRows = r.songs.length === 0
    ? '<tr><td colspan="4" class="empty">No songs recorded for this round.</td></tr>'
    : r.songs.map(song => {
        const artists = song.artists || '';
        const submitter = song.submitter || '(anon)';
        return '<tr>' +
          '<td class="votes">' + song.total_votes + '</td>' +
          '<td><strong>' + escapeHtml(song.title) + '</strong>' +
            (song.album ? '<br /><span style="color:#94a3b8;font-size:0.75rem">' + escapeHtml(song.album) + '</span>' : '') +
          '</td>' +
          '<td>' + escapeHtml(artists) + '</td>' +
          '<td>' + escapeHtml(submitter) + '</td>' +
          '</tr>';
      }).join('');

  content.innerHTML = '' +
    '<div class="theme-card">' +
      '<div class="theme-title">Round ' + r.idx + ' — ' + escapeHtml(r.name) + '</div>' +
      (r.description ? '<div class="theme-desc">' + escapeHtml(r.description) + '</div>' : '') +
      '<div class="deadlines">' +
        (r.submission_deadline ? 'songs due ' + r.submission_deadline + ' &nbsp;·&nbsp; ' : '') +
        (r.voting_deadline ? 'votes due ' + r.voting_deadline : '') +
        (r.playlist ? ' &nbsp;·&nbsp; <a target="_blank" href="' + r.playlist + '">spotify playlist</a>' : '') +
      '</div>' +
      '<div class="rating">' +
        '<strong style="margin-right: 0.5rem">Theme rating:</strong>' +
        ratingButtons +
      '</div>' +
      '<textarea id="commentBox" placeholder="Optional thoughts on this theme...">' + escapeHtml(existing.comment || '') + '</textarea>' +
      '<table><thead><tr><th>Votes</th><th>Song</th><th>Artist</th><th>Submitter</th></tr></thead><tbody>' +
        songRows +
      '</tbody></table>' +
    '</div>';

  // Wire buttons
  content.querySelectorAll('button[data-rate]').forEach(b => {
    b.addEventListener('click', () => {
      const newRating = b.getAttribute('data-rate');
      setRating(l.slug, s.season_number, r.idx, { rating: newRating });
      renderContent();
    });
  });
  document.getElementById('commentBox').addEventListener('input', (e) => {
    setRating(l.slug, s.season_number, r.idx, { comment: e.target.value });
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('export').addEventListener('click', () => {
  const rows = [['league', 'season', 'round_number', 'theme_name', 'rating', 'comment']];
  for (const l of DATA) {
    for (const s of l.seasons) {
      for (const r of s.rounds) {
        const k = key(l.slug, s.season_number, r.idx);
        const rec = ratings[k] || { rating: '', comment: '' };
        rows.push([l.name, s.season_number, r.idx, r.name, rec.rating, rec.comment]);
      }
    }
  }
  const csv = rows.map(row => row.map(field => {
    const s = field == null ? '' : String(field);
    return /[,"\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = 'theme-ratings-' + now + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('reset').addEventListener('click', () => {
  if (confirm('Clear all ratings and comments? (Browser storage only — does not affect CSV exports already saved.)')) {
    ratings = {};
    saveRatings();
    renderContent();
  }
});

leagueSel.addEventListener('change', renderSeasons);
seasonSel.addEventListener('change', renderRounds);
roundSel.addEventListener('change', renderContent);

renderLeagues();
updateProgress();
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log('Wrote ' + OUT + ' (' + (html.length / 1024).toFixed(1) + ' KB)');
