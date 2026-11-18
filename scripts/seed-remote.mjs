// Copy a local stockroom onto a deployed server, once.
//
//   STOCKROOM_URL=https://your-app.up.railway.app \
//   STOCKROOM_TOKEN=<owner token> \
//   node scripts/seed-remote.mjs [path/to/stockroom-website/data]
//
// Sends the collection, the price history and every stored photo. Stored
// image URLs that point at the old local server (http://localhost:8787/...)
// are rewritten to server-relative paths, so they work on any host.
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.STOCKROOM_URL || '').replace(/\/$/, '');
const TOKEN = process.env.STOCKROOM_TOKEN || '';
const DATA = path.resolve(process.argv[2] || 'stockroom-website/data');
if (!BASE || !TOKEN) {
  console.error('Set STOCKROOM_URL and STOCKROOM_TOKEN first.');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${TOKEN}` };
async function send(method, route, body, type = 'application/json') {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { ...auth, 'Content-Type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body,
  });
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+):\d+(?=\/api\/images\/)/;
const items = JSON.parse(await fs.readFile(path.join(DATA, 'collection.json'), 'utf8'))
  .map((pair) => ({ ...pair, imageUrl: (pair.imageUrl || '').replace(LOCAL_ORIGIN, '') }));
await send('PUT', '/api/collection', { items });
console.log(`collection: ${items.length} pairs`);

try {
  const history = JSON.parse(await fs.readFile(path.join(DATA, 'price-history.json'), 'utf8'));
  await send('PUT', '/api/price-history', { history });
  console.log(`price history: ${Object.keys(history).length} pairs`);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const files = (await fs.readdir(path.join(DATA, 'images')).catch(() => [])).filter((f) => f.endsWith('.webp'));
let done = 0;
for (let i = 0; i < files.length; i += 8) {
  await Promise.all(files.slice(i, i + 8).map(async (f) => {
    const body = await fs.readFile(path.join(DATA, 'images', f));
    await send('PUT', `/api/images/stored/${f.replace(/\.webp$/, '')}`, body, 'image/webp');
    done += 1;
  }));
  process.stdout.write(`\rphotos: ${done}/${files.length}`);
}
console.log('\ndone');
