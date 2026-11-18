// Kept as a re-export so existing imports keep working. The implementations
// moved to @stockroom/shared, which the web app imports from too — these
// three functions were previously duplicated character-for-character between
// this file and stockroom-app/src/App.jsx.
export { genId, formatPrice, getPriceInfo } from '@stockroom/shared';
