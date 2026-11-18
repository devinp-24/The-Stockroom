// Price-refresh policy.
//
// Refreshing every tracked pair on every click cost one API request per pair —
// 95 of a 1,000/month allowance in a single press, and the same 95 again an
// hour later even though nothing could have changed. That is what exhausted
// the first account's quota.
//
// The refresh is now stale-first and capped: only pairs that have not been
// checked recently are candidates, oldest first, and never more than a batch
// at a time. The cost of a press is therefore knowable before pressing it.

export const REFRESH_POLICY = {
  // A market price younger than this is treated as current.
  maxAgeDays: 7,
  // Hard cap on how many pairs one press may spend.
  batchLimit: 25,
};

const DAY = 24 * 60 * 60 * 1000;

/** Pairs whose price can be refreshed at all — anything with a product id. */
export function getTrackablePairs(items) {
  return items.filter((i) => i.kicksId);
}

/**
 * The pairs a refresh should actually spend requests on.
 *
 * @returns {{ candidates: Array, staleCount: number, trackable: number, capped: boolean }}
 *   `staleCount` is how many are eligible; `candidates` is the capped slice
 *   that will actually be fetched. Surfacing both lets the UI say "25 of 61"
 *   instead of silently doing something different from what was asked.
 */
export function getRefreshCandidates(items, options = {}) {
  const { maxAgeDays = REFRESH_POLICY.maxAgeDays, limit = REFRESH_POLICY.batchLimit, now = Date.now() } =
    options;

  const trackable = getTrackablePairs(items);
  const cutoff = now - maxAgeDays * DAY;

  const stale = trackable
    .filter((i) => {
      if (!i.marketPriceUpdatedAt) return true; // never checked
      const t = new Date(i.marketPriceUpdatedAt).getTime();
      return Number.isNaN(t) || t < cutoff;
    })
    // oldest first, so repeated presses sweep the collection rather than
    // re-fetching the same pairs
    .sort((a, b) => {
      const at = a.marketPriceUpdatedAt ? new Date(a.marketPriceUpdatedAt).getTime() : 0;
      const bt = b.marketPriceUpdatedAt ? new Date(b.marketPriceUpdatedAt).getTime() : 0;
      return at - bt;
    });

  return {
    candidates: stale.slice(0, limit),
    staleCount: stale.length,
    trackable: trackable.length,
    capped: stale.length > limit,
  };
}

/** Most recent check across the collection, as a human phrase. */
export function describeLastChecked(items, now = Date.now()) {
  const times = items
    .map((i) => (i.marketPriceUpdatedAt ? new Date(i.marketPriceUpdatedAt).getTime() : null))
    .filter((t) => t && !Number.isNaN(t));
  if (times.length === 0) return 'never checked';

  const days = Math.floor((now - Math.max(...times)) / DAY);
  if (days <= 0) return 'checked today';
  if (days === 1) return 'checked yesterday';
  return `checked ${days} days ago`;
}

/**
 * What a press would cost, phrased for a button.
 *
 * Deliberately terse: this sits in a toolbar beside the search, sort and add
 * controls, and a longer label ("Refresh 25 of 48 stale") pushed the row past
 * its width and wrapped the whole action group onto a second line. The full
 * picture lives in the control's tooltip, which has room for it.
 */
export function describeRefreshCost({ candidates, staleCount, trackable }) {
  if (trackable === 0) return 'Refresh';
  if (staleCount === 0) return 'Up to date';
  return `Refresh ${candidates.length}`;
}

/** The long form, for a tooltip or a status line. */
export function describeRefreshDetail({ candidates, staleCount, trackable, capped }) {
  if (trackable === 0) return 'No pairs are tracked yet — add them via search.';
  if (staleCount === 0) return `All ${trackable} tracked pairs were checked within the last week.`;
  return capped
    ? `${staleCount} of ${trackable} pairs are over a week old. This refreshes the ${candidates.length} oldest.`
    : `Refreshes ${candidates.length} pair${candidates.length === 1 ? '' : 's'} not checked in over a week.`;
}
