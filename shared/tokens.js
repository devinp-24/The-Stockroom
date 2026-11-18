// Design tokens — the single source of truth for both clients.
//
// Web consumes these as CSS custom properties via src/styles/tokens.css,
// which is GENERATED from this file by scripts/build-tokens.mjs. Mobile
// imports this module directly (src/theme.js re-exports it in the shape
// React Native's StyleSheet wants). Never edit tokens.css by hand and never
// hardcode a hex value in a component — change it here and regenerate.
//
// The palette is deliberately small: four primitives, one chromatic colour.
// The previous system used Tailwind's default emerald-400 / blue-400 /
// red-400 / zinc-400 plus an orange accent, with every coloured surface
// derived by the same rgba(x, 0.14) formula. That has been removed.

// ---------------------------------------------------------------------------
// Primitives — the four colours the archive direction is built from.
// ---------------------------------------------------------------------------
export const primitives = {
  ground: '#EFEDE7', // paper
  ink: '#131311', // type
  rule: '#D5D1C7', // hairline
  signal: '#C0341A', // the only chromatic colour in the system
};

// ---------------------------------------------------------------------------
// Neutral scale — warm, derived between ink and ground. Replaces the cold
// zinc greys. Numbers run dark (950) to light (050) like a type scale.
// ---------------------------------------------------------------------------
export const neutral = {
  950: '#0B0B0A',
  900: '#131311', // === primitives.ink
  850: '#1A1A18',
  800: '#232320',
  700: '#2D2D29',
  600: '#3A3A35',
  500: '#6F6C64',
  400: '#8B8880',
  300: '#A8A49B',
  200: '#D5D1C7', // === primitives.rule
  100: '#E4E1DA',
  50: '#EFEDE7', // === primitives.ground
};

export const signalScale = {
  base: '#C0341A',
  strong: '#D9573B',
  tint: 'rgba(192, 52, 26, 0.16)',
};

// ---------------------------------------------------------------------------
// Semantic roles.
//
// `light` is the archive theme and the one both clients render. `dark` is
// kept as the pre-Phase-1 shell, already repainted onto this palette — it is
// a working alternative, not dead code, and switching ACTIVE_THEME is the
// only change needed to render it.
// ---------------------------------------------------------------------------
export const themes = {
  dark: {
    bg: neutral[950],
    surface: neutral[850],
    surfaceRaised: neutral[800],
    surfaceSunken: neutral[700],

    border: 'rgba(239, 237, 231, 0.10)',
    borderStrong: 'rgba(239, 237, 231, 0.18)',
    // Contextual hairline. Named `hairline`, not `rule`, so it cannot
    // collide with the `--rule` primitive when tokens.css is generated.
    hairline: '#2E2E2A',

    text: primitives.ground,
    textDim: neutral[300],
    textFaint: neutral[500],

    accent: signalScale.base,
    accentStrong: signalScale.strong,
    accentTint: signalScale.tint,
    // Only consumed by the hero radial wash and the card hover shadow, both
    // of which Phase 1 deletes.
    accentGlow: 'rgba(192, 52, 26, 0.32)',

    // Backdrops. Previously hardcoded as rgba(12,12,14,x) in six places.
    scrim: 'rgba(11, 11, 10, 0.65)',
    overlay: 'rgba(11, 11, 10, 0.72)',

    // Status is a presence/absence distinction, not a hue distinction:
    // owned reads at full strength, wanted reads muted. Phase 1 replaces
    // these marks entirely with full-colour vs. silhouette treatment.
    statusOwned: primitives.ground,
    statusOwnedTint: 'rgba(239, 237, 231, 0.10)',
    statusWant: neutral[300],
    statusWantTint: 'rgba(239, 237, 231, 0.05)',

    // One chromatic signal. A favourable movement is simply neutral type;
    // only the unfavourable case earns colour.
    priceUp: primitives.ground,
    priceUpTint: 'rgba(239, 237, 231, 0.08)',
    priceDown: signalScale.strong,
    priceDownTint: signalScale.tint,
    priceNeutral: neutral[500],
    priceNeutralTint: 'rgba(239, 237, 231, 0.05)',

    danger: signalScale.strong,
    dangerTint: signalScale.tint,

    onAccent: primitives.ground,
  },

  light: {
    bg: primitives.ground,
    surface: '#F5F3EF',
    surfaceRaised: neutral[100],
    surfaceSunken: neutral[200],

    border: 'rgba(19, 19, 17, 0.12)',
    borderStrong: 'rgba(19, 19, 17, 0.24)',
    hairline: primitives.rule,

    text: primitives.ink,
    textDim: neutral[500],
    textFaint: neutral[400],

    accent: signalScale.base,
    accentStrong: '#9E2915',
    accentTint: signalScale.tint,
    accentGlow: 'rgba(192, 52, 26, 0.24)',

    scrim: 'rgba(19, 19, 17, 0.55)',
    overlay: 'rgba(19, 19, 17, 0.32)',

    statusOwned: primitives.ink,
    statusOwnedTint: 'rgba(19, 19, 17, 0.08)',
    statusWant: neutral[400],
    statusWantTint: 'rgba(19, 19, 17, 0.04)',

    priceUp: primitives.ink,
    priceUpTint: 'rgba(19, 19, 17, 0.06)',
    priceDown: signalScale.base,
    priceDownTint: signalScale.tint,
    priceNeutral: neutral[400],
    priceNeutralTint: 'rgba(19, 19, 17, 0.04)',

    danger: signalScale.base,
    dangerTint: signalScale.tint,

    onAccent: primitives.ground,
  },
};

// The theme rendered by both clients. Flipped to 'light' in Phase 1.1: the
// paper ground is the mechanism behind the archive direction, not a taste
// call -- mix-blend-mode:multiply is what dissolves the white box baked into
// every StockX product photograph, and that only works over a light ground.
export const ACTIVE_THEME = 'light';
export const colors = themes[ACTIVE_THEME];

// ---------------------------------------------------------------------------
// Non-colour tokens.
// ---------------------------------------------------------------------------
export const radius = {
  none: 0,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 22,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
};

// Typography. One variable family covering every role. Archivo's width axis supplies the
// condensed display cuts and its tabular figures carry every price, so there
// is no second face to keep in sync. Bebas Neue is retired.
export const fonts = {
  body: "'Archivo', system-ui, -apple-system, sans-serif",
  display: "'Archivo', system-ui, sans-serif",
};

// React Native cannot drive Archivo's variable width axis, so the condensed
// display cut comes from Archivo Narrow -- the same superfamily, and the
// closest available match to the web's font-stretch: 70%.
export const fontFamilyNative = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  extrabold: 'Archivo_800ExtraBold',
  display: 'ArchivoNarrow_700Bold',
};
