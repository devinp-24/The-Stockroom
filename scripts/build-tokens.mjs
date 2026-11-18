// Generates stockroom-app/src/styles/tokens.css from shared/tokens.js so the
// web CSS and the mobile theme can never drift apart again.
//
//   node scripts/build-tokens.mjs
//
// Run it after editing shared/tokens.js and commit the output.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { primitives, neutral, colors, radius, spacing, fonts, ACTIVE_THEME } from '../shared/tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'stockroom-website', 'stockroom-app', 'src', 'styles', 'tokens.css');

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const block = (title, lines) => `  /* ${title} */\n${lines.map((l) => `  ${l}`).join('\n')}\n`;

const css = `/* GENERATED FILE — do not edit.
 * Source: shared/tokens.js
 * Rebuild: node scripts/build-tokens.mjs
 * Active theme: ${ACTIVE_THEME}
 */

:root {
${block(
  'Primitives',
  Object.entries(primitives).map(([k, v]) => `--${k}: ${v};`)
)}
${block(
  'Warm neutral scale',
  Object.entries(neutral).map(([k, v]) => `--neutral-${k}: ${v};`)
)}
${block(
  `Semantic roles (${ACTIVE_THEME})`,
  Object.entries(colors).map(([k, v]) => `--${kebab(k)}: ${v};`)
)}
${block(
  'Radii',
  Object.entries(radius).map(([k, v]) => `--radius-${k}: ${typeof v === 'number' ? `${v}px` : v};`)
)}
${block(
  'Spacing',
  Object.entries(spacing).map(([k, v]) => `--space-${k}: ${v}px;`)
)}
${block(
  'Type',
  Object.entries(fonts).map(([k, v]) => `--font-${kebab(k)}: ${v};`)
)}}
`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, css);
console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${css.length} bytes, theme: ${ACTIVE_THEME})`);
