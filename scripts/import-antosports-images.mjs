#!/usr/bin/env node
// Bulk-normalize antosports product photography.
//
//   node scripts/import-antosports-images.mjs --match "anta kt" --out ./anta-kt
//
// Pulls every catalogue entry matching --match, downloads its primary photo,
// and writes the Stockroom-ready cutout: whitespace trimmed, mirrored to face
// toe-right like every StockX asset in the collection, capped at 900px on the
// long edge, WebP. Filenames are slugged from the product title so the output
// directory is browsable.
//
// Re-running is cheap: a file that already exists is left alone, so this can
// be pointed at a wider --match later without re-downloading what it has.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCatalogue, normalizeAntoProduct } from '../stockroom-website/lib/antosports.mjs';
import { importImage, slugify } from '../stockroom-website/lib/image-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(ROOT, 'stockroom-website', 'data', 'antosports-catalogue.json');

// Polite, and fast enough: 370 photos land in well under two minutes.
const CONCURRENCY = 6;

// Named filters, because the useful ones are not expressible as "every word
// must appear". The Klay Thompson family is the motivating case: a plain
// `--match "anta kt"` silently drops the Light Cavalry and Shock The Game
// shoes, which carry his name but never the letters KT.
const PRESETS = {
  kt: {
    // The numbered line, the sub-lines that carry the KT prefix, and the
    // shoes branded with his name alone. "Thonpson" is a real spelling in
    // this catalogue, not a typo here.
    include: /\bkt\s*\d|\bkt\s+(splash|the\s+mountain|blitz|rocco|low|team)|\bkt\b|klay\s*thom?pson/i,
    // KT is an Anta line. Without this, "KT" also matches merchandise for the
    // esports team of the same name.
    require: /anta|klay/i,
  },
};

// Apparel is judged from `product_type`, never from the title: "KT5 Third
// Jersey" is a shoe COLOURWAY, and a title-based filter would have discarded
// it. The product_type of an actual garment says "Shorts" or "Jacket".
const APPAREL_TYPE =
  /\b(jacket|tee|t-shirt|shirt|shorts?|hoodie|pants?|sock|socks|bag|backpack|cap|hat|vest|tank|jersey|towel|keychain|insole|lace|sweater|windbreaker)\b/i;

function parseArgs(argv) {
  const args = { match: '', preset: '', out: '', limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--match') args.match = argv[++i] ?? '';
    else if (argv[i] === '--preset') args.preset = argv[++i] ?? '';
    else if (argv[i] === '--out') args.out = argv[++i] ?? '';
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]) || Infinity;
  }
  return args;
}

const haystack = (p) => `${p.vendor || ''} ${p.product_type || ''} ${p.title || ''}`;

/** Every term must appear somewhere in the product's vendor/type/title. */
function matchesTerms(product, terms) {
  const hay = haystack(product).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function matchesPreset(product, preset) {
  const hay = haystack(product);
  if (!preset.include.test(hay)) return false;
  if (preset.require && !preset.require.test(hay)) return false;
  return true;
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await task(items[i], i);
      }
    })
  );
  return results;
}

const { match, preset, out, limit } = parseArgs(process.argv.slice(2));
if ((!match && !preset) || !out) {
  console.error('usage: import-antosports-images.mjs (--match "<terms>" | --preset <name>) --out <dir> [--limit N]');
  console.error(`presets: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}
if (preset && !PRESETS[preset]) {
  console.error(`unknown preset "${preset}" — try one of: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}

const terms = match.toLowerCase().split(/\s+/).filter(Boolean);
const outDir = path.resolve(process.cwd(), out);

console.log(`Reading antosports catalogue…`);
const catalogue = await fetchCatalogue({ cacheFile: CACHE_FILE });
console.log(`  ${catalogue.length} products`);

const selected = catalogue.filter((p) =>
  preset ? matchesPreset(p, PRESETS[preset]) : matchesTerms(p, terms)
);
const apparel = selected.filter((p) => APPAREL_TYPE.test(String(p.product_type || '')));
const hits = selected
  .filter((p) => !APPAREL_TYPE.test(String(p.product_type || '')) && (p.images || []).length)
  .slice(0, limit);

console.log(`  ${hits.length} match ${preset ? `preset "${preset}"` : `"${match}"`}`);
if (apparel.length) console.log(`  ${apparel.length} skipped as apparel`);
console.log('');

await fs.mkdir(outDir, { recursive: true });

let done = 0;
let reusedCount = 0;
const failures = [];
const manifest = [];

const results = await mapWithConcurrency(hits, CONCURRENCY, async (product) => {
  const pair = normalizeAntoProduct(product);
  const slug = slugify([pair.brand, pair.model, pair.colorway].filter(Boolean).join(' '));
  try {
    const { id, reused } = await importImage(pair.imageUrl, outDir, { mirror: true, slug });
    done += 1;
    if (reused) reusedCount += 1;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${hits.length}\n`);
    manifest.push({
      file: `${id}.webp`,
      brand: pair.brand,
      model: pair.model,
      colorway: pair.colorway,
      retailPrice: pair.retailPrice,
      sku: pair.sku,
      sourceImage: pair.imageUrl,
      productUrl: pair.link,
    });
    return true;
  } catch (err) {
    failures.push({ title: product.title, error: String(err.message || err) });
    return false;
  }
});

manifest.sort((a, b) => a.file.localeCompare(b.file));
await fs.writeFile(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\nWrote ${manifest.length} images to ${outDir}`);
console.log(`  ${manifest.length - reusedCount} downloaded, ${reusedCount} already present`);
if (failures.length) {
  console.log(`  ${failures.length} failed:`);
  failures.slice(0, 10).forEach((f) => console.log(`     ${f.title}: ${f.error}`));
}
console.log(`  manifest: ${path.join(outDir, '_manifest.json')}`);
