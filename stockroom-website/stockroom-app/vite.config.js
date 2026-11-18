import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// repo root: stockroom-app -> stockroom-website -> .
const SHARED = path.resolve(__dirname, '../../shared')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Same specifier the mobile app uses (see stockroom-mobile/metro.config.js),
      // so shared imports read identically on both clients.
      '@stockroom/shared': SHARED,
    },
  },
  server: {
    fs: {
      // shared/ lives above this project root; Vite refuses to serve files
      // outside the root unless they are explicitly allowed.
      allow: [__dirname, SHARED],
    },
  },
})
