import { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { normalizeProductImage, getPriceNarrative, formatPrice, primitives } from '@stockroom/shared';
import { colors, spacing, fonts } from '../theme';

// The mobile plate.
//
// The cutout and the muted wishlist state are both produced SERVER-SIDE, by
// imgix, rather than in styles. React Native does expose mixBlendMode,
// isolation and filter as ViewStyle props, but only under the New
// Architecture -- inside Expo Go they are accepted silently and do nothing,
// which is why the shoes kept their white boxes and the wishlist kept its
// full colour. Asking the image CDN to multiply against the paper and drop
// the saturation gives an identical result on any renderer.
//
// There is no hover on a touch screen, so full colour is revealed by PRESS
// AND HOLD. Both variants of a wanted pair are rendered stacked and the muted
// one is faded out on press, so the reveal is instant and nothing reflows --
// swapping the URL instead would flash and resize on first press.
const GROUND = primitives.ground.replace('#', '');

export default function Plate({ item, onInspect, size = 'large' }) {
  const [peek, setPeek] = useState(false);
  const movement = getPriceNarrative(item);
  const wanted = item.status === 'want';
  const s = size === 'small' ? small : large;
  const width = size === 'small' ? 400 : 600;

  const full = item.imageUrl
    ? normalizeProductImage(item.imageUrl, { width, blendWith: GROUND })
    : null;
  const muted = item.imageUrl
    ? normalizeProductImage(item.imageUrl, { width, blendWith: GROUND, desaturate: 60 })
    : null;

  return (
    <Pressable
      onPress={onInspect}
      onLongPress={() => {
        if (!wanted) return;
        setPeek(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPressOut={() => setPeek(false)}
      delayLongPress={200}
      style={styles.plate}
    >
      <View style={[styles.cut, s.cut]}>
        {full ? (
          <>
            <Image source={{ uri: full }} style={styles.img} resizeMode="contain" />
            {wanted && (
              <Image
                source={{ uri: muted }}
                style={[styles.img, styles.overlay, peek && styles.overlayHidden]}
                resizeMode="contain"
              />
            )}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No photo</Text>
          </View>
        )}
      </View>

      <View style={styles.caption}>
        <Text style={styles.brand} numberOfLines={1}>{item.brand}</Text>
        <Text style={[styles.model, s.model]} numberOfLines={2}>{item.model}</Text>
        <Text style={[styles.colorway, s.colorway]} numberOfLines={2}>{item.colorway || ' '}</Text>

        <View style={styles.spec}>
          <Text style={styles.price}>{formatPrice(item.price)}</Text>
          <View style={styles.specRule} />
          <Text style={styles.size}>{item.size || '—'}</Text>
        </View>

        <Text style={[styles.move, movement.flag && styles.moveFlagged]} numberOfLines={2}>
          {movement.text}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  plate: { flex: 1 },
  cut: { width: '100%', position: 'relative' },
  img: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 1 },
  overlayHidden: { opacity: 0 },

  empty: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  emptyText: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.textFaint },

  caption: {
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  brand: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginBottom: 4,
  },
  model: { fontFamily: fonts.display, textTransform: 'uppercase', color: colors.text },
  colorway: { fontFamily: fonts.regular, color: colors.textDim, marginTop: 3 },

  spec: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  price: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.text },
  specRule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  size: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },

  move: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 14, color: colors.textFaint, marginTop: 5 },
  moveFlagged: { color: colors.accent, fontFamily: fonts.semibold },
});

// Two scales, mirroring the web: holdings large, acquisitions small. Fixed
// heights per scale so no pair reads as larger than another.
const large = StyleSheet.create({
  cut: { height: 150 },
  model: { fontSize: 18, lineHeight: 19 },
  colorway: { fontSize: 12, lineHeight: 15 },
});

const small = StyleSheet.create({
  cut: { height: 96 },
  model: { fontSize: 14, lineHeight: 15 },
  colorway: { fontSize: 11, lineHeight: 14 },
});
