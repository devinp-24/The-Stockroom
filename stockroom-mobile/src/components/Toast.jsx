import { Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, fonts } from '../theme';

// Cleared to sit above the FAB (56px tall, anchored at insets.bottom +
// spacing.xl) rather than the bare safe-area inset, so the two never overlap.
export default function Toast({ message }) {
  const insets = useSafeAreaInsets();
  if (!message) return null;

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOutDown.duration(150)}
      style={[styles.toast, { bottom: insets.bottom + spacing.xl + 56 + spacing.md }]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.text,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.text,
    textAlign: 'center',
  },
});
