# The Stockroom

My sneaker collection and wishlist in one place: 24 pairs I own and 800+ I
want, so nothing I'm chasing gets forgotten and I can go through every option
before I buy.

**Live (read-only):** [the-stockroom-production.up.railway.app](https://the-stockroom-production.up.railway.app)

It has three parts, which share a single backend and a platform-agnostic
`shared/` package:

| Part | What it is |
| --- | --- |
| `stockroom-website/` | Express server: the collection API, KicksDB search proxy, price history and an image pipeline (sharp). In production it also serves the web app. |
| `stockroom-website/stockroom-app/` | The web app (React + Vite). |
| `stockroom-mobile/` | iOS/Android companion (React Native, Expo). |
| `shared/` | Pure logic and design tokens used by all three. |

Two other clients talk to the same API:
[collections-mcp](https://github.com/devinp-24/collections-mcp) lets Claude
read and update the collection, and
[stockroom-extension](https://github.com/devinp-24/stockroom-extension) saves a
shoe from any sneaker site in one click.

Each folder has its own README with the details: how search filters StockX
down to sneakers only, how a 3,900-product Shopify catalogue fills in the
brands StockX doesn't carry, and why photos are normalised server-side.

## Built with AI

I built this with Claude (in chat and in Claude Code), directing the design
and reviewing the code. The comments explain the bugs found along the way,
such as the 100 kB body limit that silently dropped saves once the collection
grew past ~190 pairs.

## Run it locally

```bash
cp stockroom-website/.env.example stockroom-website/.env   # add a KicksDB key
npm install --prefix stockroom-website
npm install --prefix stockroom-website/stockroom-app
npm run dev:all --prefix stockroom-website                 # API :8787, app :5173
```

With no `ADMIN_TOKEN` set, everyone can edit, which is how it runs on a laptop.

## Deploy

One Railway service runs everything: `npm run build` builds the web app and
`npm start` serves the app and the API together.

| Variable | Purpose |
| --- | --- |
| `KICKSDB_API_KEY` | search and market prices |
| `ADMIN_TOKEN` | a long random secret: without it the public copy is read-only |
| `DATA_DIR` | a mounted volume (e.g. `/data`) so the collection survives redeploys |

Copy a local collection up once with
`STOCKROOM_URL=... STOCKROOM_TOKEN=... npm run seed -- stockroom-website/data`.

## What I would harden next

This is a personal tool shipped as an MVP. It deliberately skips:

- **Auth:** one shared owner token, with no expiry or per-device revocation. Next would be real
  sign-in (OAuth or passkeys) plus scoped, revocable tokens for the extension and the MCP server.
- **Storage:** a JSON file on one volume, written atomically with rolling backups. That's fine for one
  person. Several users or concurrent editors would need Postgres.
- **Image proxy:** it only fetches from allowlisted hosts, but it has no rate limiting, so a stranger
  could make it re-render many variants.
- **Tests:** the shared logic is pure and easy to test, but it has no test suite yet.

## License

MIT
