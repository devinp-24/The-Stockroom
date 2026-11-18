import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { X, Search } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { normalizeProductImage, primitives } from '@stockroom/shared';
import { colors, spacing, fonts } from '../theme';
import { searchSneakers } from '../api';

// Search-first add, mirroring the web.
//
// A result IS the add: tapping one files it immediately and the panel stays
// open so a run of colourways can be added in sequence. The only thing worth
// typing afterwards is the price, offered inline on the row just added.
// Target prices are never prefilled from the market — they are a decision.
const GROUND = primitives.ground.replace('#', '');

export default function AddPanel({ visible, register, defaultSize, added, onAdd, onSetPrice, onUndo, onManual, onClose }) {
  const [status, setStatus] = useState(register === 'want' ? 'want' : 'owned');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setStatus(register === 'want' ? 'want' : 'owned');
    setTerm('');
    setResults([]);
    setError('');
  }, [visible, register]);

  useEffect(() => {
    if (!visible) return;
    const q = term.trim();
    if (debounce.current) clearTimeout(debounce.current);
    if (!q) { setResults([]); setError(''); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        setResults(await searchSneakers(q));
        setError('');
      } catch (e) {
        setError(String(e.message || e).includes('not active')
          ? 'KicksDB rejected the key. Check the account at kicks.dev.'
          : 'Could not reach the search server.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [term, visible]);

  const add = (r) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAdd(r, status);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Add pairs</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
            <X size={20} color={colors.textDim} />
          </Pressable>
        </View>

        <View style={styles.registerRow}>
          {[
            { id: 'owned', label: 'To Holdings' },
            { id: 'want', label: 'To Acquisitions' },
          ].map((r) => (
            <Pressable
              key={r.id}
              onPress={() => setStatus(r.id)}
              style={[styles.registerBtn, status === r.id && styles.registerBtnActive]}
            >
              <Text style={[styles.registerText, status === r.id && styles.registerTextActive]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.searchRow}>
          <Search size={15} color={colors.textFaint} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder="Search KicksDB — model name works best"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoFocus
            autoCorrect={false}
          />
          {loading && <ActivityIndicator size="small" color={colors.textFaint} />}
          {!!term && !loading && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <X size={15} color={colors.textFaint} />
            </Pressable>
          )}
        </View>

        {added.length > 0 && (
          <View style={styles.added}>
            <Text style={styles.addedHeading}>Added this session</Text>
            {added.map((a) => (
              <View style={styles.addedRow} key={a.id}>
                <Text style={styles.addedName} numberOfLines={1}>
                  <Text style={styles.addedModel}>{a.model}</Text> {a.colorway}
                </Text>
                <Text style={styles.addedLabel}>{a.status === 'owned' ? 'Paid' : 'Target'}</Text>
                <TextInput
                  value={a.price}
                  onChangeText={(v) => onSetPrice(a.id, v)}
                  placeholder="—"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="numbers-and-punctuation"
                  style={styles.addedInput}
                />
                <Pressable onPress={() => onUndo(a.id)} hitSlop={8}>
                  <Text style={styles.addedUndo}>Undo</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!error && !term.trim() && (
            <Text style={styles.note}>
              Type a model name — “kobe 6”, “book 1” — and every colourway KicksDB has for it appears
              here. Tapping one files it straight into {status === 'owned' ? 'Holdings' : 'Acquisitions'}.
            </Text>
          )}
          {!error && !loading && term.trim() && results.length === 0 && (
            <Text style={styles.note}>No matches. Try the model without the colourway.</Text>
          )}
          <View style={styles.grid}>
            {results.map((r, i) => (
              <Pressable
                key={r.id || `${r.sku}-${i}`}
                onPress={() => add(r)}
                style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}
              >
                <View style={styles.cut}>
                  {r.imageUrl ? (
                    <Image
                      source={{ uri: normalizeProductImage(r.imageUrl, { width: 300, blendWith: GROUND }) }}
                      style={styles.cutImg}
                      resizeMode="contain"
                    />
                  ) : null}
                </View>
                <Text style={styles.resultBrand} numberOfLines={1}>{r.brand}</Text>
                <Text style={styles.resultModel} numberOfLines={2}>{r.colorway || r.model}</Text>
                <Text style={styles.resultSub} numberOfLines={1}>{r.model}</Text>
                {typeof r.marketPrice === 'number' && r.marketPrice > 0 && (
                  <Text style={styles.resultMarket}>${Math.round(r.marketPrice).toLocaleString()}</Text>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footNote}>Size defaults to {defaultSize || '—'}</Text>
          <Pressable onPress={onManual} style={styles.manualBtn}>
            <Text style={styles.manualText}>Add manually</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: colors.text,
  },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  registerRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  registerBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  registerBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  registerText: {
    fontFamily: fonts.semibold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  registerTextActive: { color: colors.bg },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text },

  added: { paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  addedHeading: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginBottom: 6,
  },
  addedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  addedName: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, color: colors.textDim },
  addedModel: { fontFamily: fonts.semibold, color: colors.text },
  addedLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  addedInput: {
    width: 62,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
    paddingVertical: 3,
  },
  addedUndo: {
    fontFamily: fonts.semibold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },

  results: { flex: 1, marginTop: spacing.lg },
  resultsContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.textDim },
  error: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.accent },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  result: { width: '30%' },
  resultPressed: { opacity: 0.6 },
  cut: { width: '100%', height: 74 },
  cutImg: { width: '100%', height: '100%' },
  resultBrand: {
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  resultModel: { marginTop: 2, fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 14, color: colors.text },
  resultSub: { marginTop: 1, fontFamily: fonts.regular, fontSize: 10, color: colors.textFaint },
  resultMarket: { marginTop: 3, fontFamily: fonts.semibold, fontSize: 10.5, color: colors.textDim },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.text,
  },
  footNote: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  manualBtn: { borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: spacing.lg, paddingVertical: 9 },
  manualText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.textDim },
});
