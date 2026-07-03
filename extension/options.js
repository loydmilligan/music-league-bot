const DEFAULT_BASE_URL = 'https://mlb37.mattmariani.com';

const baseEl = document.getElementById('base');
const tokenEl = document.getElementById('token');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');
const tokenLink = document.getElementById('tokenLink');

init();

async function init() {
  const { apiBaseUrl, token } = await chrome.storage.local.get(['apiBaseUrl', 'token']);
  baseEl.value = apiBaseUrl || '';
  tokenEl.value = token || '';
  updateTokenLink();
  baseEl.addEventListener('input', updateTokenLink);

  saveBtn.addEventListener('click', save);
  testBtn.addEventListener('click', test);
}

function currentBase() {
  return (baseEl.value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function updateTokenLink() {
  tokenLink.href = `${currentBase()}/settings/api-tokens`;
}

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ` ${kind}` : '');
}

async function save() {
  const apiBaseUrl = currentBase();
  const token = tokenEl.value.trim();
  await chrome.storage.local.set({ apiBaseUrl, token });
  setStatus('Saved.', 'ok');
}

async function test() {
  const apiBaseUrl = currentBase();
  const token = tokenEl.value.trim();
  if (!token) {
    setStatus('Enter a token first.', 'err');
    return;
  }
  testBtn.disabled = true;
  setStatus('Testing…');
  try {
    const res = await fetch(`${apiBaseUrl}/api/ingest/songs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ urls: [] })
    });
    if (res.status === 200) {
      setStatus(`OK — connected to ${apiBaseUrl}`, 'ok');
    } else if (res.status === 401) {
      setStatus('401 — token rejected.', 'err');
    } else {
      setStatus(`HTTP ${res.status} — unexpected response.`, 'err');
    }
  } catch (err) {
    setStatus(`Network error: ${err && err.message ? err.message : String(err)}`, 'err');
  } finally {
    testBtn.disabled = false;
  }
}
