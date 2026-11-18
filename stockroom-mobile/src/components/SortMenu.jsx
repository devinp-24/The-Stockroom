import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { colors, spacing, fonts } from '../theme';

// A sort control drawn by this app rather than by the OS picker, matching the
// web's listbox. Presented as a bottom sheet, which is the native-feeling
// equivalent of the web dropdown.
export default function SortMenu({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ids = Object.keys(options);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={styles.triggerLabel}>Sort</Text>
        <Text style={styles.triggerValue}>{options[value].label}</Text>
        <ChevronDown size={13} color={colors.textFaint} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Sort by</Text>
            {ids.map((id) => {
              const selected = id === value;
              return (
                <Pressable
                  key={id}
                  onPress={() => { onChange(id); setOpen(false); }}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                >
                  <Text style={[styles.optionText, selected && styles.optionSelected]}>
                    {options[id].label}
                  </Text>
                  {selected && <Check size={15} color={colors.text} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  triggerLabel: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  triggerValue: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.text },

  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  optionPressed: { opacity: 0.6 },
  optionText: { fontFamily: fonts.regular, fontSize: 15, color: colors.textDim },
  optionSelected: { fontFamily: fonts.semibold, color: colors.text },
});
