// MV3 service worker. Handles ingest POSTs on behalf of the popup so the
// network call survives popup close and so we centralize header/auth logic.

const DEFAULT_BASE_URL = 'https://mlb.mattmariani.com';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ingest') {
    handleIngest(msg.urls).then(sendResponse);
    return true; // keep the message channel open for async sendResponse
  }
  return false;
});

async function handleIngest(urls) {
  if (!Array.isArray(urls)) {
    return { error: 'urls must be an array' };
  }

  const { apiBaseUrl, token } = await chrome.storage.local.get(['apiBaseUrl', 'token']);
  const base = (apiBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

  if (!token) {
    return { error: 'No token configured. Open extension options to set one.' };
  }

  let res;
  try {
    res = await fetch(`${base}/api/ingest/songs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ urls })
    });
  } catch (err) {
    return { error: `Network error: ${err && err.message ? err.message : String(err)}` };
  }

  if (res.status === 401) {
    return { status: 401, message: 'Token rejected — check options' };
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { status: res.status, error: `Bad response (${res.status}): not JSON` };
  }

  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `HTTP ${res.status}`;
    return { status: res.status, error: msg };
  }

  return { status: 200, body };
}
