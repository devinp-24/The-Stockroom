# The Stockroom — mobile

Native iOS/Android companion to the web app, built with Expo (React Native).
Same features, same minimal dark theme, rebuilt with native mobile UI
patterns: a segmented Rotation/Scouting control, a floating action button,
a native pageSheet form, long-press-to-reorder, swipe-free delete via a
native confirm alert, and haptic feedback on key actions.

It talks to the same backend (`../server.js`) and the same `data/collection.json`
— the phone and the web app share one collection.

## Requirements

**Node 20 or newer.** Expo SDK 54's Metro uses `Array.prototype.toReversed`,
which does not exist on Node 18 — starting the bundler there fails with
`configs.toReversed is not a function` before it reads any project code:

```bash
nvm use 20
```

## Run it

1. Make sure the backend proxy is running from the project root:

   ```bash
   npm run dev:all
   ```

2. Find your computer's local IP (already set in `src/api.js` as
   `192.168.1.86` — update it if your IP changes):

   ```bash
   ipconfig getifaddr en0
   ```

3. Start the Expo dev server:

   ```bash
   cd stockroom-mobile
   npx expo start
   ```

4. Install **Expo Go** from the App Store or Play Store on your phone, make
   sure it's on the same Wi-Fi as your computer, and scan the QR code Expo
   prints (or open it manually with `exp://<your-ip>:8081`).

This machine doesn't have a full Xcode install (only the Command Line
Tools), so there's no local iOS Simulator to preview in — Expo Go on a real
device is the way to try it out on both platforms right now.

## Shared code

Logic and design tokens common to this app and the web app live in
`../shared` and are imported as `@stockroom/shared`. `metro.config.js` wires
that up (`watchFolders` + `extraNodeModules`); the web app resolves the same
specifier through a Vite alias. `src/theme.js` is now a thin adapter over
`shared/tokens.js` rather than a hand-copied duplicate of the web palette.
