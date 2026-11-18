import { configureImageProxy } from '@stockroom/shared';

// Points at the same Express proxy (server.js) the web app uses, reached
// over the local Wi-Fi network by LAN IP rather than localhost, since a
// phone/simulator is a separate device from the machine running the server.
// Update HOST if your computer's IP changes (run `ipconfig getifaddr en0`).
const HOST = '10.0.0.179';
const PORT = 8787;
// To use the deployed copy instead, set EXPO_PUBLIC_API_BASE (and, to make
// changes, EXPO_PUBLIC_OWNER_TOKEN) in a local .env that is never committed.
// Expo inlines EXPO_PUBLIC_ values into the bundle, which is fine for an app
// that only ever runs on the owner's own phone through Expo Go.
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || `http://${HOST}:${PORT}`).replace(/\/$/, '');
const OWNER_TOKEN = process.env.EXPO_PUBLIC_OWNER_TOKEN || '';

// Every request carries the owner token when one is configured; the server
// ignores it for reads and requires it for writes once ADMIN_TOKEN is set.
const fetch = (url, options = {}) =>
  globalThis.fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(OWNER_TOKEN ? { Authorization: `Bearer ${OWNER_TOKEN}` } : {}) },
  });

// Suppliers with no imgix in front of them are normalized by our own server,
// which the phone reaches on the LAN rather than on localhost. Configured here
// because this module already owns that address.
configureImageProxy(API_BASE);

const SEARCH_API = `${API_BASE}/api/search`;
const COLLECTION_API = `${API_BASE}/api/collection`;
const PRICES_API = `${API_BASE}/api/prices`;
const HISTORY_API = `${API_BASE}/api/price-history`;
const UPLOAD_API = `${API_BASE}/api/images/upload`;
const FLIP_API = `${API_BASE}/api/images/flip`;

export async function fetchCollection() {
  const res = await fetch(COLLECTION_API);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveCollection(items) {
  const res = await fetch(COLLECTION_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    // Carry the server's own explanation up to the screen. A rejected write
    // (the body outgrowing the proxy's limit, say) is permanent and needs to
    // be reported as such, not as a connection that might come back.
    let detail = '';
    try {
      const body = await res.json();
      detail = body.detail || body.error || '';
    } catch {
      detail = '';
    }
    throw Object.assign(new Error(detail || `status ${res.status}`), { status: res.status });
  }
}

export async function searchSneakers(query) {
  const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `status ${res.status}`);
  return Array.isArray(data.results) ? data.results : [];
}

export async function refreshMarketPrices(ids) {
  const res = await fetch(PRICES_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `status ${res.status}`);
  return data.prices || {};
}

export async function fetchPriceHistory(kicksId) {
  const res = await fetch(`${HISTORY_API}?id=${encodeURIComponent(kicksId)}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return data.history?.[kicksId] ?? [];
}

// A photograph off the camera roll, for a pair neither catalogue carries.
//
// The picker hands back base64 and the proxy takes a data URL, so the bytes
// never touch the filesystem here. The URL that comes back is absolute: the
// phone reaches the proxy over the LAN, so a server-relative path would be
// resolved against the Expo bundler instead.
export async function uploadPhoto({ base64, mimeType = 'image/jpeg', filename, mirror = false }) {
  const res = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl: `data:${mimeType};base64,${base64}`, filename, mirror }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.detail || data.error || `status ${res.status}`);
  return `${API_BASE}${data.url}`;
}

// Flip a photograph that has already been uploaded, so the toggle is something
// you can act on while looking at the photo rather than a preference that only
// applies to the next one. The flipped copy is stored under a new id, which is
// also what stops a year-long immutable cache from hiding the change.
export async function flipPhoto(imageUrl) {
  const match = /\/api\/images\/uploaded\/([a-z0-9-]+)/i.exec(imageUrl || '');
  if (!match) throw new Error('Only a photo added here can be flipped');

  const res = await fetch(FLIP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: match[1] }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.detail || data.error || `status ${res.status}`);
  return `${API_BASE}${data.url}`;
}
