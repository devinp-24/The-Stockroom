// Turning a supplier's product photo into a Stockroom cutout.
//
// Every StockX asset arrives already shaped for this layout: shot toe-right,
// tightly trimmed, wide. Nothing else does. antosports (a Shopify store, and
// the source for the Chinese basketball brands StockX does not carry) shoots
// toe-LEFT on a near-square canvas where the shoe covers about a third of the
// frame -- so dropped into the same slot it renders mirrored and about half
// the size of everything around it.
//
// imgix fixes the StockX side at request time from query parameters. There is
// no imgix in front of Shopify, so this module is the local equivalent: it
// does the trim/flip/resize ONCE at import time and stores the result, then
// serves per-request variants (width, paper blend, desaturation) from that
// canonical file. Keeping the stored image on plain white is deliberate --
// it is the same starting point a StockX asset has, so both sources can be
// treated identically downstream.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_POLICY = {
  width: 900,
  quality: 90,
  // sharp compares against the top-left pixel; 10/255 tolerates the JPEG ringing
  // around a photographed edge without eating into the shoe itself.
  trimThreshold: 10,
};

/** Hosts whose photography faces the opposite way to the rest of the collection. */
const MIRRORED_HOSTS = new Set(['antosports.com', 'www.antosports.com', 'cdn.shopify.com']);

export function shouldMirror(sourceUrl) {
  try {
    return MIRRORED_HOSTS.has(new URL(sourceUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Trim the dead space, face the shoe the right way, cap the long edge.
 *
 * Order matters and is enforced here rather than left to sharp's internal
 * pipeline: trim has to read the ORIGINAL border colour, so it runs before
 * anything that could introduce new edge pixels.
 */
export async function normalizeImageBuffer(input, { mirror = false, trim = true, width } = {}) {
  const targetWidth = width ?? IMAGE_POLICY.width;

  let pipeline = sharp(input, { failOn: 'none' }).rotate(); // honour EXIF orientation
  if (trim) pipeline = pipeline.trim({ threshold: IMAGE_POLICY.trimThreshold });

  // Re-open from the trimmed bytes so flop/resize act on the cropped canvas.
  const trimmed = await pipeline.toBuffer();

  let out = sharp(trimmed, { failOn: 'none' });
  if (mirror) out = out.flop();
  out = out.resize({ width: targetWidth, withoutEnlargement: true });
  return out.webp({ quality: IMAGE_POLICY.quality }).toBuffer();
}

/**
 * Flip an image that has already been through the pipeline.
 *
 * Deliberately not normalizeImageBuffer with mirror:true -- the stored file is
 * already trimmed and resized, so that would re-trim borders that have been
 * cut once and re-encode a second time, softening the image a little more on
 * each flip. This is the single operation the caller actually asked for.
 */
export async function flipImageBuffer(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .flop()
    .webp({ quality: IMAGE_POLICY.quality })
    .toBuffer();
}

/**
 * A request-time variant of an already-normalized image.
 *
 * These are the same knobs `normalizeProductImage` asks imgix for on the
 * StockX path -- `blend`/`bm=multiply` to dissolve the white box into the
 * page's paper, and `sat` to hold a wishlist pair back. Mobile needs them
 * server-side because mix-blend-mode is a no-op there under Expo Go.
 */
export async function renderVariant(buffer, { width, blendWith, desaturate } = {}) {
  let img = sharp(buffer, { failOn: 'none' });

  if (width) img = img.resize({ width: Number(width), withoutEnlargement: true });

  if (desaturate) {
    // imgix `sat=-60` reduces saturation by 60%; the multiplier is the remainder.
    const keep = Math.max(0, 1 - Math.abs(Number(desaturate)) / 100);
    img = img.modulate({ saturation: keep });
  }

  if (!blendWith) {
    return img.webp({ quality: IMAGE_POLICY.quality }).toBuffer();
  }

  // The blend needs a backdrop the exact size of the FINISHED image, so the
  // pipeline has to be resolved before its dimensions can be read --
  // `.metadata()` on a pending instance still describes the input, which
  // silently composited a resized shoe onto a full-size canvas.
  const hex = String(blendWith).replace('#', '');
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return sharp({
    create: { width: info.width, height: info.height, channels: 3, background: `#${hex}` },
  })
    .composite([{ input: data, blend: 'multiply' }])
    .webp({ quality: IMAGE_POLICY.quality })
    .toBuffer();
}

/** URL- and filesystem-safe form of a product title. */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/**
 * Stable filename for a source URL, so re-importing the same photo is a no-op.
 *
 * The hash alone would be stable and unique but turns data/images into 370
 * unreadable files. Prefixing the product's slug keeps the directory
 * browsable while the hash still carries the uniqueness, so two colourways
 * that happen to share a title cannot collide.
 */
export function imageIdFor(sourceUrl, slug) {
  const hash = crypto.createHash('sha1').update(String(sourceUrl)).digest('hex').slice(0, 8);
  const name = slugify(slug);
  return name ? `${name}-${hash}` : hash;
}

export async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Stockroom/1.0' } });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fetch + normalize + store, returning the id to reference it by. Skips the
 * download entirely when the file is already on disk.
 */
export async function importImage(sourceUrl, imageDir, { mirror, slug } = {}) {
  const id = imageIdFor(sourceUrl, slug);
  const file = path.join(imageDir, `${id}.webp`);
  try {
    await fs.access(file);
    return { id, file, reused: true };
  } catch {
    // not cached yet
  }
  const raw = await fetchImage(sourceUrl);
  const normalized = await normalizeImageBuffer(raw, {
    mirror: mirror ?? shouldMirror(sourceUrl),
  });
  await fs.mkdir(imageDir, { recursive: true });
  await fs.writeFile(file, normalized);
  return { id, file, reused: false };
}
