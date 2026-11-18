// React Native has no CSS custom properties, so the shared tokens are
// re-exported here in the shape StyleSheet wants.
//
// This file used to be a hand-typed copy of the web app's CSS variables,
// which is exactly how the two clients drifted apart. It is now a thin
// adapter: every value comes from shared/tokens.js, and the web's
// styles/tokens.css is generated from that same file.

import {
  colors as sharedColors,
  primitives,
  neutral,
  radius as sharedRadius,
  spacing as sharedSpacing,
  fontFamilyNative,
} from '@stockroom/shared';

export const colors = sharedColors;
export const radius = sharedRadius;
export const spacing = sharedSpacing;
export const fonts = fontFamilyNative;

// Available for anything that needs to reach past the semantic layer.
export { primitives, neutral };
