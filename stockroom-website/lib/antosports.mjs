// antosports.com as a second product source.
//
// StockX (via KicksDB) does not carry the Chinese basketball brands -- Anta,
// Li-Ning, 361, Peak, Xtep, Rigorer, Qiaodan -- so those pairs had to be typed
// in by hand with a pasted image URL. antosports is a Shopify store, and every
// Shopify store publishes its whole catalogue as JSON at /products.json. That
// is 2,750 products carrying exactly the fields a Stockroom pair needs, so the
// manual path is not necessary: this reads the catalogue and maps it into the
// same shape `normalizeKicksProduct` produces, and search treats both sources
// alike.
//
// The catalogue is fetched in pages of 250 and held in memory, because 2,750
// products is ~3MB of JSON and re-fetching it per keystroke would be absurd.
const CATALOGUE_BASE = 'https://antosports.com/products.json';
const PAGE_SIZE = 250;
// The catalogue was 16 pages when this was written. The cap exists only to
// stop a runaway loop, so it sits far above that -- an earlier pass set it
// just above the then-current page count and silently truncated the catalogue
// at 2,750 of 3,931 products, which is how an entire KT generation (KT10) and
// the whole KT Splash 7.0 line went missing without any error to notice.
// Hitting this now logs loudly rather than quietly returning a partial answer.
const MAX_PAGES = 60;

// Shopify serves a stale-tolerant catalogue; a day is far fresher than the
// rate new colourways actually appear, and every refetch is 2,750 products.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Shopify rate-limits /products.json hard -- pulling the 11 pages back to back
// earns a 429 partway through. A short gap between pages avoids it entirely.
const PAGE_DELAY_MS = 400;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let memory = { at: 0, products: [] };
let inflight = null;

async function fetchPage(page) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(`${CATALOGUE_BASE}?limit=${PAGE_SIZE}&page=${page}`, {
      headers: { 'User-Agent': 'Stockroom/1.0' },
    });
    if (res.ok) return (await res.json()).products ?? [];
    // 429 is the expected failure here, and it is transient: back off and retry
    // rather than abandoning a catalogue that is 90% downloaded.
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      if (attempt < MAX_RETRIES) {
        await sleep(wait);
        continue;
      }
    }
    throw new Error(`antosports catalogue failed: ${res.status} (page ${page})`);
  }
  return [];
}

/**
 * The catalogue, from memory if warm, else disk, else the network.
 *
 * The disk copy matters more than it looks: without it every server restart
 * costs 11 rate-limited requests before the first search can return anything,
 * and a failed refresh would leave search with nothing to offer. A stale
 * catalogue is far better than none, so a network failure falls back to
 * whatever was last written rather than propagating.
 */
export async function fetchCatalogue({ force = false, cacheFile } = {}) {
  if (!force && memory.products.length && Date.now() - memory.at < CACHE_TTL_MS) {
    return memory.products;
  }

  if (!force && cacheFile && !memory.products.length) {
    try {
      const { readFile } = await import('node:fs/promises');
      const disk = JSON.parse(await readFile(cacheFile, 'utf-8'));
      if (Array.isArray(disk.products) && disk.products.length) {
        memory = { at: disk.at ?? 0, products: disk.products };
        if (Date.now() - memory.at < CACHE_TTL_MS) return memory.products;
      }
    } catch {
      // no usable disk cache; fall through to the network
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const products = [];
    let complete = false;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await fetchPage(page);
      if (batch.length === 0) { complete = true; break; }
      products.push(...batch);
      // A short page is the only reliable end-of-catalogue signal Shopify gives.
      if (batch.length < PAGE_SIZE) { complete = true; break; }
      await sleep(PAGE_DELAY_MS);
    }
    if (!complete) {
      console.warn(
        `[antosports] stopped at the ${MAX_PAGES}-page cap with ${products.length} products ` +
        `and a full final page — the catalogue is TRUNCATED. Raise MAX_PAGES.`
      );
    }
    memory = { at: Date.now(), products };
    if (cacheFile) {
      try {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const path = await import('node:path');
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, JSON.stringify({ at: memory.at, products }));
      } catch {
        // a cache we could not write is not worth failing the request over
      }
    }
    return products;
  })();

  try {
    return await inflight;
  } catch (err) {
    // Serve whatever we already have rather than nothing.
    if (memory.products.length) return memory.products;
    throw err;
  } finally {
    inflight = null;
  }
}

