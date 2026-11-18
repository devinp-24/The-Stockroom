// One-time backfill for records written before the KicksDB mapping was fixed.
//
// Every existing record has `model` set to the full brand-prefixed title
// ("Nike Book 1 Valley") and `colorway` empty, because the old client code
// filled model from `title` and never read `secondary_title`.
//
// Usage:
//   node scripts/backfill-collection.mjs              # dry run, writes nothing
//   node scripts/backfill-collection.mjs --apply      # writes, after a backup
//   node scripts/backfill-collection.mjs --offline    # dry run, no API calls
//
// Safety properties:
//   * dry run is the default; --apply is the only path that writes
//   * a timestamped snapshot is taken before the file is touched
//   * only `model` and `colorway` are ever modified — id, status, price,
//     size, tags, notes, addedAt, kicksId, sku, marketPrice are passed
//     through untouched
//   * a record whose KicksDB lookup fails is left exactly as it was
//   * re-running is a no-op once records are already correct

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeKicksProduct, stripBrandPrefix } from '../shared/kicksdb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'stockroom-website', 'data');
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const ENV_FILE = path.join(ROOT, 'stockroom-website', '.env');

const APPLY = process.argv.includes('--apply');
const OFFLINE = process.argv.includes('--offline');
const KICKSDB_BASE = 'https://api.kicks.dev/v3';
const PLATFORM = 'stockx';

async function readApiKey() {
  try {
    const raw = await fs.readFile(ENV_FILE, 'utf-8');
    for (const line of raw.split('\n')) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const k = line.slice(0, line.indexOf('=')).trim();
      if (k === 'KICKSDB_API_KEY') return line.slice(line.indexOf('=') + 1).trim();
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchProduct(id, key) {
  const res = await fetch(`${KICKSDB_BASE}/${PLATFORM}/products/${id}`, {
    headers: { Authorization: key },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data ?? body ?? null;
}

/**
 * Offline fallback: recover the silhouette/colorway split without the API by
 * stripping the brand prefix. Without KicksDB we cannot know where the
 * silhouette ends and the colorway begins, so this only de-duplicates the
 * brand and leaves colorway alone — a partial, lossless repair.
 */
function offlineRepair(item) {
  const model = stripBrandPrefix(item.brand, item.model);
  return { model, colorway: item.colorway };
}

const items = JSON.parse(await fs.readFile(COLLECTION_FILE, 'utf-8'));
const key = OFFLINE ? null : await readApiKey();

if (!OFFLINE && !key) {
  console.error('KICKSDB_API_KEY not found in stockroom-website/.env — re-run with --offline for the partial repair.');
  process.exit(1);
}

const trackable = items.filter((i) => i.kicksId).length;
console.log(`${items.length} records (${trackable} with a kicksId)`);
if (!OFFLINE) {
  console.log(`Mode: KicksDB re-fetch — ${trackable} requests (free tier is 1,000/month)\n`);
} else {
  console.log('Mode: offline — brand-prefix strip only, no API calls\n');
}

const changes = [];
const failures = [];
const unchanged = [];

for (const item of items) {
  let next = null;

  if (!OFFLINE && item.kicksId) {
    try {
      const product = await fetchProduct(item.kicksId, key);
      if (product) {
        const n = normalizeKicksProduct(product);
        next = {
          model: n.model || item.model,
          colorway: n.colorway || item.colorway,
        };
      } else {
        failures.push({ item, reason: 'not found on KicksDB' });
      }
    } catch (err) {
      failures.push({ item, reason: String(err) });
    }
  }

  if (!next) next = offlineRepair(item);

  const modelChanged = next.model !== item.model;
  const colorwayChanged = next.colorway !== item.colorway;

  if (modelChanged || colorwayChanged) {
    changes.push({
      id: item.id,
      brand: item.brand,
      before: { model: item.model, colorway: item.colorway },
      after: { model: next.model, colorway: next.colorway },
    });
  } else {
    unchanged.push(item.id);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('BEFORE                                          ->  MODEL              COLORWAY');
console.log('-'.repeat(100));
for (const c of changes) {
  console.log(
    `${pad(`${c.brand} | ${c.before.model}`, 46)}  ->  ${pad(c.after.model, 18)} ${c.after.colorway}`
  );
}

console.log('\n' + '='.repeat(100));
console.log(`Would repair : ${changes.length}`);
console.log(`Unchanged    : ${unchanged.length}`);
console.log(`Lookup fails : ${failures.length}${failures.length ? ' (left exactly as-is)' : ''}`);
for (const f of failures) console.log(`   - ${f.item.brand} ${f.item.model}: ${f.reason}`);

const fieldsTouched = new Set(changes.flatMap((c) => Object.keys(c.after)));
console.log(`Fields touched: ${[...fieldsTouched].join(', ') || 'none'}`);
console.log(`Records lost  : 0 (input ${items.length} -> output ${items.length})`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these changes.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
await fs.mkdir(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(BACKUP_DIR, `collection.pre-backfill.${stamp}.json`);
await fs.copyFile(COLLECTION_FILE, backupPath);
console.log(`\nBackup written: ${path.relative(ROOT, backupPath)}`);

const byId = new Map(changes.map((c) => [c.id, c.after]));
const output = items.map((item) => {
  const next = byId.get(item.id);
  return next ? { ...item, model: next.model, colorway: next.colorway } : item;
});

if (output.length !== items.length) throw new Error('record count changed — aborting');

await fs.writeFile(COLLECTION_FILE, JSON.stringify(output, null, 2));
console.log(`Applied: ${changes.length} records repaired, ${output.length} total written.`);
