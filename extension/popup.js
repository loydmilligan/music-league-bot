const loadingEl = document.getElementById('loading');
const unconfiguredEl = document.getElementById('unconfigured');
const notSpotifyEl = document.getElementById('notSpotify');
const detectedEl = document.getElementById('detected');
const kindBadge = document.getElementById('kindBadge');
const titleEl = document.getElementById('title');
const subEl = document.getElementById('sub');
const addBtn = document.getElementById('addBtn');
const resultEl = document.getElementById('result');
const optsBtn = document.getElementById('optsBtn');
const openOptsLink = document.getElementById('openOpts');

let currentDetected = null;

optsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
openOptsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();

async function init() {
  const { token } = await chrome.storage.local.get(['token']);
  if (!token) {
    show(unconfiguredEl);
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https:\/\/(open\.spotify\.com|music\.youtube\.com)\//.test(tab.url)) {
    show(notSpotifyEl);
    return;
  }

  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'detect' });
  } catch (err) {
    // Content script not present (page may have been opened before extension
    // install, or detection ran before document_idle).
    show(notSpotifyEl);
    notSpotifyEl.innerHTML =
      'Page loaded before the extension was ready.<br />Reload the tab and try again.';
    return;
  }

  if (!resp || !resp.ok) {
    show(notSpotifyEl);
    return;
  }

  currentDetected = resp;
  renderDetected(resp);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function show(el) {
  for (const node of [loadingEl, unconfiguredEl, notSpotifyEl, detectedEl]) {
    node.classList.add('hidden');
  }
  el.classList.remove('hidden');
}

function renderDetected(r) {
  kindBadge.textContent = r.kind;
  kindBadge.className = `badge kind-${r.kind}`;
  titleEl.textContent = r.title || '(untitled)';
  const subParts = [];
  if (r.artist) subParts.push(r.artist);
  if (typeof r.count === 'number') {
    subParts.push(`${r.count} ${r.count === 1 ? 'song' : 'songs'}`);
  }
  subEl.textContent = subParts.join(' · ');
  resultEl.classList.add('hidden');
  resultEl.className = 'result hidden';
  addBtn.disabled = false;
  addBtn.textContent = 'Add to shortlist';
  show(detectedEl);
}

addBtn.addEventListener('click', onAdd);

async function onAdd() {
  if (!currentDetected) return;
  addBtn.disabled = true;
  addBtn.innerHTML = '<span class="spinner"></span>Adding…';
  resultEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({
    type: 'ingest',
    urls: [currentDetected.url]
  });

  renderResult(response);
}

function renderResult(response) {
  resultEl.classList.remove('hidden');
  addBtn.disabled = false;
  addBtn.textContent = 'Add to shortlist';

  if (!response) {
    resultEl.className = 'result err';
    resultEl.textContent = 'No response from background worker.';
    return;
  }
  if (response.status === 401 || (response.error && /401/.test(String(response.error)))) {
    resultEl.className = 'result err';
    resultEl.innerHTML =
      (response.message || response.error || 'Token rejected.') +
      ' <a id="errOpts" style="color:inherit; text-decoration: underline; cursor:pointer">Open options</a>';
    const link = document.getElementById('errOpts');
    if (link) link.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }
  if (response.error) {
    resultEl.className = 'result err';
    resultEl.textContent = response.error;
    return;
  }

  const body = response.body || {};
  const added = Array.isArray(body.added) ? body.added : [];
  const failed = Array.isArray(body.failed) ? body.failed : [];

  // Bucket failures: "already in shortlist" is a benign dedup, the rest are real errors.
  let dedupCount = 0;
  const errFailures = [];
  for (const f of failed) {
    if (f && /already in shortlist/i.test(f.reason || '')) dedupCount++;
    else errFailures.push(f);
  }

  const cls = errFailures.length > 0 && added.length === 0 ? 'err' : 'ok';
  resultEl.className = `result ${cls}`;

  const lines = [];
  const noun = added.length === 1 ? 'track' : 'tracks';
  lines.push(`<div><strong>Added ${added.length} ${noun}</strong>${dedupCount > 0 ? ` · Skipped ${dedupCount} (already in shortlist)` : ''}</div>`);

  if (added.length > 0) {
    const preview = added.slice(0, 3);
    const ul = preview
      .map((a) => {
        const t = escapeHtml(a.title || '(unknown)');
        const ar = a.artist ? ` — ${escapeHtml(a.artist)}` : '';
        return `<li>${t}${ar}</li>`;
      })
      .join('');
    lines.push(`<ul>${ul}</ul>`);
    if (added.length > preview.length) {
      lines.push(`<div class="more">+ ${added.length - preview.length} more</div>`);
    }
  }

  if (errFailures.length > 0) {
    const ul = errFailures
      .slice(0, 3)
      .map((f) => `<li>${escapeHtml(f.reason || 'unknown error')}</li>`)
      .join('');
    lines.push(`<div style="margin-top:6px"><strong>Failed:</strong></div><ul>${ul}</ul>`);
  }

  resultEl.innerHTML = lines.join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
