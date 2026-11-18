// Collection-wide derived values. This block of arithmetic existed twice,
// character for character, in App.jsx and StockroomScreen.jsx.

export const EMPTY_PAIR = {
  id: null,
  brand: '',
  model: '',
  colorway: '',
  size: '',
  status: 'owned',
  price: '',
  imageUrl: '',
  notes: '',
  tags: [],
  kicksId: null,
  sku: '',
  marketPrice: null,
  marketPriceUpdatedAt: null,
  addedAt: null,
  // When the pair was actually bought, as distinct from when it was first
  // filed. Optional: records that predate the field simply have none, so no
  // migration is required.
  acquiredAt: null,
  // A personal score out of 10, to one decimal place. Deliberately null rather
  // than 0 when unset: an unrated pair is not a pair rated zero, and the
  // difference matters to both the sort and the display. Every record that
  // predates the field reads as null, so nothing needed migrating.
  rating: null,
};

/**
 * Coerce whatever a rating field produced into a stored rating.
 *
 * Returns null for anything blank or unparseable, so clearing the box removes
 * the rating rather than storing 0. Clamped to 0-10 and rounded to one decimal,
 * which is the precision the input offers.
 */
export function normalizeRating(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
}

/** Display form: "8.5", "9" for a whole number, "—" when unrated. */
export function formatRating(rating) {
  if (typeof rating !== 'number' || Number.isNaN(rating)) return '—';
  return String(Math.round(rating * 10) / 10);
}

const numeric = (value) => {
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
};

const hasLiveMarketPrice = (item) =>
  typeof item.marketPrice === 'number' && item.marketPrice > 0;

/**
 * Every headline figure the two clients display. Value sums whatever is
 * trustworthy per pair — the live market price when KicksDB has one,
 * otherwise what was paid — so the total stays meaningful for pairs that
 * were never looked up.
 */
export function getCollectionStats(items) {
  const owned = items.filter((i) => i.status === 'owned');
  const wanted = items.filter((i) => i.status === 'want');

  const collectionValue = owned.reduce(
    (sum, i) => sum + (hasLiveMarketPrice(i) ? i.marketPrice : numeric(i.price)),
    0
  );
  const totalPaid = owned.reduce((sum, i) => sum + numeric(i.price), 0);

  const brandCounts = owned.reduce((acc, i) => {
    if (!i.brand) return acc;
    acc[i.brand] = (acc[i.brand] || 0) + 1;
    return acc;
  }, {});
  const [topBrand = null, topBrandCount = 0] =
    Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0] || [];

  // Prefers real add timestamps, falling back to reverse insertion order for
  // pairs that predate the addedAt field.
  const freshPickup =
    [...owned].reverse().sort((a, b) => {
      const at = a.addedAt ? new Date(a.addedAt).getTime() : 0;
      const bt = b.addedAt ? new Date(b.addedAt).getTime() : 0;
      return bt - at;
    })[0] || null;

  return {
    ownedCount: owned.length,
    wantCount: wanted.length,
    ownedItems: owned,
    collectionValue,
    totalPaid,
    valueDelta: collectionValue - totalPaid,
    hasTrackedValue: owned.some(hasLiveMarketPrice),
    topBrand,
    topBrandCount,
    freshPickup,
  };
}

/** Every tag used anywhere, for add/edit autocomplete. */
export function getAllTags(items) {
  return Array.from(new Set(items.flatMap((i) => i.tags || []))).sort((a, b) =>
    a.localeCompare(b)
  );
}

/** Tags present in one tab only — a chip that would empty the list is noise. */
export function getTagsInTab(items, tab) {
  return Array.from(
    new Set(items.filter((i) => i.status === tab).flatMap((i) => i.tags || []))
  ).sort((a, b) => a.localeCompare(b));
}

export const REGISTERS = ['all', 'owned', 'want'];

/**
 * Register + free-text filtering.
 *
 * `register` may be 'all', in which case status is not filtered at all --
 * possible only since status became a treatment of the photograph rather than
 * a badge, so owned and wanted can share one grid and still be told apart.
 *
 * The query matches tags and SKU as well as the name fields. That is what
 * replaced the tag chip row: one tag covered 88 of 95 records, so the chips
 * could not discriminate, while typing "deadstock" or "kobe 5" now narrows
 * properly. The backfill is what made this work -- before it, `model` held the
 * whole brand-prefixed title and `colorway` was empty on every record.
 */
