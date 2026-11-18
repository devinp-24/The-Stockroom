import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeKicksProduct, isSneakerProduct, SNEAKER_PRODUCT_TYPE, pairFieldsFromSearchResult } from '../shared/kicksdb.js';
import { EMPTY_PAIR } from '../shared/collection.js';
import { genId } from '../shared/format.js';
import { fetchCatalogue, searchCatalogue } from './lib/antosports.mjs';
import {
  importImage,
  normalizeImageBuffer,
  renderVariant,
  shouldMirror,
  imageIdFor,
  flipImageBuffer,
} from './lib/image-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);
app.use(cors());

// ---------------------------------------------------------------------------
// Owner-only writes.
//
// The deployed copy is public: anyone can read the collection, nobody but the
// owner can change it. ADMIN_TOKEN is a long random secret set on the host;
// the owner's browser, the Chrome extension and the MCP server all send it as
// a bearer token. When ADMIN_TOKEN is unset (local development) every request
// is treated as the owner, so running the app on a laptop works exactly as
// it did before.
//
// This is deliberately the smallest thing that keeps strangers out. It is a
// single shared secret with no expiry, rotation or per-device revocation;
// hardening it means real accounts (an OAuth provider or passkeys) and
// scoped, revocable tokens for the extension and the MCP server.
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function isOwner(req) {
  if (!ADMIN_TOKEN) return true;
  const header = req.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireOwner(req, res, next) {
  if (isOwner(req)) return next();
  return res.status(401).json({ error: 'This copy is read-only. Sign in as the owner to make changes.' });
}

app.get('/api/auth', (req, res) => {
  res.json({ canEdit: isOwner(req), authRequired: Boolean(ADMIN_TOKEN) });
});

// The collection is PUT whole on every change, so the request body grows with
// the collection. express.json()'s default cap is 100kb, which 193 pairs went
// straight through (~106kb) -- and because only WRITES carry a body, reads
// kept working perfectly while every save died with a 413. The app looked
// fine until it was reloaded, at which point everything added since the
// collection crossed ~187 pairs was simply not there.
//
// 10mb holds roughly 18,000 pairs at the ~550 bytes each currently costs. The
// same parser also takes dropped photographs as base64, though, and base64 is
// a third larger than the file it encodes: a 9mb photo off a camera roll
// arrived as a 12mb body and was rejected before the upload route ever ran.
// 40mb covers anything a phone or camera produces.
app.use(express.json({ limit: '40mb' }));

const KICKSDB_API_KEY = process.env.KICKSDB_API_KEY;
const KICKSDB_BASE = process.env.KICKSDB_BASE || 'https://api.kicks.dev/v3';

// KicksDB unifies StockX, GOAT, Flight Club, Stadium Goods, and KicksCrew
// behind the same /v3/{platform}/products shape. Defaulting to StockX since
// it has the deepest catalog — swap this (or make it a query param) if you
// want to search a different source.
const PLATFORM = 'stockx';

// Search is sneakers-only, and asks KicksDB for that rather than sorting it
// out afterwards. Filtering the response client-side would still spend the
// whole 30-row budget on hoodies and trading cards and hand back whatever
// few pairs survived; asking up front spends all 30 on sneakers. Measured on
// "travis scott": 1 sneaker in 30 unfiltered, 30 in 30 with this set.
const SEARCH_PRODUCT_TYPE = SNEAKER_PRODUCT_TYPE;

// How many price lookups may be in flight at once. Low on purpose: the
// allowance is small, and nothing here is time-critical.
const PRICE_FETCH_CONCURRENCY = 4;
const MAX_IDS_PER_REFRESH = 30;

/** Run `task` over `items`, never more than `limit` at a time, preserving order. */
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

app.get('/api/search', requireOwner, async (req, res) => {
  const q = req.query.q;
  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: 'Missing search query (?q=...)' });
  }
  if (!KICKSDB_API_KEY) {
    return res.status(500).json({ error: 'KICKSDB_API_KEY is not set on the server' });
  }

  try {
    // NOTE: "query" is the param name to double-check against
    // https://docs.kicks.dev before relying on this — see README.
    // limit=30: KicksDB returns every colorway as a separate product, so a
    // low limit was hiding most of them — see The Stockroom's search UX fix.
    const url =
      `${KICKSDB_BASE}/${PLATFORM}/products` +
      `?query=${encodeURIComponent(q)}` +
      `&product_type=${encodeURIComponent(SEARCH_PRODUCT_TYPE)}` +
      `&limit=30`;
    const kicksRes = await fetch(url, {
      headers: { Authorization: KICKSDB_API_KEY },
    });

    if (!kicksRes.ok) {
      const detail = await kicksRes.text();
      return res.status(kicksRes.status).json({ error: 'KicksDB request failed', detail });
    }

    const body = await kicksRes.json();
    const rawResults = body.data ?? body.results ?? (Array.isArray(body) ? body : []);

    // Normalization lives in shared/kicksdb.js so the search route, the
    // clients' add-forms, and the backfill migration all agree on what
    // `model` and `colorway` mean. `model` is now the silhouette with the
    // redundant brand prefix removed ("Book 1", not "Nike Book 1"), and
    // `colorway` is KicksDB's secondary_title.
    //
    // The product_type filter is applied a second time here, on the way out.
    // KicksDB ignores query parameters it does not recognise instead of
    // rejecting them -- `type=`, `categories=` and `filter[product_type]=` all
    // come back cheerfully unfiltered -- so a renamed parameter would silently
    // put the trading cards back. This pass is what actually holds the
    // guarantee; the parameter above is what makes it cheap.
    const results = rawResults.filter(isSneakerProduct).map(normalizeKicksProduct)
      .map((r) => ({ ...r, source: 'stockx' }));

    // antosports carries the Chinese basketball brands StockX does not --
    // Anta, Li-Ning, 361, Peak, Xtep, Rigorer, Qiaodan -- which is why those
    // pairs used to be typed in by hand. Merged in here so one search covers
    // both catalogues.
    //
    // A failure on this side must not take the search down: StockX results are
    // the common case and are already in hand by this point.
    let antoResults = [];
    try {
      const catalogue = await fetchCatalogue({ cacheFile: CATALOGUE_CACHE });
      antoResults = searchCatalogue(catalogue, q, 30);
    } catch (err) {
      console.error('antosports search unavailable:', err.message);
    }

    res.json({ results: interleave(results, antoResults) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed', detail: String(err) });
  }
});

