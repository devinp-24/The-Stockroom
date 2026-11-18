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
  FlatList,
  StyleSheet,
} from 'react-native';
import { X, Search, ImageOff } from 'lucide-react-native';
import {
  EMPTY_PAIR,
  normalizeProductImage,
  pairFieldsFromSearchResult,
  normalizeRating,
} from '@stockroom/shared';
import { colors, radius, spacing, fonts } from '../theme';
import { searchSneakers } from '../api';
import TagInput from './TagInput';
import PhotoPicker from './PhotoPicker';

const emptyForm = EMPTY_PAIR;

export default function AddEditModal({ visible, initialItem, defaultStatus, allTags, onClose, onSave }) {
  const [form, setForm] = useState(emptyForm);
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setForm(
      initialItem
        ? { ...emptyForm, ...initialItem, tags: initialItem.tags || [] }
        : { ...emptyForm, status: defaultStatus || 'owned' }
    );
    setSearchTerm('');
    setResults([]);
    setSearchError('');
    setSearchLoading(false);
  }, [visible, initialItem, defaultStatus]);

  useEffect(() => {
    if (!visible) return;
    const trimmed = searchTerm.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setResults([]);
      setSearchError('');
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchSneakers(trimmed);
        setResults(res);
        setSearchError('');
      } catch (e) {
        setSearchError('Could not reach the search server — is it running on :8787?');
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm, visible]);

  // Mapping lives in @stockroom/shared/kicksdb — same function the web app
  // calls. `model` is the silhouette with the brand prefix stripped and
  // `colorway` is KicksDB's secondary_title, which this used to drop.
  const selectResult = (result) => {
    const fields = pairFieldsFromSearchResult(result);
    setForm((f) => ({
      ...f,
      brand: fields.brand || f.brand,
      model: fields.model || f.model,
      colorway: fields.colorway || f.colorway,
      imageUrl: fields.imageUrl || f.imageUrl,
      kicksId: fields.kicksId || f.kicksId,
      sku: fields.sku || f.sku,
      marketPrice: fields.marketPrice ?? f.marketPrice,
      marketPriceUpdatedAt:
        fields.marketPrice !== null ? new Date().toISOString() : f.marketPriceUpdatedAt,
    }));
    setSearchTerm('');
    setResults([]);
  };

  const canSave = form.brand.trim() && form.model.trim();

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: form.id,
      brand: form.brand.trim(),
      model: form.model.trim(),
      colorway: form.colorway.trim(),
      size: form.size.trim(),
      status: form.status,
      price: form.price.trim(),
      imageUrl: form.imageUrl.trim(),
      notes: form.notes.trim(),
      tags: form.tags || [],
      kicksId: form.kicksId || null,
      sku: form.sku || '',
      marketPrice: typeof form.marketPrice === 'number' ? form.marketPrice : null,
      marketPriceUpdatedAt: form.marketPriceUpdatedAt || null,
      addedAt: form.addedAt || null,
      // Carried through explicitly. This payload is rebuilt field by field
      // rather than spread from the record, so anything not listed here is
      // dropped on save -- which is how editing an owned pair on the phone
      // used to erase the date it was bought.
      acquiredAt: form.acquiredAt || null,
      rating: normalizeRating(form.rating),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{form.id ? 'Edit pair' : 'New pair'}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <X size={20} color={colors.textDim} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {!!form.imageUrl && (
            <View style={styles.preview}>
              <Image source={{ uri: normalizeProductImage(form.imageUrl) }} style={styles.previewImg} resizeMode="contain" />
            </View>
          )}

          <Text style={styles.label}>Look up on KicksDB</Text>
          <View style={styles.lookupBox}>
            <Search size={15} color={colors.textFaint} />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search a sneaker to auto-fill…"
              placeholderTextColor={colors.textFaint}
              style={styles.lookupInput}
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator size="small" color={colors.textFaint} />}
            {!!searchTerm && !searchLoading && (
              <Pressable onPress={() => setSearchTerm('')} hitSlop={8}>
                <X size={15} color={colors.textFaint} />
              </Pressable>
            )}
          </View>

          {!!searchError && <Text style={styles.errorHint}>{searchError}</Text>}

          {!searchLoading && !searchError && searchTerm.trim() && results.length === 0 && (
            <Text style={styles.idleHint}>No matches for "{searchTerm.trim()}" — try the model name without the colorway</Text>
          )}

          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(r, idx) => r.id || `${r.sku}-${idx}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.resultsList}
              contentContainerStyle={{ gap: spacing.sm }}
              renderItem={({ item: r }) => (
                <Pressable onPress={() => selectResult(r)} style={styles.resultCard}>
                  <View style={styles.resultThumb}>
                    {r.imageUrl ? (
                      <Image source={{ uri: normalizeProductImage(r.imageUrl, { width: 300 }) }} style={styles.resultImg} resizeMode="contain" />
                    ) : (
                      <ImageOff size={18} color={colors.textFaint} />
                    )}
                  </View>
                  <Text style={styles.resultBrand} numberOfLines={1}>{r.brand || 'Unknown'}</Text>
                  <Text style={styles.resultModel} numberOfLines={2}>{r.colorway || r.model || 'Untitled'}</Text>
                </Pressable>
              )}
            />
          )}

          <View style={styles.statusRow}>
            <Pressable
              onPress={() => setForm((f) => ({ ...f, status: 'owned' }))}
              style={[styles.statusBtn, form.status === 'owned' && styles.statusBtnOwnedActive]}
            >
              <Text style={[styles.statusBtnText, form.status === 'owned' && { color: colors.statusOwned }]}>I own this</Text>
            </Pressable>
            <Pressable
              onPress={() => setForm((f) => ({ ...f, status: 'want' }))}
              style={[styles.statusBtn, form.status === 'want' && styles.statusBtnWantActive]}
            >
              <Text style={[styles.statusBtnText, form.status === 'want' && { color: colors.statusWant }]}>On my list</Text>
            </Pressable>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Brand</Text>
              <TextInput
                value={form.brand}
                onChangeText={(v) => setForm((f) => ({ ...f, brand: v }))}
                placeholder="Nike"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                value={form.model}
                onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
                placeholder="Kobe 6 Protro"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>Colorway</Text>
          <TextInput
            value={form.colorway}
            onChangeText={(v) => setForm((f) => ({ ...f, colorway: v }))}
            placeholder="Mambacita Sweet 16"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Size</Text>
              <TextInput
                value={form.size}
                onChangeText={(v) => setForm((f) => ({ ...f, size: v }))}
                placeholder="9.5 US"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>{form.status === 'owned' ? 'Price paid' : 'Target price'}</Text>
              <TextInput
                value={form.price}
                onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
                placeholder="optional"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>

          {/* Left empty unless you say otherwise — an unrated pair is not a
              pair rated zero, and clearing the box removes the rating. */}
          <Text style={styles.label}>My rating</Text>
          <TextInput
            value={form.rating === null || form.rating === undefined ? '' : String(form.rating)}
            onChangeText={(v) => setForm((f) => ({ ...f, rating: v }))}
            placeholder="optional — 0 to 10"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Photo</Text>
          <PhotoPicker
            value={form.imageUrl}
            onUploaded={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
          />
          {/* Kept below the picker rather than replaced by it: a link is still
              the fastest route when the photograph is already on the web, and
              it is the only way to clear a photo you have changed your mind
              about. */}
          <TextInput
            value={form.imageUrl}
            onChangeText={(v) => setForm((f) => ({ ...f, imageUrl: v }))}
            placeholder="…or paste a link to an image"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.photoUrlInput]}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={form.notes}
            onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
            placeholder="optional — where you got it, what you're waiting on, etc."
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Tags</Text>
          <TagInput
            value={form.tags}
            onChange={(next) => setForm((f) => ({ ...f, tags: next }))}
            suggestions={allTags || []}
          />

          <View style={styles.actionsRow}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleSave} disabled={!canSave} style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}>
              <Text style={styles.saveBtnText}>Save pair</Text>
            </Pressable>
          </View>
        </ScrollView>
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
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.text,
  },
  preview: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  previewImg: {
    width: '82%',
    height: '82%',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: 48,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  lookupBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  lookupInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14.5,
    color: colors.text,
  },
  photoUrlInput: {
    marginTop: spacing.sm,
  },
  errorHint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  idleHint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: colors.textFaint,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  resultsList: {
    // Same fix as the tag filter bar: a horizontal list doesn't auto-size
    // to its content's height, so without this it can render with zero
    // height and the whole row silently disappears.
    height: 172,
    flexGrow: 0,
    marginTop: spacing.md,
  },
  resultCard: {
    width: 110,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 5,
  },
  resultThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultImg: { width: '100%', height: '100%' },
  resultBrand: {
    fontFamily: fonts.semibold,
    fontSize: 8.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  resultModel: {
    fontFamily: fonts.medium,
    fontSize: 11.5,
    color: colors.text,
    lineHeight: 14,
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    padding: 4,
    borderRadius: radius.md,
    marginTop: spacing.xl,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  statusBtnOwnedActive: {
    backgroundColor: colors.statusOwnedTint,
  },
  statusBtnWantActive: {
    backgroundColor: colors.statusWantTint,
  },
  statusBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textDim,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  fieldHalf: { flex: 1 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 14.5,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  textarea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  cancelBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.textDim,
  },
  saveBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.onAccent,
  },
});
