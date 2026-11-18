// Market-price comparison. Previously duplicated in App.jsx (with a tooltip
// `title`) and mobile utils.js (without one) — unified here; callers that
// have nowhere to put a tooltip just ignore the field.
//
// Owned pairs read as appreciation/depreciation against what was paid.
// Wishlist pairs read as above/below the target price — a buy signal once
// the market falls to what you're willing to pay.

/**
 * @returns {null | { tone: 'up'|'down'|'neutral', label: string, title: string }}
 *   `tone: 'up'` always means "favourable to you", which for a wishlist pair
 *   means the price went DOWN. The current UI renders that with an upward
 *   arrow, which reads backwards; Phase 1 states the movement in words
 *   instead. The semantics are kept as-is here so behaviour is unchanged.
 */
export function getPriceInfo(item) {
  if (typeof item.marketPrice !== 'number') return null;

  // KicksDB returns 0 rather than omitting the field when a pair has no
  // active listings. Treating that as a real price produced nonsense deltas —
  // e.g. a 100% "decline" for pairs that simply have nothing listed.
  if (item.marketPrice <= 0) {
    return {
      tone: 'neutral',
      label: 'No price data available',
      title: 'No active listings were found the last time prices were refreshed.',
    };
  }

  const basis = parseFloat(item.price);
  const hasBasis = item.price !== '' && !Number.isNaN(basis);
  const marketLabel = `$${Math.round(item.marketPrice)}`;
  const updatedTitle = item.marketPriceUpdatedAt
    ? `Market price as of ${new Date(item.marketPriceUpdatedAt).toLocaleString()}`
    : 'Market price';

  if (!hasBasis) {
    return { tone: 'neutral', label: `Market ${marketLabel}`, title: updatedTitle };
  }

  const delta = item.marketPrice - basis;
  const pct = basis !== 0 ? Math.abs((delta / basis) * 100) : 0;

  if (item.status === 'owned') {
    const up = delta >= 0;
    return {
      tone: up ? 'up' : 'down',
      label: `${up ? '+' : '−'}$${Math.abs(Math.round(delta))} (${pct.toFixed(0)}%) · now ${marketLabel}`,
      title: updatedTitle,
    };
  }

  const underTarget = delta <= 0;
  return {
    tone: underTarget ? 'up' : 'down',
    label: underTarget
      ? `$${Math.abs(Math.round(delta))} under target · now ${marketLabel}`
      : `$${Math.abs(Math.round(delta))} over target · now ${marketLabel}`,
    title: updatedTitle,
  };
}

/**
 * The same comparison stated as a sentence, for surfaces that show movement as
 * type rather than as a coloured arrow pill.
 *
 * `flag` is deliberately narrow. The old `tone` field coloured every
 * unfavourable movement, which lit up 61 of 95 real records -- being priced
 * out is the resting state of a wishlist (59 of 77 pairs), so colouring it
 * drowned the signal. Here `flag` means one thing only: this pair has fallen
 * to what you said you would pay. It fires on 16 of 95, and every one is an
 * actual buy decision.
 *
 * @returns {{ text: string, flag: boolean }}
 */
export function getPriceNarrative(item) {
  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const market = item.marketPrice;

  if (typeof market !== 'number' || market <= 0) {
    return { text: 'No active listings', flag: false };
  }

  const basis = parseFloat(item.price);
  if (item.price === '' || Number.isNaN(basis)) {
    return { text: `Market ${money(market)}`, flag: false };
  }

  const delta = market - basis;

  if (item.status === 'owned') {
    if (delta === 0) return { text: `Holding at ${money(market)}`, flag: false };
    return delta > 0
      ? { text: `Up ${money(delta)} since purchase, now ${money(market)}`, flag: false }
      : { text: `Down ${money(-delta)} since purchase, now ${money(market)}`, flag: false };
  }

  return delta <= 0
    ? { text: `Within reach at ${money(market)}, against your ${money(basis)}`, flag: true }
    : { text: `${money(delta)} over target, now ${money(market)}`, flag: false };
}