/**
 * Blend two ranked lists without letting either bury the other.
 *
 * Straight concatenation would be wrong in both directions: "kt9" has no
 * StockX matches worth seeing and would put 30 irrelevant results above the
 * right ones, while "jordan 4" has no antosports matches worth seeing. Taking
 * from each in turn puts the strongest of both sources on the first row, and
 * whichever list runs out simply stops contributing.
 */
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

// Price refresh — takes the KicksDB product ids already stored on pairs
// (captured when they were added via search) and re-fetches each one's
// current market price via KicksDB's single-product endpoint. This is a
// manual, user-triggered action rather than something that runs on every
// page load, since the free KicksDB tier is capped at 1,000 requests/month
// and a refresh costs one request per tracked pair.
app.post('/api/prices', requireOwner, async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Body must be { ids: [...] }' });
  }
  // A backstop, not the main control — the client decides which pairs are
  // stale. This just means a bug can never spend the whole allowance at once.
  if (ids.length > MAX_IDS_PER_REFRESH) {
    return res.status(400).json({
      error: `Too many ids in one refresh (${ids.length}). The limit is ${MAX_IDS_PER_REFRESH}.`,
    });
  }
  if (!KICKSDB_API_KEY) {
    return res.status(500).json({ error: 'KICKSDB_API_KEY is not set on the server' });
  }

  try {
    // Fetched through a small pool rather than all at once. The previous
    // Promise.all fired one request per tracked pair simultaneously — 95 in
    // flight — which is both rude to the API and exactly the shape that trips
    // a per-second rate limit. The client caps how many ids it sends; this
    // caps how fast they go out.
    const entries = await mapWithConcurrency(ids, PRICE_FETCH_CONCURRENCY, async (id) => {
      try {
        const kicksRes = await fetch(`${KICKSDB_BASE}/${PLATFORM}/products/${id}`, {
          headers: { Authorization: KICKSDB_API_KEY },
        });
        if (!kicksRes.ok) return [id, null];
        const body = await kicksRes.json();
        const product = body.data ?? body;
        const price = typeof product.avg_price === 'number' ? product.avg_price : null;
        return [id, price];
      } catch {
        return [id, null];
      }
    });
    const prices = Object.fromEntries(entries);
    const recorded = await appendPriceHistory(prices);
    res.json({ prices, recorded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch prices', detail: String(err) });
  }
});

