// The single place product image URLs are transformed.
//
// KicksDB hands back StockX imgix URLs already sized for a tiny thumbnail:
// `w=140&h=100&bg=FFFFFF&dpr=2&trim=color` — 280x200 real pixels, boxed on
// white. Every stored record in the collection carries one of those, and the
// UI stretches them across a full card. imgix reads its parameters from the
// query string, so a larger, tightly-trimmed asset is one rewrite away: the
// same URL at w=900 returns roughly 800px on the long edge.
//
// Nothing calls imgix params directly — components call normalizeProductImage
// and get back whatever the current policy is. Raw URLs stay untouched in
// data/collection.json so this is reversible and so records added before the
// rewrite existed are upgraded on read.

const STOCKX_IMAGE_HOST = 'images.stockx.com';

// Suppliers whose photography needs work imgix cannot be asked to do for us,
// because there is no imgix in front of them: a Shopify CDN just serves the
// file as shot. antosports shoots toe-LEFT on a near-square canvas where the
// shoe covers about a third of the frame, so left alone those pairs render
// mirrored and half-size next to every StockX cutout. The proxy route on our
// own server does the trim, the flip and the resize instead.
const PROXIED_IMAGE_HOSTS = new Set([
  'antosports.com',
  'www.antosports.com',
  'cdn.shopify.com',
]);

// Set once at startup by each client, because they reach the same server at
// different addresses -- the website over localhost, the phone over the LAN.
// Stored URLs stay raw and portable; the rewrite happens on read, exactly as
// it already does for StockX.
let imageProxyBase = '';

export function configureImageProxy(baseUrl) {
  imageProxyBase = String(baseUrl || '').replace(/\/$/, '');
}

/** True when this URL needs our own server to normalize it. */
export function needsImageProxy(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return PROXIED_IMAGE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const IMAGE_POLICY = {
  width: 900,
  format: 'webp',
  trim: 'color',
  quality: 90,
};

/** True when this URL is one we know how to rewrite. */
export function isUpgradableProductImage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return new URL(url).hostname === STOCKX_IMAGE_HOST;
  } catch {
    return false;
  }
}

/**
 * Return a high-resolution, tightly-trimmed variant of a product image.
 * Non-StockX URLs (and anything unparseable) are returned unchanged.
 *
 * @param {string} url
 * @param {object}  [options]
 * @param {number}  [options.width]      smaller slots (search thumbnails) do
 *   not need 900px.
 * @param {string}  [options.blendWith]  hex WITHOUT the '#'. Multiplies the
 *   photograph against this colour server-side, which turns the white box
 *   baked into every StockX asset into the page's own paper. The web does
 *   this in CSS with mix-blend-mode instead; React Native only supports that
 *   style prop on the New Architecture, and it silently does nothing in Expo
 *   Go, so mobile asks imgix to do the blending for it.
 * @param {number}  [options.desaturate] 0-100. Server-side equivalent of
 *   CSS `saturate()`: 60 matches saturate(0.4).
 */
export function normalizeProductImage(url, options = {}) {
  // A supplier we have to normalize ourselves. The proxy takes the same knobs
  // imgix does below, so callers do not need to know which source a pair came
  // from -- Photo/Plate ask for a width and a blend and get one either way.
  if (needsImageProxy(url)) {
    if (!imageProxyBase) return url;
    const params = new URLSearchParams({ url });
    params.set('w', String(options.width ?? IMAGE_POLICY.width));
    if (options.blendWith) params.set('blend', String(options.blendWith).replace('#', ''));
    if (options.desaturate) params.set('sat', String(Math.abs(options.desaturate)));
    return `${imageProxyBase}/api/images/proxy?${params.toString()}`;
  }

  if (!isUpgradableProductImage(url)) return url;

  const width = options.width ?? IMAGE_POLICY.width;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const params = parsed.searchParams;

  params.set('w', String(width));
  params.set('fm', IMAGE_POLICY.format);
  params.set('trim', IMAGE_POLICY.trim);
  params.set('q', String(IMAGE_POLICY.quality));

  // `h` alongside `fit=fill` letterboxes the shoe into a fixed 4:3 box and
  // `dpr` silently multiplies the request past the source's ~800px ceiling.
  // Dropping both lets the asset come back at its own aspect ratio, which is
  // what a cutout layout needs.
  params.delete('h');
  params.delete('dpr');

  if (options.blendWith) {
    params.set('blend', String(options.blendWith).replace('#', ''));
    params.set('bm', 'multiply');
  }

  if (options.desaturate) {
    params.set('sat', String(-Math.abs(options.desaturate)));
  }

  // `updated_at` is StockX's cache key — preserved so a re-shot product photo
  // still busts the CDN.
  return parsed.toString();
}

/** Count how many URLs in a set the normalizer actually changes. */
export function countUpgradableImages(urls) {
  return urls.filter((url) => isUpgradableProductImage(url) && normalizeProductImage(url) !== url)
    .length;
}