// The brands this store actually carries, longest first so "Li Ning Wade"
// matches before a bare "Li". Written out rather than trusted from `vendor`,
// which files 155 Klay Thompson pairs under "hellobasketballshoes" and a
// handful under a date string like "2023/4/22".
const KNOWN_BRANDS = [
  'Li-Ning', 'Li Ning', 'LiNing',
  'Anta', '361 Degrees', '361°', '361',
  'Peak', 'Xtep', 'Rigorer', 'Qiaodan', 'Erke', 'Warrior',
];

const BRAND_CANON = {
  'li ning': 'Li-Ning', 'lining': 'Li-Ning', 'li-ning': 'Li-Ning',
  '361': '361°', '361 degrees': '361°', '361°': '361°',
};

/** Pull a known brand off the front of a title. Returns [brand, remainder]. */
export function splitBrand(title) {
  const t = String(title || '').trim();
  const ordered = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);
  for (const b of ordered) {
    if (t.toLowerCase().startsWith(`${b.toLowerCase()} `)) {
      const canon = BRAND_CANON[b.toLowerCase()] || b;
      return [canon, t.slice(b.length).trim()];
    }
  }
  return ['', t];
}

/**
 * Split a Shopify title into silhouette and colourway.
 *
 * `product_type` looked like the right field for this and is not: it reads
 * "Anta Klay Thompson Kt1" for a product titled "Anta Klay Thompson Kt1 Pro -
 * LA", which puts the "Pro" into the colourway. The titles themselves are
 * punctuated consistently enough to split on directly.
 *
 * The quote handling is the subtle part. An earlier version accepted a bare
 * apostrophe as an opening quote, so "Anta Men's Klay Thompson Kt2 “Ink
 * camouflage”" split at the apostrophe in "Men's" -- silhouette "Anta Men",
 * colourway "s Klay Thompson Kt2 “Ink camouflage". Nine records in the
 * collection ended up with the model literally "Men". Only genuine PAIRS of
 * quotes count here, and an apostrophe inside one (Valentine's Day) no longer
 * terminates it.
 */
