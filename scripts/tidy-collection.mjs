#!/usr/bin/env node
// Reconcile silhouette names across the collection.
//
//   node scripts/tidy-collection.mjs            # dry run, prints every change
//   node scripts/tidy-collection.mjs --apply    # writes via the API
//
// The problem this solves: a shoe's silhouette arrived from whichever supplier
// title happened to be attached to it, so ONE model shows up in the grid as
// several. "KT The Mountain 2.0" was also stored as `KT "The Mountain 2.0"
// Blue/White`, `KT “The Mountain 2.0” Green` and `KT The Mountain 2.0 Low`.
// Nine records had the model "Men", from a parser that read the apostrophe in
// "Men's" as an opening quote.
//
// Rather than repair those strings individually, the silhouette is DERIVED:
// the line and its generation number are pulled out of everything known about
// the pair, and written in one canonical form. Whatever is left over becomes
// the colourway, unless the record already had a good one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATALOGUE = path.join(ROOT, 'stockroom-website', 'data', 'antosports-catalogue.json');
const API = process.env.STOCKROOM_API || 'http://localhost:8787';

const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------------------
// Silhouette rules.
//
// Ordered: the first line that matches wins, so "KT Splash 3.0 Low" is caught
// by the Splash rule before the bare "KT<n>" rule can claim the 3.
// ---------------------------------------------------------------------------
const LINES = [
  { re: /\bkt\s*splash\s*(\d+(?:\.\d+)?)\s*(v2)?/i, name: (m) => `KT Splash ${decimal(m[1])}${m[2] ? ' V2' : ''}` },
  { re: /\bsplash\s*(\d+(?:\.\d+)?)/i,              name: (m) => `KT Splash ${decimal(m[1])}` },
  { re: /the\s*mountain\s*(\d+(?:\.\d+)?)/i,        name: (m) => `KT The Mountain ${decimal(m[1])}` },
  { re: /light\s*cavalry\s*(\d+)/i,                 name: (m) => `Klay Thompson Light Cavalry ${m[1]}` },
  { re: /shock\s*the\s*game\s*(\d+(?:\.\d+)?)/i,    name: (m) => `Klay Thompson Shock The Game ${decimal(m[1])}` },
  { re: /\bkt\s*(\d{1,2})\b/i,                      name: (m) => `Klay Thompson KT${m[1]}` },
  { re: /\bkai\s*(\d)\b/i,                          name: (m) => `Kai ${m[1]}` },
];

// Variant suffixes that genuinely distinguish one silhouette from another --
// a KT6 Low is a different shoe from a KT6, but a KT6 "Away" is a colourway.
const VARIANTS = [
  { re: /\blow\b/i, label: 'Low' },
  { re: /\bhigh\b/i, label: 'High' },
  { re: /\bpro\b/i, label: 'Pro' },
  { re: /\bteam\b/i, label: 'Team' },
  { re: /\blite\b/i, label: 'Lite' },
  { re: /\bfinals?\b/i, label: 'Final' },
];

/** "2" -> "2.0", "2.5" -> "2.5". Splash and Mountain generations are decimal. */
function decimal(n) {
  return String(n).includes('.') ? String(n) : `${n}.0`;
}

/** Text this record could carry its silhouette in, richest source first. */
function evidence(item, product) {
  return [product?.title, product?.product_type, item.model, item.colorway]
    .filter(Boolean)
    .join(' ');
}

/**
 * Split text into silhouette and whatever follows it.
 *
 * Positional, not subtractive. An earlier version derived the name and then
 * deleted its words from the colourway, which cannot work: the "1" in "Kai 1"
 * is one character and skipping short tokens left "Kai 1 | 1 Yin Triple
 * Black", while deleting them unconditionally would eat any colourway that
 * legitimately contains a number. Cutting the string where the silhouette
 * ends has neither problem.
 */