// Read-only for now — nothing in the UI consumes it yet. Phase 1's detail
// view plots this as a sparkline.
app.get('/api/price-history', async (req, res) => {
  try {
    const raw = await fs.readFile(PRICE_HISTORY_FILE, 'utf-8');
    const history = JSON.parse(raw);
    const id = req.query.id;
    res.json({ history: id ? { [id]: history[id] ?? [] } : history });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ history: {} });
    console.error(err);
    res.status(500).json({ error: 'Could not read price history', detail: String(err) });
  }
});

// Collection storage — a single JSON file on disk. Simple and file-based on
// purpose: it gets the data off browser localStorage (so it survives
// clearing site data and works the same from any browser hitting this
// server) without standing up a database for a personal-use app. If this
// ever needs to be reachable from other devices/a real mobile app, swap
// this file store for a proper DB behind the same two routes.
// DATA_DIR points at a mounted volume in production, so the collection
// survives redeploys. Locally it stays beside this file as before.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const IMAGE_DIR = path.join(DATA_DIR, 'images');
const CATALOGUE_CACHE = path.join(DATA_DIR, 'antosports-catalogue.json');

// data/backups/ held 19 orphaned snapshots and nothing in the codebase wrote
// them any more. Rather than delete them, the rotation that produced them is
// restored: every overwrite is preceded by a snapshot, and only the most
// recent BACKUP_LIMIT are kept. This is also the safety net the Phase 0
// backfill migration relies on.
const BACKUP_LIMIT = 20;