export function filterItems(items, { register, tab, query = '', selectedTags = [] }) {
  const scope = register ?? tab ?? 'all';
  const q = query.trim().toLowerCase();
  return items
    .filter((i) => (scope === 'all' ? true : i.status === scope))
    .filter((i) => {
      if (!q) return true;
      const haystack = [
        i.brand,
        i.model,
        i.colorway,
        i.sku,
        ...(i.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .filter((i) => {
      if (selectedTags.length === 0) return true;
      const itemTags = i.tags || [];
      return selectedTags.every((t) => itemTags.includes(t));
    });
}

export const SORTS = {
  added: { label: 'Recently added' },
  rating: { label: 'My rating, high to low' },
  price: { label: 'Price, high to low' },
  brand: { label: 'Brand' },
  silhouette: { label: 'Silhouette' },
  manual: { label: 'My order' },
};

/**
 * Natural-order string compare: "Curry 2" sorts before "Curry 11".
 *
 * Plain localeCompare reads the model names character by character, so on any
 * signature line that ran past ten models the second digit decided the order --
 * "Curry 11" landed next to "Curry 1", ahead of "Curry 2". Numeric collation
 * compares the runs of digits as numbers instead. `sensitivity: 'base'` keeps
 * casing and accents from splitting a line ("Air Force" / "AIR FORCE").
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareText = (a, b) => collator.compare(a || '', b || '');

/**
 * `manual` returns the array untouched so drag-ordering stays the default and
 * keeps working; every other sort is a view over it.
 */
export function sortItems(items, sort) {
  if (!sort || sort === 'manual') return items;
  const copy = [...items];
  const value = (i) => (i.marketPrice > 0 ? i.marketPrice : parseFloat(i.price) || 0);
  switch (sort) {
    case 'added':
      return copy.sort((a, b) => {
        const at = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const bt = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return bt - at;
      });
    case 'rating':
      // Unrated pairs sink to the bottom rather than sorting as zero, and hold
      // their existing order among themselves -- with most of the collection
      // unrated, letting them interleave with the 1s and 2s would bury the
      // ratings this sort exists to surface.
      return copy.sort((a, b) => {
        const ar = typeof a.rating === 'number' ? a.rating : null;
        const br = typeof b.rating === 'number' ? b.rating : null;
        if (ar === null && br === null) return 0;
        if (ar === null) return 1;
        if (br === null) return -1;
        return br - ar;
      });
    case 'price':
      return copy.sort((a, b) => value(b) - value(a));
    case 'brand':
      return copy.sort(
        (a, b) => compareText(a.brand, b.brand) || compareText(a.model, b.model)
      );
    case 'silhouette':
      return copy.sort(
        (a, b) => compareText(a.model, b.model) || compareText(a.colorway, b.colorway)
      );
    default:
      return copy;
  }
}

/** The live ticker lines. Every line is derived from real data. */
export function getTickerLines(stats) {
  const { ownedCount, wantCount, collectionValue, totalPaid, hasTrackedValue, topBrand, topBrandCount, freshPickup } =
    stats;
  return [
    `${ownedCount} PAIR${ownedCount === 1 ? '' : 'S'} IN THE STOCKROOM`,
    hasTrackedValue
      ? `EST. VALUE $${Math.round(collectionValue).toLocaleString()}`
      : totalPaid > 0
      ? `$${Math.round(totalPaid).toLocaleString()} INVESTED`
      : null,
    `${wantCount} ON THE WANT LIST`,
    topBrand ? `TOP BRAND — ${topBrand.toUpperCase()} × ${topBrandCount}` : null,
    freshPickup ? `LATEST PICKUP — ${freshPickup.brand} ${freshPickup.model}`.toUpperCase() : null,
  ].filter(Boolean);
}

/** Normalize a form payload into a stored record. */
export function toStoredPair(form, { generateId }) {
  // A form carrying an id is an EDIT of an existing pair. That distinction
  // decides `addedAt` below: stamping "now" on every save would mean editing
  // an old record -- to add a rating, say -- silently re-dates it as filed
  // today, and "Recently added" would end up showing edit order instead.
  const isNew = !form.id;
  return {
    id: form.id || generateId(),
    brand: form.brand.trim(),
    model: form.model.trim(),
    colorway: (form.colorway || '').trim(),
    size: form.size.trim(),
    status: form.status,
    price: form.price.trim(),
    imageUrl: form.imageUrl.trim(),
    notes: form.notes.trim(),
    tags: form.tags || [],
    kicksId: form.kicksId || null,
    sku: form.sku || '',
    marketPrice: typeof form.marketPrice === 'number' ? form.marketPrice : null,
    marketPriceUpdatedAt: form.marketPriceUpdatedAt || null,
    addedAt: form.addedAt || (isNew ? new Date().toISOString() : null),
    acquiredAt: form.acquiredAt || null,
    rating: normalizeRating(form.rating),
  };
}