export function splitAtModel(text) {
  const t = String(text || '');
  for (const line of LINES) {
    const m = t.match(line.re);
    if (!m) continue;

    let name = line.name(m);
    let end = m.index + m[0].length;

    // A variant word sitting immediately after the generation belongs to the
    // silhouette. "The Finals" is the same thing as "Final" in this catalogue.
    // The character class must span every quote glyph this catalogue uses.
    // Omitting the CLOSING curly quote left `KT “The Mountain 1.0” Low` unable
    // to see its own "Low", which then leaked into the colourway — while the
    // straight-quote spelling of the same shoe parsed correctly, so the two
    // stayed separate silhouettes.
    const vm = t.slice(end).match(/^[\s“”"'‘’\-–—]*(?:the\s+)?(low|high|pro|team|lite|finals?)\b/i);
    if (vm) {
      const label = VARIANTS.find((v) => v.re.test(vm[1]))?.label;
      if (label && !new RegExp(`\\b${label}\\b`, 'i').test(name)) name += ` ${label}`;
      end += vm[0].length;
    }

    // "KT3 Team 2.0" — a sub-version after the variant is part of the name.
    const nm = t.slice(end).match(/^\s*(\d+\.\d+)\b/);
    if (nm) { name += ` ${nm[1]}`; end += nm[0].length; }

    // A collaboration named before the silhouette is colourway information:
    // "Dragon Ball x Anta ... Kt5 Three-pointer" is a Dragon Ball colourway.
    const before = t.slice(0, m.index);
    const collabMatch = before.match(/([A-Za-z0-9][\w'’.& ]*?)\s+x\s+/i);
    const collab = collabMatch && !/^(anta|men|women|kids)\b/i.test(collabMatch[1].trim())
      ? collabMatch[1].trim()
      : '';

    return { model: name, rest: `${collab} ${t.slice(end)}`.trim() };
  }
  return null;
}

export function canonicalModel(text) {
  return splitAtModel(text)?.model ?? '';
}

// Words that belong to no colourway: shop categories and supplier boilerplate.
const NOISE = [
  /\banta\b/gi, /\bmen\s*[’'‘]?\s*s\b/gi, /\bwomen\s*[’'‘]?\s*s\b/gi, /\bmens\b/gi,
  /\bkids?\b/gi, /\bactual\s+basketball\s+shoes\b/gi, /\bbasketball\s+shoes\b/gi,
  /\brunning\s+shoes\b/gi, /\bshoes\b/gi, /\bklay\s*thom?[a-z]*son\b/gi,
  /\bklaytheism\b/gi, /\bsneakers\b/gi,
];

// Spellings the supplier actually ships. Left alone, "Disruptiv" and
// "Disruptive" read as two different colourways of the same shoe.
const COLORWAY_FIXES = [
  [/\bdisruptiv\b/gi, 'Disruptive'],
  [/\bklaytheism\b/gi, 'Klay Theism'],
  [/\bthonpson\b/gi, 'Thompson'],
];

function cleanColorway(rest) {
  let c = String(rest || '');
  for (const [re, to] of COLORWAY_FIXES) c = c.replace(re, to);
  for (const re of NOISE) c = c.replace(re, ' ');
  c = c
    .replace(/[“”"‘’]/g, ' ')
    .replace(/\s*[-–—/,]+\s*$/g, '')
    .replace(/^\s*[-–—/,:]+\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // A possessive the noise pass can clip: "Valentine s Day".
  c = c.replace(/\b(\w+)\s+s\s+(Day|Edition|Night)\b/gi, "$1's $2");
  // Title-case a colourway that arrived shouting or all-lowercase.
  if (c && (c === c.toUpperCase() || c === c.toLowerCase()) && /^[\x00-\x7F]+$/.test(c)) {
    c = c.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  return c;
}

const catalogue = JSON.parse(await fs.readFile(CATALOGUE, 'utf-8')).products;
const byImage = new Map();
for (const p of catalogue) {
  for (const im of p.images || []) if (im.src) byImage.set(im.src, p);
}

const res = await fetch(`${API}/api/collection`);
if (!res.ok) throw new Error(`could not read collection: ${res.status}`);
const items = (await res.json()).items;

const changes = [];
const next = items.map((item) => {
  const product = byImage.get(item.imageUrl);
  // The catalogue title is the richest description when we have it; otherwise
  // fall back to whatever the record itself carries.
  const source = product?.title || `${item.model} ${item.colorway}`;
  const split = splitAtModel(source) || splitAtModel(evidence(item, product));
  if (!split) return item; // not a line this script understands — leave alone

  const model = split.model;
  const colorway = cleanColorway(split.rest);

  const updated = { ...item, brand: 'Anta', model, colorway: colorway || item.colorway };
  if (updated.model !== item.model || updated.colorway !== item.colorway || updated.brand !== item.brand) {
    changes.push({ before: item, after: updated });
  }
  return updated;
});

console.log(`${items.length} pairs read, ${changes.length} would change\n`);
for (const c of changes.slice(0, Number(process.env.SHOW || 40))) {
  console.log(`  ${c.before.brand} | ${c.before.model} | ${c.before.colorway}`);
  console.log(`→ ${c.after.brand} | ${c.after.model} | ${c.after.colorway}\n`);
}

const distinctBefore = new Set(items.filter((i) => i.brand === 'Anta').map((i) => i.model)).size;
const distinctAfter = new Set(next.filter((i) => i.brand === 'Anta').map((i) => i.model)).size;
console.log(`distinct Anta silhouettes: ${distinctBefore} → ${distinctAfter}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

const put = await fetch(`${API}/api/collection`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: next }),
});
if (!put.ok) throw new Error(`write failed: ${put.status} ${await put.text()}`);
console.log('\nWritten.');
