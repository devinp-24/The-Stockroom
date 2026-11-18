// Mapping between KicksDB's product shape and a Stockroom pair.
//
// KicksDB splits a product name three ways:
//   brand           "Nike"
//   primary_title   "Nike Book 1"      <- silhouette, usually brand-prefixed
//   secondary_title "Valley"           <- the actual colorway
//   title           "Nike Book 1 Valley"
//
// The old client code filled `model` from `title` and never touched
// `colorway`, so every record ended up with the brand printed twice ("NIKE" /
// "Nike Book 1 Valley") and an empty colorway field that the card still
// reserved space for. This module is the one place that mapping is decided.

/**
 * Drop a leading brand name from a silhouette title. Case-insensitive because
 * KicksDB writes "adidas" lowercase. Not every product is prefixed — some
 * come back as "Kobe 6 Protro" with no brand — so this is conditional.
 */
export function stripBrandPrefix(brand, title) {
  if (!brand || !title) return title || '';
  const b = brand.trim();
  const t = title.trim();
  if (!b) return t;
  if (t.toLowerCase().startsWith(`${b.toLowerCase()} `)) {
    return t.slice(b.length).trim();
  }
  // Guard against a title that is nothing but the brand.
  if (t.toLowerCase() === b.toLowerCase()) return t;
  return t;
}

/**
 * KicksDB's StockX catalogue is not a sneaker catalogue. Every product carries
 * a `product_type`, and across the queries this app makes the vocabulary is
 * exactly three values: "sneakers", "streetwear" and "collectibles" — hoodies,
 * tees, trading cards, figures. A stockroom of 122 pairs has no use for the
 * other two, and unfiltered they do not merely pad the results, they take them
 * over: "travis scott" comes back 29/30 streetwear and "yeezy" returns no
 * sneakers at all in the first 30 rows.
 */
export const SNEAKER_PRODUCT_TYPE = 'sneakers';

/**
 * KicksDB's own product_type is not always right. Across 427 sneaker-typed
 * rows exactly one was not footwear -- "Yeezy Calabasas Socks", typed
 * `sneakers` while its own `categories` read ["apparel","undergarments",
 * "socks"]. The categories array is the more honest of the two fields, so it
 * gets a veto. Every genuine pair in that survey carried a footwear category
 * instead (sneakers, lifestyle, performance, shoes, luxury, clogs,
 * slides-and-sandals, heels, boots, cleats, slippers) and none was tagged
 * apparel, so this cannot cost a real pair without KicksDB changing its mind
 * about what a shoe is.
 */
const NON_FOOTWEAR_CATEGORIES = new Set(['apparel', 'undergarments']);

/**
 * Is this raw KicksDB product a sneaker?
 *
 * Deliberately lenient about a MISSING product_type. KicksDB silently ignores
 * query parameters it does not recognise rather than erroring, so a field it
 * renames one day would take the server-side filter down with it without a
 * word. If that happens this predicate stops seeing the field at all, and the
 * search degrades to showing everything — noisy, which is where this started,
 * rather than empty, which would read as the search being broken.
 */
export function isSneakerProduct(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  if (categories.some((c) => typeof c === 'string' && NON_FOOTWEAR_CATEGORIES.has(c.toLowerCase()))) {
    return false;
  }
  const type = item?.product_type;
  if (typeof type !== 'string' || type === '') return true;
  return type.toLowerCase() === SNEAKER_PRODUCT_TYPE;
}

/**
 * Normalize a raw KicksDB product into the fields the Stockroom stores.
 * Used by the backend's /api/search and by the migration when it re-fetches
 * a product by id, so both paths produce identical results.
 */
export function normalizeKicksProduct(item) {
  const brand = item.brand ?? '';
  const primary = item.primary_title ?? item.model ?? '';
  const fullTitle = item.title ?? '';

  return {
    id: item.id ?? item.slug ?? '',
    brand,
    // The silhouette, with the redundant brand prefix removed:
    // "Nike Book 1" -> "Book 1".
    model: stripBrandPrefix(brand, primary || fullTitle),
    // The colorway/nickname. There is no separate `colorway` field on
    // KicksDB — secondary_title is it.
    colorway: item.secondary_title ?? item.colorway ?? '',
    // Full "Nike Book 1 Valley" string, kept for search-result display and
    // as the fallback when a product has no primary/secondary split.
    fullTitle,
    sku: item.sku ?? item.style_id ?? '',
    imageUrl: item.image ?? (Array.isArray(item.images) ? item.images[0] : '') ?? '',
    retailPrice: item.retail_price ?? null,
    // avg_price arrives in whole dollars, not cents.
    marketPrice: typeof item.avg_price === 'number' ? item.avg_price : null,
    link: item.link ?? '',
  };
}

/**
 * The subset of fields a search result contributes to the add/edit form.
 * Both clients call this so neither can drift from the other again.
 */
export function pairFieldsFromSearchResult(result) {
  return {
    brand: result.brand || '',
    model: result.model || '',
    colorway: result.colorway || '',
    imageUrl: result.imageUrl || '',
    kicksId: result.id || null,
    sku: result.sku || '',
    marketPrice: typeof result.marketPrice === 'number' ? result.marketPrice : null,
  };
}
