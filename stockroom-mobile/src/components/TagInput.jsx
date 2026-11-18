import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, radius, spacing, fonts } from '../theme';

// Chip-style tag entry, mirroring the web app's TagInput. Typing suggests
// already-used tags so a second "Basketball" reuses the first instead of
// forking into a near-duplicate like "basketball" — the whole point of
// skipping a fixed preset list.
export default function TagInput({ value, onChange, suggestions }) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  // Set right before a suggestion chip is pressed so the input's onBlur
  // (which fires around the same moment, since tapping the chip moves
  // focus away) doesn't also commit the raw draft text as a second, wrong
  // tag — the RN equivalent of the web version's mousedown-before-blur fix.
  const suppressBlurCommitRef = useRef(false);

  const matches = draft.trim()
    ? suggestions.filter(
        (s) => s.toLowerCase().includes(draft.trim().toLowerCase()) && !value.includes(s)
      )
    : suggestions.filter((s) => !value.includes(s));

  const commitTag = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const existing = suggestions.find((s) => s.toLowerCase() === trimmed.toLowerCase());
    const tag = existing || trimmed;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };

  const removeTag = (tag) => onChange(value.filter((t) => t !== tag));

  const handleChangeText = (text) => {
    if (text.includes(',')) {
      const [before] = text.split(',');
      commitTag(before);
      return;
    }
    setDraft(text);
  };

  const handleKeyPress = ({ nativeEvent }) => {
    if (nativeEvent.key === 'Backspace' && !draft && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const handleSuggestionPress = (s) => {
    suppressBlurCommitRef.current = true;
    commitTag(s);
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.box} onPress={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <View style={styles.chip} key={tag}>
            <Text style={styles.chipText}>{tag}</Text>
            <Pressable onPress={() => removeTag(tag)} hitSlop={8} style={styles.chipRemove}>
              <X size={11} color={colors.accentStrong} />
            </Pressable>
          </View>
        ))}
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onSubmitEditing={() => commitTag(draft)}
          blurOnSubmit={false}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (!suppressBlurCommitRef.current && draft.trim()) commitTag(draft);
            suppressBlurCommitRef.current = false;
            setFocused(false);
          }}
          placeholder={value.length === 0 ? 'Basketball, Lifestyle, Cleats…' : ''}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
      </Pressable>
      {focused && matches.length > 0 && (
        <View style={styles.suggestions}>
          {matches.slice(0, 8).map((s) => (
            <Pressable
              key={s}
              onPressIn={() => handleSuggestionPress(s)}
              style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionChipPressed]}
            >
              <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.accentTint,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 4,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accentStrong,
  },
  chipRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 100,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestionChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionChipPressed: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  suggestionText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.textDim,
  },
});