export function splitModelColorway(title) {
  const t = String(title || '').trim();

  // Paired quotes only: “…” or "…" or '…' — never a lone apostrophe.
  const quoted =
    t.match(/^(.*?)\s*[“]([^”]+)[”]\s*$/) ||
    t.match(/^(.*?)\s*["]([^"]+)["]\s*$/) ||
    t.match(/^(.*?)\s*[‘]([^’]+)[’]\s*$/);
  if (quoted && quoted[1].trim()) {
    return [quoted[1].trim(), quoted[2].trim()];
  }

  // An unterminated opening quote still marks where the colourway begins:
  // several titles carry “Bahamas with no closing character at all.
  const openOnly = t.match(/^(.*?)\s*[“"]([^“"]+)$/);
  if (openOnly && openOnly[1].trim()) {
    return [openOnly[1].trim(), openOnly[2].replace(/[”"]\s*$/, '').trim()];
  }

  // "Anta KT Splash 8.0 - Dallas" — first dash with whitespace around it, so a
  // hyphenated silhouette is not torn in half.
  const dash = t.match(/^(.*?)\s+[-–—]\s+(.*)$/);
  if (dash && dash[1].trim()) {
    return [dash[1].trim(), dash[2].trim()];
  }

  return [t, ''];
}

// Spellings this catalogue actually contains, and the noise that rides along
// with a silhouette name. Without these the same shoe lands in the collection
// under several different names and reads as several different silhouettes.
const MODEL_FIXES = [
  [/klay\s*thom?[ps]?son/gi, 'Klay Thompson'],   // "Thomson", "Thonpson"
  [/\bdisruptiv\b/gi, 'Disruptive'],
  [/\bklaytheism\b/gi, 'Klay Theism'],
  [/\bactual\s+basketball\s+shoes\b/gi, ''],
  [/\bbasketball\s+shoes\b/gi, ''],
  [/\brunning\s+shoes\b/gi, ''],
];

/**
 * Reduce a silhouette name to one canonical spelling.
 *
 * Everything here exists because the collection contained two or more names
 * for a single shoe: "KT10" beside "Kt10", `KT "The Mountain 1.0" Low` beside
 * `KT “The Mountain 1.0” Low` beside `KT The Mountain 1.0 Low`.
 */
export function tidyModel(model) {
  let m = String(model || '').trim();

  // Collaboration prefixes belong to the colourway, not the silhouette:
  // "Marvel x Anta Klay Thompson Kt6" is a KT6.
  m = m.replace(/^.*?\s+x\s+(?=anta\b)/i, '');
  m = m.replace(/^anta\s+/i, '');

  // Gender/age shop categories, including the full-width bracket form
  // "（Men & Kids）" this store uses.
  m = m.replace(/^[（(]\s*(men|women|kids)[^）)]*[）)]\s*/i, '');
  m = m.replace(/^(men|women)\s*[’'‘]\s*s\s+/i, '');
  m = m.replace(/^(men|women)s?\s+/i, '');
  m = m.replace(/^kids?\s+/i, '');

  for (const [re, to] of MODEL_FIXES) m = m.replace(re, to);

  // Quotes around a sub-name carry no information once the name is canonical.
  m = m.replace(/[“”"‘’]/g, '');

  // "KT6" not "Kt6"; "KT Splash" not "Kt Splash".
  m = m.replace(/\bkt\b/gi, 'KT').replace(/\bkt(\d+)/gi, 'KT$1');

  return m.replace(/\s{2,}/g, ' ').replace(/[\s,\-–—]+$/, '').trim();
}

/** Normalize one Shopify product into the shape /api/search already returns. */
export function normalizeAntoProduct(product) {
  const title = String(product.title || '').trim();
  const variant = (product.variants || [])[0] || {};
  const image = (product.images || [])[0] || {};

  const [modelPart, colorway] = splitModelColorway(title);
  let [brand, model] = splitBrand(modelPart);

  if (!brand) {
    // Fall back to vendor, but only when it names a brand rather than a shop.
    const vendor = String(product.vendor || '').replace(/^#/, '').trim();
    const [vBrand] = splitBrand(`${vendor} x`);
    brand = vBrand || (BRAND_CANON[vendor.toLowerCase()] || '');
    if (!brand && /^(anta|peak|xtep|rigorer|qiaodan)$/i.test(vendor)) brand = vendor;
  }

  model = tidyModel(model);

  const price = parseFloat(variant.price);

  return {
    id: `anto_${product.id}`,
    source: 'antosports',
    brand: brand || 'Anta',
    model: model || title,
    colorway,
    fullTitle: title,
    sku: variant.sku || '',
    imageUrl: image.src || '',
    retailPrice: Number.isFinite(price) ? price : null,
    // Shopify lists a shop price, not a resale market price. Recorded as the
    // retail figure only -- claiming it as `marketPrice` would put a number
    // the collection treats as market data next to real StockX observations.
    marketPrice: null,
    link: `https://antosports.com/products/${product.handle}`,
  };
}

/** Rank catalogue entries against a free-text query. */
export function searchCatalogue(products, query, limit = 30) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];
  for (const p of products) {
    if (!(p.images || []).length) continue;
    const hay = `${p.vendor || ''} ${p.product_type || ''} ${p.title || ''}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) continue;
    // Prefer a hit in the title over one buried in the vendor string, and
    // shorter titles over longer ones so the base colourway outranks a bundle.
    const titleHits = terms.filter((t) => String(p.title || '').toLowerCase().includes(t)).length;
    scored.push({ p, score: titleHits * 1000 - String(p.title || '').length });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => normalizeAntoProduct(s.p));
}
