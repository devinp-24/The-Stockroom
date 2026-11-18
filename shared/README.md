# @stockroom/shared

Platform-agnostic code used by the web app, the mobile app, and the backend.
No dependencies and no platform imports — everything here must run unchanged
under Vite, Metro, and plain Node.

| Module | Contains |
| --- | --- |
| `tokens.js` | Design tokens. Single source of truth for colour, spacing, radii, type. |
| `kicksdb.js` | KicksDB → Stockroom field mapping, including the brand-prefix strip. |
| `images.js` | Product image URL policy (`normalizeProductImage`). |
| `pricing.js` | `getPriceInfo` — market price vs. paid/target basis. |
| `collection.js` | Stats, filtering, tag derivation, `EMPTY_PAIR`, `toStoredPair`. |
| `format.js` | `genId`, `formatPrice`, `formatWhole`. |

## How each consumer resolves it

| Consumer | Mechanism |
| --- | --- |
| Web (Vite) | `resolve.alias` + `server.fs.allow` in `stockroom-app/vite.config.js` |
| Mobile (Metro) | `watchFolders` + `extraNodeModules` in `stockroom-mobile/metro.config.js` |
| Backend / scripts (Node) | relative import (`../shared/…`) — no alias available |

## Design tokens

`tokens.js` is the source; **do not edit `stockroom-app/src/styles/tokens.css` by hand.**
After changing tokens, regenerate the CSS custom properties:

```bash
node scripts/build-tokens.mjs
```

Mobile imports `tokens.js` directly via `src/theme.js`, so it needs no build step.

`ACTIVE_THEME` selects which semantic role set is emitted. It is currently
`dark` (the interim interface). Phase 1 of the redesign flips it to `light`;
that theme is already defined alongside it.
