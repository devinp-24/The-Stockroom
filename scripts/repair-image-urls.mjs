#!/usr/bin/env node
// Find pairs whose photograph has 404'd, and point them at one that loads.
//
//   node scripts/repair-image-urls.mjs              # dry run, prints every change
//   node scripts/repair-image-urls.mjs --apply      # writes via the API
//   node scripts/repair-image-urls.mjs --limit 5    # only look at the first 5 broken
//
// StockX rewrites its own asset paths over time. Three drifts have been seen
// so far, and all three leave the stored url pointing at nothing:
//
//   *.png              -> *.jpg          (the whole library moved off PNG)
//   Name-Product.jpg   -> Name.jpg       (and the reverse, inconsistently)
//   name-lower-case    -> Name-Title-Case (imgix paths are case-sensitive)
//
// A dead photo is invisible in the register -- the plate just reads "No photo"
// -- so nothing surfaces the rot until you scroll past it. This finds the lot
// in one pass.
//
// Two sources of a replacement, cheapest first: rewriting the url by the rules
// above, then asking the catalogue what it serves for that pair today. Either
// way the candidate is FETCHED before it is accepted, so a repair can never
// swap one dead url for another.
//
// Safety properties:
//   * dry run unless --apply
//   * writes through PUT /api/collection, so the server takes its own backup
//   * only ever touches imageUrl, and only on pairs whose current one is dead
//   * a pair it cannot fix is left exactly as it is and listed at the end
import { normalizeProductImage } from '../shared/images.js';

const API = process.env.STOCKROOM_API || 'http://localhost:8787';
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i === -1 ? Infinity : Number(process.argv[i + 1]) || Infinity;
})();

// A browser's UA: imgix serves these paths differently to an unidentified
// client, and the point is to test what the app will actually get.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// StockX throttles a burst of requests by answering 404, which is
// indistinguishable from a genuinely missing asset on a single look. Every
// verdict here is therefore three spaced attempts: one 200 is enough to call
// it alive, and only a miss every time counts as dead. Without this the first
// run of this script reported 191 broken photos where there were 17.
async function loads(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(900);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/webp,image/*,*/*' } });
      if (res.status === 200) return true;
    } catch {
      /* network blip: treat as a miss and try again */
    }
  }
  return false;
}

/** The url the app actually asks for, which is not the one on the record. */
const rendered = (url) => normalizeProductImage(url);

/** Rewrites of a StockX path, cheapest repair first. */
function urlCandidates(stored) {
  let base;
  try {
    base = new URL(stored);
  } catch {
    return [];
  }
  if (!base.hostname.includes('images.stockx.com')) return [];

  const path = base.pathname;
  const paths = new Set();
  const swapped =
    path.endsWith('.png') ? path.replace(/\.png$/, '.jpg')
    : path.endsWith('.jpg') ? path.replace(/\.jpg$/, '.png')
    : null;
  if (swapped) paths.add(swapped);

  for (const p of [path, swapped].filter(Boolean)) {
    const m = p.match(/^(.*?)(-Product)?(\.(?:png|jpg))$/);
    if (!m) continue;
    paths.add(`${m[1]}-Product${m[3]}`);
    paths.add(`${m[1]}${m[3]}`);
  }
  paths.delete(path);

  return [...paths].map((p) => {
    const next = new URL(stored);
    next.pathname = p;
    return next.toString();
  });
}

/** What the catalogue serves for this pair today. */
async function catalogueCandidate(pair) {
  const query = [pair.brand, pair.model, pair.colorway].filter(Boolean).join(' ');
  let results = [];
  try {
    const res = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    results = (await res.json()).results ?? [];
  } catch {
    return null;
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Only an exact silhouette AND colourway match is worth taking -- a near
  // miss would quietly put another shoe's photograph on this pair, which is
  // worse than the empty plate it replaces.
  const exact = results.find(
    (r) => norm(r.model) === norm(pair.model) && norm(r.colorway) === norm(pair.colorway),
  );
  return exact?.imageUrl || null;
}

// ---------------------------------------------------------------------------

const res = await fetch(`${API}/api/collection`);
if (!res.ok) {
  console.error(`Could not read the collection from ${API} (status ${res.status}). Is the proxy running?`);
  process.exit(1);
}
const items = (await res.json()).items ?? [];
console.log(`${items.length} pairs in the collection.\n`);

const checkable = items.filter((i) => i.imageUrl && !i.imageUrl.includes('/api/images/uploaded/'));
console.log(`Checking ${checkable.length} catalogue photographs (uploads are local and skipped)…`);

const broken = [];
let checked = 0;
for (const pair of checkable) {
  checked++;
  if (checked % 50 === 0) process.stdout.write(`  …${checked}/${checkable.length}\n`);
  // One attempt on the happy path: almost every photo is fine, and three
  // attempts each would mean thousands of requests.
  if (await loads(rendered(pair.imageUrl), 1)) continue;
  if (await loads(rendered(pair.imageUrl), 3)) continue; // confirm before believing it
  broken.push(pair);
  if (broken.length >= LIMIT) break;
}

console.log(`\n${broken.length} pair(s) with a dead photograph.\n`);
if (!broken.length) process.exit(0);

const fixes = [];
const unfixable = [];

for (const pair of broken) {
  const name = `${pair.brand} ${pair.model} / ${pair.colorway}`;
  let replacement = null;
  let how = '';

  for (const candidate of urlCandidates(pair.imageUrl)) {
    await sleep(400);
    if (await loads(rendered(candidate), 1)) {
      replacement = candidate;
      how = 'url rewrite';
      break;
    }
  }

  if (!replacement) {
    const fromCatalogue = await catalogueCandidate(pair);
    if (fromCatalogue && fromCatalogue !== pair.imageUrl && (await loads(rendered(fromCatalogue), 2))) {
      replacement = fromCatalogue;
      how = 'catalogue lookup';
    }
  }

  if (replacement) {
    fixes.push({ id: pair.id, name, from: pair.imageUrl, to: replacement, how });
    console.log(`  FIX  ${name}`);
    console.log(`       ${pair.imageUrl.split('/').pop().split('?')[0]}  ->  ${replacement.split('/').pop().split('?')[0]}  (${how})`);
  } else {
    unfixable.push({ id: pair.id, name });
    console.log(`  --   ${name}  (no working photograph found)`);
  }
}

console.log(`\n${fixes.length} repairable, ${unfixable.length} not.`);

if (!fixes.length) process.exit(0);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

const byId = new Map(fixes.map((f) => [f.id, f.to]));
const next = items.map((i) => (byId.has(i.id) ? { ...i, imageUrl: byId.get(i.id) } : i));

const put = await fetch(`${API}/api/collection`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: next }),
});
if (!put.ok) {
  let detail = '';
  try {
    detail = JSON.stringify(await put.json());
  } catch {
    /* no body */
  }
  console.error(`\nWrite failed (status ${put.status}). ${detail}`);
  process.exit(1);
}
console.log(`\nWrote ${fixes.length} repaired photograph(s). The server kept a backup of the previous collection.`);
if (unfixable.length) {
  console.log('\nStill without a photograph:');
  for (const u of unfixable) console.log(`  ${u.name}`);
}
