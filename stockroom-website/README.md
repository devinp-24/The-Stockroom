# Sneaker Search Proxy

A tiny backend that holds your KicksDB API key and exposes a clean
`GET /api/search?q=...` endpoint for The Stockroom's search-to-add feature.

## Why this exists

KicksDB (like every sneaker-data API) requires a secret key. That key can't
live in frontend code — anyone viewing the page's source could read it out
of the JS and burn through your quota. This proxy sits between your
frontend and KicksDB: the frontend calls *this* server, and this server
calls KicksDB with the key attached server-side, where it stays hidden.

## Setup

1. Create a free KicksDB account: https://kicks.dev/register
   The free tier includes 1,000 requests/month — plenty for personal use.
2. Grab your API key from the KicksDB dashboard.
3. `cp .env.example .env` and paste your key in.
4. `npm install`
5. `npm run dev`
6. Test it: `curl "http://localhost:8787/api/search?q=kobe%206"`

## One thing to verify before you build on this

The route, base URL (`https://api.kicks.dev/v3/{platform}/products`), and
auth header (`Authorization: <api-key>`, no "Bearer" prefix) are all
confirmed against KicksDB's docs. The exact query-string parameter for
*keyword search* — I used `query` — is the one detail I couldn't fully
verify from outside their docs site. Before relying on this, check
https://docs.kicks.dev's search/listing page and adjust the one line in
`server.js` if the param name differs. Claude Code can fetch those docs
directly and fix it in seconds if needed.

## Sneakers only

StockX's catalogue is not a sneaker catalogue — it also carries streetwear
and collectibles, and for some queries those crowd the shoes out entirely.
Measured against `limit=30`:

| query          | sneakers, unfiltered | sneakers, filtered |
| -------------- | -------------------- | ------------------ |
| `travis scott` | 1 / 30               | 30 / 30            |
| `yeezy`        | 0 / 30               | 29 / 30            |
| `supreme`      | 0 / 30               | 30 / 30            |

So `/api/search` sends `&product_type=sneakers` and *also* re-checks
`product_type` on the way back, in `isSneakerProduct` (`shared/kicksdb.js`).
Both, because KicksDB **ignores query parameters it does not recognise
instead of rejecting them** — `type=`, `categories=` and
`filter[product_type]=` all return cheerfully unfiltered results. A renamed
parameter would put the trading cards back without any error to notice, so
the outgoing pass is what actually holds the guarantee and the parameter is
what makes it cheap (30 sneakers per request rather than 30 rows of which a
few are sneakers).

That predicate also vetoes anything whose `categories` include `apparel`,
which catches the handful of rows KicksDB types as `sneakers` while
describing them as clothing — "Yeezy Calabasas Socks" was the only one in a
427-row survey. It deliberately *keeps* a product whose `product_type` is
missing entirely, so if that field ever disappears the search degrades to
noisy rather than empty.

## A second catalogue: antosports

StockX does not carry the Chinese basketball brands, so Anta, Li-Ning, 361,
Peak, Xtep, Rigorer and Qiaodan pairs had to be typed in by hand with a pasted
image URL. antosports.com is a Shopify store, and every Shopify store
publishes its whole catalogue at `/products.json` — 2,750 products carrying
brand, silhouette, colourway, price, SKU and photography.

`lib/antosports.mjs` reads it (paged, rate-limit aware, cached to
`data/antosports-catalogue.json` for a day) and maps it into the same shape
`normalizeKicksProduct` produces. `/api/search` interleaves the two sources so
one search covers both, and an antosports failure never takes StockX results
down with it.

Note the title parsing does **not** use Shopify's `product_type`: it reads
"Anta Klay Thompson Kt1" for a product titled "Anta Klay Thompson Kt1 Pro -
LA", which puts the "Pro" in the colourway. The titles are punctuated
consistently enough to split directly, on a dash or a quoted nickname.

## Image normalization

Every StockX asset is shot toe-right and tightly trimmed. Nothing else is.
antosports shoots toe-LEFT on a near-square canvas where the shoe covers ~35%
of the frame, so left alone those pairs render mirrored and about half the size
of everything around them.

imgix fixes the StockX side from query parameters. There is no imgix in front
of Shopify, so `lib/image-pipeline.mjs` is the local equivalent — sharp does
the trim, flip and resize once, and the result is stored in `data/images/`.
`GET /api/images/proxy?url=…` takes the same knobs imgix does (`w`, `blend`,
`sat`), so mobile gets its paper-multiply server-side exactly as it does for
StockX. First hit for an image downloads and normalizes it (~0.3–0.6s); every
later one is served from disk.

Stored records keep the **raw** supplier URL. The rewrite happens on read, via
`configureImageProxy()` in `shared/images.js`, so the data stays portable and
each client can point at whichever address it reaches this server on.

`POST /api/images/upload` does the same for a photo dropped into the add form,
for a pair neither catalogue carries. Mirroring is off by default there — an
arbitrary photo has no known orientation convention.

### Bulk import

    node scripts/import-antosports-images.mjs --preset kt --out ./anta-kt
    node scripts/import-antosports-images.mjs --match "li-ning wade" --out ./wade

Pulls every catalogue match, writes Stockroom-ready cutouts named after the
product, and drops a `_manifest.json` alongside them. Re-running skips whatever
is already there.

`--match` requires every word to appear. That is too blunt for a whole
signature line: `--match "anta kt"` silently drops the Klay Thompson Light
Cavalry and Shock The Game shoes, which carry his name but never the letters
KT. `--preset kt` uses a regex covering the numbered line, the KT-prefixed
sub-lines and the name-only shoes, and requires an Anta/Klay signal so it does
not also match merchandise for the esports team called KT.

Both paths skip apparel, judged from `product_type` and never from the title —
"KT5 Third Jersey" is a shoe COLOURWAY, and a title-based filter throws it away.

### A pagination trap worth knowing

`/products.json` gives no total and no "last page" flag; a short page is the
only end-of-catalogue signal. An early version capped the loop just above the
then-current page count and truncated the catalogue at 2,750 of 3,931 products
— losing the entire KT10 generation and the whole KT Splash 7.0 line with no
error to notice. `MAX_PAGES` now sits far above the real count, and stopping at
the cap with a full final page logs a loud warning.

## Wiring it to The Stockroom

In the tracker's "Add pair" form, add a search box above the manual fields.
On each keystroke (debounce ~300ms), call:

```js
fetch(`http://localhost:8787/api/search?q=${encodeURIComponent(query)}`)
  .then((r) => r.json())
  .then(({ results }) => setSearchResults(results));
```

Render `results` as a small dropdown or grid of thumbnails + names. When
the person clicks one, populate the form (`brand`, `model`, `colorway`,
`sku`→ fold into notes or a new field, `imageUrl`) from that result instead
of typing it — then they just set size, price, status, and notes, and hit
save like today.

## Multi-platform note

KicksDB unifies StockX, GOAT, Flight Club, Stadium Goods, and KicksCrew
behind the same `/v3/{platform}/products` shape. This starter defaults to
`stockx` (deepest catalog) — swap the `PLATFORM` constant in `server.js`,
or turn it into a query param, if you want to search a different source.

## Deploying

For local use, `npm run dev` is enough. To use this from a deployed
version of The Stockroom, deploy this proxy somewhere with a persistent
process (Render, Railway, Fly.io, a VPS) and point the frontend `fetch`
call at that URL instead of `localhost`.
