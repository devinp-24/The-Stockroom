// Formatting and id helpers. Previously duplicated verbatim in
// stockroom-app/src/App.jsx and stockroom-mobile/src/utils.js.

export function genId() {
  return `pair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function formatPrice(price) {
  if (!price) return '—';
  const trimmed = String(price).trim();
  if (!trimmed) return '—';
  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`;
}

export function formatWhole(value) {
  return `$${Math.round(value).toLocaleString()}`;
}