async function readCollection() {
  try {
    const raw = await fs.readFile(COLLECTION_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function backupCollection() {
  let current;
  try {
    current = await fs.readFile(COLLECTION_FILE, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return; // nothing to back up yet
    throw err;
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(BACKUP_DIR, `collection.${stamp}.json`), current);

  const entries = (await fs.readdir(BACKUP_DIR))
    .filter((f) => f.startsWith('collection.') && f.endsWith('.json'))
    .sort();
  const stale = entries.slice(0, Math.max(0, entries.length - BACKUP_LIMIT));
  await Promise.all(stale.map((f) => fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {})));
}

// Writes are queued. The web app PUTs the whole collection while the
// extension and the MCP server add single pairs; without a queue, two writes
// landing together could each read the old file and one would silently undo
// the other.
let writeChain = Promise.resolve();
function queued(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => {});
  return run;
}

async function writeCollectionNow(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await backupCollection();
  // Write to a temporary file and rename it over the original, so a crash
  // mid-write can never leave a half-written collection behind.
  const tmp = `${COLLECTION_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2));
  await fs.rename(tmp, COLLECTION_FILE);
}

function writeCollection(items) {
  return queued(() => writeCollectionNow(items));
}

// data/price-history.json was likewise stranded — 95 ids each holding exactly
// one datapoint, with no code left to append to it. Refreshes now record
// every observation again, so a pair accumulates a real series instead of
// each refresh discarding the previous value.
async function appendPriceHistory(prices) {
  let history = {};
  try {
    history = JSON.parse(await fs.readFile(PRICE_HISTORY_FILE, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const timestamp = new Date().toISOString();
  let recorded = 0;
  for (const [id, price] of Object.entries(prices)) {
    if (typeof price !== 'number') continue;
    if (!Array.isArray(history[id])) history[id] = [];
    const last = history[id][history[id].length - 1];
    // Don't record a flat line — only append when the price actually moved.
    if (last && last.price === price) continue;
    history[id].push({ price, timestamp });
    recorded += 1;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRICE_HISTORY_FILE, JSON.stringify(history, null, 2));
  return recorded;
}

app.get('/api/collection', async (_req, res) => {
  try {
    const items = await readCollection();
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not read collection', detail: String(err) });
  }
});

app.put('/api/collection', requireOwner, async (req, res) => {
  const { items } = req.body ?? {};
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Body must be { items: [...] }' });
  }
  try {
    await writeCollection(items);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save collection', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Single-pair routes, for clients that add or change one pair at a time: the
// Chrome extension ("Save to Stockroom") and the MCP server. The web app
// still PUTs the whole list; these exist so a small client never has to.
// ---------------------------------------------------------------------------
const PAIR_FIELDS = ['brand', 'model', 'colorway', 'size', 'status', 'price', 'imageUrl', 'notes', 'tags', 'sku', 'rating'];

function cleanPairInput(body) {
  const out = {};
  for (const key of PAIR_FIELDS) {
    if (body[key] === undefined) continue;
    if (key === 'tags') out.tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [];
    else if (key === 'rating') out.rating = typeof body.rating === 'number' ? body.rating : null;
    else out[key] = String(body[key]).slice(0, 500).trim();
  }
  if (out.status && !['owned', 'want'].includes(out.status)) delete out.status;
  return out;
}

// The fields that describe the shoe itself, as opposed to my relationship
// with it. KicksDB is the authority on these when it knows the style code.
const IDENTITY_FIELDS = ['brand', 'model', 'colorway', 'sku', 'imageUrl'];

const normSku = (sku) => String(sku || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Best KicksDB match for a style code, or null. One request. */
async function lookupBySku(sku) {
  if (!KICKSDB_API_KEY || !sku) return null;
  const url = `${KICKSDB_BASE}/${PLATFORM}/products?query=${encodeURIComponent(sku)}`
    + `&product_type=${encodeURIComponent(SEARCH_PRODUCT_TYPE)}&limit=10`;
  const res = await fetch(url, { headers: { Authorization: KICKSDB_API_KEY } });
  if (!res.ok) return null;
  const body = await res.json();
  const rows = (body.data ?? body.results ?? []).filter(isSneakerProduct).map(normalizeKicksProduct);
  return rows.find((r) => normSku(r.sku) === normSku(sku)) || null;
}

// Look up whether a pair is already filed, by style code or by KicksDB id.
// The extension calls this when it opens on a product page, so it can say
// "already on your list" instead of offering to add it twice.
app.get('/api/pairs/lookup', async (req, res) => {
  const sku = normSku(req.query.sku);
  const kicksId = req.query.kicksId ? String(req.query.kicksId) : '';
  if (!sku && !kicksId) return res.status(400).json({ error: 'Pass ?sku= or ?kicksId=' });
  const items = await readCollection();
  const match = items.find((i) => (sku && normSku(i.sku) === sku) || (kicksId && i.kicksId === kicksId));
  res.json({ found: Boolean(match), pair: match || null });
});

// What the extension asks when it opens on a product page: is this style
// code already filed, and if not, what does KicksDB call it? The popup then
// shows exactly what will be saved (canonical name, colourway and photo)
// before the owner clicks anything. Owner only, because each call spends
// KicksDB quota.
app.get('/api/pairs/resolve', requireOwner, async (req, res) => {
  const sku = normSku(req.query.sku);
  if (!sku) return res.status(400).json({ error: 'Pass ?sku=' });
  const items = await readCollection();
  const existing = items.find((i) => normSku(i.sku) === sku) || null;
  if (existing) return res.json({ existing, canonical: null });
  let canonical = null;
  try {
    const hit = await lookupBySku(req.query.sku);
    if (hit) {
      canonical = pairFieldsFromSearchResult(hit);
      // The same release can be filed under a different style code format;
      // a KicksDB id match catches that too.
      const byKicks = items.find((i) => i.kicksId && i.kicksId === canonical.kicksId);
      if (byKicks) return res.json({ existing: byKicks, canonical: null });
    }
  } catch (err) {
    console.error('resolve failed:', err.message);
  }
  res.json({ existing: null, canonical });
});

app.post('/api/pairs', requireOwner, async (req, res) => {
  const body = req.body ?? {};
  let fields = cleanPairInput(body);
  let kicksId = body.kicksId ? String(body.kicksId) : null;
  let marketPrice = typeof body.marketPrice === 'number' ? body.marketPrice : null;

  // With a style code, KicksDB supplies the canonical brand, name, colourway
  // and photo, so a pair saved from any shop looks exactly like one added by
  // search. Those identity fields come from KicksDB whenever it knows the
  // shoe: a shop's own naming ("Blue Lagoon" vs "5am Flight") and its own
  // photography (Nike's face the other way, on a lot of white space) would
  // otherwise sit in the grid looking wrong. What only the caller knows
  // (wishlist or owned, target price, size, notes, tags) is always theirs.
  if (body.lookup && fields.sku) {
    try {
      const hit = await lookupBySku(fields.sku);
      if (hit) {
        const canonical = pairFieldsFromSearchResult(hit);
        kicksId = canonical.kicksId;
        marketPrice = canonical.marketPrice;
        for (const key of IDENTITY_FIELDS) {
          if (canonical[key]) fields[key] = canonical[key];
        }
      }
    } catch (err) {
      console.error('sku lookup failed:', err.message);
    }
  }

  if (!fields.model && !fields.brand) {
    return res.status(400).json({ error: 'A pair needs at least a brand or a model' });
  }

  try {
    const result = await queued(async () => {
      const items = await readCollection();
      const dupe = items.find((i) =>
        (fields.sku && normSku(i.sku) === normSku(fields.sku)) || (kicksId && i.kicksId === kicksId));
      if (dupe) return { duplicate: true, pair: dupe };
      const now = new Date().toISOString();
      // No size given: use the one this collection is almost always in, the
      // same default the web app's add form uses.
      if (!fields.size) {
        const counts = {};
        for (const i of items) if (i.size) counts[i.size] = (counts[i.size] || 0) + 1;
        fields.size = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      }
      const pair = {
        ...EMPTY_PAIR,
        ...fields,
        id: genId(),
        status: fields.status || 'want',
        tags: fields.tags || [],
        kicksId,
        marketPrice,
        marketPriceUpdatedAt: marketPrice !== null ? now : null,
        addedAt: now,
        acquiredAt: fields.status === 'owned' ? now : null,
      };
      await writeCollectionNow([...items, pair]);
      return { duplicate: false, pair };
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save that pair', detail: String(err) });
  }
});

app.patch('/api/pairs/:id', requireOwner, async (req, res) => {
  const patch = cleanPairInput(req.body ?? {});
  try {
    const result = await queued(async () => {
      const items = await readCollection();
      const index = items.findIndex((i) => i.id === req.params.id);
      if (index === -1) return null;
      const before = items[index];
      const next = { ...before, ...patch };
      if (patch.status === 'owned' && before.status !== 'owned' && !next.acquiredAt) {
        next.acquiredAt = new Date().toISOString();
      }
      items[index] = next;
      await writeCollectionNow(items);
      return next;
    });
    if (!result) return res.status(404).json({ error: 'No pair with that id' });
    res.json({ pair: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update that pair', detail: String(err) });
  }
});

// Restore routes, used once to copy a local stockroom onto a fresh server
// (scripts/seed-remote.mjs). Owner only, like every other write.
app.put('/api/price-history', requireOwner, async (req, res) => {
  const { history } = req.body ?? {};
  if (!history || typeof history !== 'object') return res.status(400).json({ error: 'Body must be { history: {...} }' });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRICE_HISTORY_FILE, JSON.stringify(history, null, 2));
  res.json({ ok: true });
});

app.put('/api/images/stored/:id', requireOwner, express.raw({ type: 'image/webp', limit: '10mb' }), async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-z0-9-]+$/i.test(id)) return res.status(400).json({ error: 'Bad image id' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Send the webp as the body' });
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGE_DIR, `${id}.webp`), req.body);
  res.json({ ok: true });
});

// Normalized product photography for suppliers imgix does not sit in front of.
//
// The first request for a given source URL downloads and normalizes it; every
// later one is served from data/images. Variants (width, paper blend, wishlist
// desaturation) are rendered from that canonical file, so asking for the same
// shoe at three sizes still only costs one download.
//
// `url` is deliberately not free-form: it is checked against the same host
// allowlist the clients rewrite from, so this cannot be used to fetch
// arbitrary URLs through the server.
const variantCache = new Map();
const VARIANT_CACHE_LIMIT = 300;

app.get('/api/images/proxy', async (req, res) => {
  const source = req.query.url;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'Missing ?url=' });
  }
  if (!shouldMirror(source)) {
    return res.status(400).json({ error: 'Refusing to proxy an unrecognised image host' });
  }

  try {
    const { file } = await importImage(source, IMAGE_DIR, { mirror: true });

    const width = req.query.w ? Number(req.query.w) : undefined;
    const blendWith = typeof req.query.blend === 'string' ? req.query.blend : undefined;
    const desaturate = req.query.sat ? Number(req.query.sat) : undefined;

    let body;
    if (!width && !blendWith && !desaturate) {
      body = await fs.readFile(file);
    } else {
      const key = `${imageIdFor(source)}|${width || ''}|${blendWith || ''}|${desaturate || ''}`;
      if (variantCache.has(key)) {
        body = variantCache.get(key);
      } else {
        body = await renderVariant(await fs.readFile(file), { width, blendWith, desaturate });
        // Plain FIFO. Variants are small and the working set is one screen of
        // plates; an LRU would be more machinery than the problem deserves.
        if (variantCache.size >= VARIANT_CACHE_LIMIT) {
          variantCache.delete(variantCache.keys().next().value);
        }
        variantCache.set(key, body);
      }
    }

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(body);
  } catch (err) {
    console.error('image proxy failed:', err.message);
    res.status(502).json({ error: 'Could not normalize that image', detail: String(err.message || err) });
  }
});

const execFileAsync = promisify(execFile);

/** HEIF/HEIC container check -- `ftyp` at byte 4, then a still-image brand. */
function isHeif(buf) {
  if (buf.length < 12 || buf.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']
    .includes(buf.subarray(8, 12).toString('latin1'));
}

// iPhones shoot HEIC by default, and sharp's prebuilt binary ships libheif
// WITHOUT the HEVC decoder -- it is patent-encumbered, so the published
// binaries decode AVIF and nothing else in that family. Every photo taken on a
// phone and dropped in unconverted therefore died in the pipeline with
// "Support for this compression format has not been built in".
//
// macOS has a decoder already: `sips`, which ships with the OS this runs on.
// Converting to PNG there and handing the result back to the normal pipeline
// keeps the one format most likely to be dropped working, with no new
// dependency. Off macOS this returns null and the caller reports the original
// sharp error, which is the honest answer there.
async function decodeHeifToPng(raw) {
  if (process.platform !== 'darwin') return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stockroom-heif-'));
  try {
    const src = path.join(dir, 'source.heic');
    const out = path.join(dir, 'decoded.png');
    await fs.writeFile(src, raw);
    await execFileAsync('sips', ['-s', 'format', 'png', src, '--out', out]);
    return await fs.readFile(out);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Drop-zone uploads, for a pair neither catalogue carries.
//
// The image arrives as a base64 data URL on a JSON body rather than as
// multipart, which avoids a multer dependency for what is a handful of
// uploads; express.json()'s 10mb limit is the ceiling. It goes through the
// same trim/resize as everything else, but mirroring is OFF by default --
// an arbitrary photo has no known orientation convention, so flipping it is
// the caller's explicit choice.
app.post('/api/images/upload', requireOwner, async (req, res) => {
  const { dataUrl, filename, mirror } = req.body ?? {};
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Body must be { dataUrl: "data:image/...;base64,..." }' });
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  let raw;
  try {
    raw = Buffer.from(base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode that image' });
  }
  if (raw.length === 0) return res.status(400).json({ error: 'Empty image' });

  try {
    // The mirror flag belongs in the id. Without it, re-uploading the same
    // photo with "flip" ticked produced the SAME url -- the server rewrote the
    // file correctly, but every client had been told the url was immutable for
    // a year, so nobody ever re-fetched it and ticking flip looked like it did
    // nothing at all. A flipped photo is different content and gets a
    // different address.
    const id = imageIdFor(
      `upload:${filename || ''}:${raw.length}:${raw.subarray(0, 256).toString('hex')}:${mirror ? 'flip' : 'as-is'}`,
      filename,
    );
    const file = path.join(IMAGE_DIR, `${id}.webp`);
    await fs.mkdir(IMAGE_DIR, { recursive: true });
    let normalized;
    try {
      normalized = await normalizeImageBuffer(raw, { mirror: Boolean(mirror) });
    } catch (err) {
      const decoded = isHeif(raw) ? await decodeHeifToPng(raw) : null;
      if (!decoded) throw err;
      normalized = await normalizeImageBuffer(decoded, { mirror: Boolean(mirror) });
    }
    await fs.writeFile(file, normalized);
    res.json({ ok: true, id, url: `/api/images/uploaded/${id}` });
  } catch (err) {
    console.error('upload failed:', err.message);
    res.status(400).json({ error: 'Could not process that image', detail: String(err.message || err) });
  }
});

// Flip a photograph that is already stored.
//
// The drop zone's flip toggle used to apply only to the next upload, which is
// no use once a pair is added: you had to find the original file again to
// change your mind. This turns the toggle into something you can act on while
// looking at the photo. The result is written under a new id, so the page can
// simply point at the new url -- no cache to fight.
app.post('/api/images/flip', requireOwner, async (req, res) => {
  const { id } = req.body ?? {};
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) {
    return res.status(400).json({ error: 'Bad image id' });
  }

  try {
    const stored = await fs.readFile(path.join(IMAGE_DIR, `${id}.webp`));
    const flipped = await flipImageBuffer(stored);
    const nextId = imageIdFor(`flip:${id}`, id);
    await fs.writeFile(path.join(IMAGE_DIR, `${nextId}.webp`), flipped);
    res.json({ ok: true, id: nextId, url: `/api/images/uploaded/${nextId}` });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No such image' });
    console.error('flip failed:', err.message);
    res.status(400).json({ error: 'Could not flip that image', detail: String(err.message || err) });
  }
});

// Serves an uploaded image. Same variant knobs as the proxy route, so an
// uploaded pair blends into the paper on mobile exactly like a catalogue one.
app.get('/api/images/uploaded/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-z0-9-]+$/i.test(id)) return res.status(400).json({ error: 'Bad image id' });

  const file = path.join(IMAGE_DIR, `${id}.webp`);
  try {
    const stored = await fs.readFile(file);
    const width = req.query.w ? Number(req.query.w) : undefined;
    const blendWith = typeof req.query.blend === 'string' ? req.query.blend : undefined;
    const desaturate = req.query.sat ? Number(req.query.sat) : undefined;

    const body = width || blendWith || desaturate
      ? await renderVariant(stored, { width, blendWith, desaturate })
      : stored;

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(body);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No such image' });
    console.error(err);
    res.status(500).json({ error: 'Could not read that image' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// In production this one process also serves the built web app, so the page
// and its API share an origin and there is a single service to deploy.
const APP_DIST = path.join(__dirname, 'stockroom-app', 'dist');
if (existsSync(APP_DIST)) {
  app.use(express.static(APP_DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|health).*/, (_req, res) => res.sendFile(path.join(APP_DIST, 'index.html')));
}

// Body-parser rejections (a too-large or malformed payload) are thrown before
// any route runs, so without this they fall through to Express's default
// handler and come back as an HTML stack trace. The clients read `error` off
// a JSON body to decide what to tell you; an HTML page gave them nothing, so
// a hard, permanent 413 was reported as though the server might be down.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    console.error('Rejected an oversized request body:', err.length, 'bytes');
    const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}mb`;
    const isUpload = req.path.startsWith('/api/images/');
    return res.status(413).json({
      error: isUpload
        ? 'That photo is too large for the server to accept'
        : 'Collection too large for the server to accept',
      detail: `Body was ${mb(err.length)}, limit is ${mb(err.limit)}.${
        isUpload ? ' Base64 adds about a third to the file size.' : ''
      } Raise the express.json() limit in server.js.`,
    });
  }
  if (err) {
    console.error(err);
    return res.status(400).json({ error: 'Bad request', detail: String(err.message || err) });
  }
  return res.status(500).json({ error: 'Unknown server error' });
});

const PORT = process.env.PORT || 8787;
const server = app.listen(PORT, () => {
  console.log(`Sneaker search proxy running on http://localhost:${PORT}`);
});

// The website and mobile app each have their own "start everything" command
// but share this one proxy. Rather than crash with EADDRINUSE when both get
// started, assume the other instance is already serving this port and exit
// cleanly so concurrently-style runners don't report a failure.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use — assuming the proxy is already running elsewhere and exiting.`);
    process.exit(0);
  }
  throw err;
});
