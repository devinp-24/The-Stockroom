import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  FlatList,
  TextInput,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Pencil, Trash2, ImageOff, Check } from 'lucide-react-native';
import {
  normalizeProductImage,
  getPriceNarrative,
  formatPrice,
  formatRating,
  primitives,
} from '@stockroom/shared';
import { colors, radius, spacing, fonts } from '../theme';
import { fetchPriceHistory } from '../api';

// One pair's page inside the pager. Everything that belongs to THIS shoe --
// the photograph, the table, its price record -- lives here, so it all slides
// together as a single sheet of paper when the pager moves.
function DetailPage({ item, width }) {
  const [series, setSeries] = useState(null);

  useEffect(() => {
    setSeries(null);
    if (!item?.kicksId) { setSeries([]); return; }
    let live = true;
    fetchPriceHistory(item.kicksId)
      .then((h) => live && setSeries(h))
      .catch(() => live && setSeries([]));
    return () => { live = false; };
  }, [item?.kicksId]);

  const movement = getPriceNarrative(item);

  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.scrollContent}>
      <View style={styles.photoWrap}>
        {item.imageUrl ? (
          <Image
            source={{
              uri: normalizeProductImage(item.imageUrl, {
                blendWith: primitives.ground.replace('#', ''),
              }),
            }}
            style={styles.photo}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.photoEmpty}>
            <ImageOff size={28} color={colors.textFaint} />
            <Text style={styles.photoEmptyText}>No photo</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.brand}>{item.brand}</Text>
        <Text style={styles.model}>{item.model}</Text>
        {!!item.colorway && <Text style={styles.colorway}>{item.colorway}</Text>}

        {item.tags && item.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {item.tags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagPillText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.move, movement.flag && styles.moveFlagged]}>{movement.text}</Text>

        <Text style={styles.sectionHeading}>Price history</Text>
        {series === null ? (
          <Text style={[styles.historyText, styles.historyBlock]}>Reading record…</Text>
        ) : series.length === 0 ? (
          <Text style={[styles.historyText, styles.historyBlock]}>
            No observations yet. Refresh prices to start a record.
          </Text>
        ) : series.length === 1 ? (
          <View style={styles.historyRow}>
            <View style={styles.historyDot} />
            <Text style={styles.historyText}>
              One observation — ${Math.round(series[0].price).toLocaleString()} on{' '}
              {new Date(series[0].timestamp).toLocaleDateString()}
            </Text>
          </View>
        ) : (
          <Text style={[styles.historyText, styles.historyBlock]}>
            {series.length} observations — latest ${Math.round(series[series.length - 1].price).toLocaleString()} on{' '}
            {new Date(series[series.length - 1].timestamp).toLocaleDateString()}
          </Text>
        )}

        <Text style={styles.sectionHeading}>Specification</Text>
        {[
          ['My rating', typeof item.rating === 'number' ? `${formatRating(item.rating)} / 10` : '—'],
          [item.status === 'owned' ? 'Paid' : 'Target', formatPrice(item.price)],
          ['Market', typeof item.marketPrice === 'number' && item.marketPrice > 0
            ? `$${Math.round(item.marketPrice).toLocaleString()}` : 'No listings'],
          ['Size', item.size || '—'],
          ['SKU', item.sku || '—'],
          ...(item.acquiredAt
            ? [['Bought', new Date(item.acquiredAt).toLocaleDateString()]] : []),
          ['Checked', item.marketPriceUpdatedAt
            ? new Date(item.marketPriceUpdatedAt).toLocaleDateString() : 'Never'],
        ].map(([k, v]) => (
          <View style={styles.specRow} key={k}>
            <Text style={styles.specKey}>{k}</Text>
            <Text style={styles.specValue}>{v}</Text>
          </View>
        ))}

        {!!item.notes && <Text style={styles.notes}>{item.notes}</Text>}
      </View>
    </ScrollView>
  );
}

// Tap-to-inspect view for a pair — separate from the edit form, mirroring
// the web app's expand-to-detail card. Kept as a plain slide-up modal
// rather than attempting a shared-element morph: React Native has no
// reliable cross-tree layout animation for this without a fragile native
// shared-transition setup, and a clean slide still reads as "opening up"
// the pair rather than just another form.
//
// Inside, it is a gallery rather than a single page: the register you opened
// from becomes a horizontal pager, so the next colourway is one swipe away
// instead of a close, a scroll and another tap. `items` is the exact list the
// grid behind is showing, in its order, so a swipe and a scroll agree about
// what comes next.
//
// The chrome does NOT ride along with the pages. Close, the counter and the
// action bar are siblings of the pager, so a swipe moves the shoe and its
// table while the frame around them holds still -- the same trick the web
// panel uses, and what makes this read as turning pages inside one view.
export default function DetailModal({ items = [], index = 0, onClose, onEdit, onDelete, onAcquire }) {
  const window = useWindowDimensions();
  // Seeded from the window so the pager can mount on the first frame with the
  // right page width; onLayout corrects it if the sheet is inset (iPad, split
  // view) or the device is rotated.
  const [width, setWidth] = useState(window.width);
  const [current, setCurrent] = useState(index);
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  const [paidDraft, setPaidDraft] = useState('');
  const listRef = useRef(null);

  // A width correction lands after the pager has already mounted at the old
  // one, so the offset has to be re-applied by hand — initialScrollIndex only
  // fires once.
  useEffect(() => {
    if (width > 0) listRef.current?.scrollToOffset({ offset: current * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // Swiping to another pair must not carry a half-finished action with it:
  // an open "Remove" or "I bought this" would otherwise land on whichever
  // shoe happens to be on screen when it is confirmed.
  useEffect(() => {
    setConfirming(false);
    setBuying(false);
    setPaidDraft('');
  }, [current]);

  const item = items[Math.min(Math.max(current, 0), items.length - 1)];
  if (!item) return null;

  // Driven from the offset rather than from one particular event, because no
  // single event covers every case: onMomentumScrollEnd is the precise signal
  // when a swipe is flung and left to settle, but it never fires for a drag
  // released at rest, and react-native-web does not fire it at all. Rounding
  // the offset means the page flips as the halfway line is crossed, which is
  // also what makes the counter and the action bar agree with what is on
  // screen mid-gesture instead of lagging a page behind.
  const syncPage = (e) => {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next === current || next < 0 || next >= items.length) return;
    setCurrent(next);
    Haptics.selectionAsync();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.flex}>
        <View
          style={styles.pagerWrap}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== width) setWidth(w);
          }}
        >
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(it) => it.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onScroll={syncPage}
            scrollEventThrottle={16}
            onMomentumScrollEnd={syncPage}
            renderItem={({ item: pair }) => <DetailPage item={pair} width={width} />}
            // A register runs to ~100 pairs. Only the page either side is
            // worth keeping alive; every mounted page holds a full-size
            // photograph and its own price-history request.
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
          />

          {/* pointerEvents box-none so only the buttons themselves take
              touches — the pager underneath keeps every swipe. */}
          <View style={styles.chrome} pointerEvents="box-none">
            {items.length > 1 && (
              <View style={styles.counter}>
                <Text style={styles.counterText}>
                  {current + 1} / {items.length}
                </Text>
              </View>
            )}
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.actions}>
          {buying ? (
            <View style={styles.acquire}>
              <View style={styles.acquireField}>
                <Text style={styles.acquireLabel}>Paid</Text>
                <TextInput
                  value={paidDraft}
                  onChangeText={setPaidDraft}
                  keyboardType="numbers-and-punctuation"
                  autoFocus
                  style={styles.acquireInput}
                />
              </View>
              <Text style={styles.acquireNote}>
                Moves {item.model} to Holdings and records what you paid.
              </Text>
              <View style={styles.acquireActions}>
                <Pressable style={styles.cancelBtn} onPress={() => setBuying(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.saveBtn} onPress={() => onAcquire(item, paidDraft)}>
                  <Check size={14} color={colors.onAccent} />
                  <Text style={styles.saveBtnText}>Move to Holdings</Text>
                </Pressable>
              </View>
            </View>
          ) : confirming ? (
            <>
              <Pressable style={styles.cancelBtn} onPress={() => setConfirming(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.deleteBtn} onPress={() => onDelete(item)}>
                <Text style={styles.deleteBtnText}>Remove pair</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.cancelBtn} onPress={() => setConfirming(true)}>
                <Trash2 size={14} color={colors.textDim} />
                <Text style={styles.cancelBtnText}>Remove</Text>
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={() => onEdit(item)}>
                <Pencil size={14} color={colors.textDim} />
                <Text style={styles.cancelBtnText}>Edit</Text>
              </Pressable>
              {item.status === 'want' && (
                <Pressable
                  style={styles.saveBtn}
                  onPress={() => {
                    setPaidDraft(
                      typeof item.marketPrice === 'number' && item.marketPrice > 0
                        ? String(Math.round(item.marketPrice))
                        : item.price || ''
                    );
                    setBuying(true);
                  }}
                >
                  <Check size={14} color={colors.onAccent} />
                  <Text style={styles.saveBtnText}>I bought this</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  pagerWrap: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  photoWrap: {
    position: 'relative',
    aspectRatio: 1,
    // The pair is always shown at full colour here, whichever register it
    // came from — the detail sheet is the reliable way to read a colourway.
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '78%', height: '78%' },
  sectionHeading: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginTop: spacing.xxl,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md },
  historyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  // No marginTop here. The row already carries it, and a top margin on the
  // text inside a centre-aligned row pushed the text down relative to the
  // dot — which read as the dot sitting too high.
  historyText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textDim, flex: 1 },
  // Spacing for the standalone variants, which are not inside historyRow.
  historyBlock: { marginTop: spacing.md },
  specRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  specKey: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  specValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text, textAlign: 'right', flexShrink: 1 },

  acquire: { width: '100%' },
  acquireField: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  acquireLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  acquireInput: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
    paddingVertical: 6,
  },
  acquireNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.textDim, marginTop: 9 },
  acquireActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

  move: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: colors.textFaint, marginTop: spacing.md },
  moveFlagged: { color: colors.accent, fontFamily: fonts.semibold },
  photoEmpty: { alignItems: 'center', gap: 8 },
  photoEmptyText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.textFaint,
  },
  // Close and the counter are pinned to the sheet, not to a page, so they do
  // not slide away with the shoe.
  chrome: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.scrim,
  },
  counterText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.onAccent,
  },
  closeBtn: {
    marginLeft: 'auto',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.xl,
    gap: 2,
  },
  brand: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  model: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: 0.3,
    color: colors.text,
    marginTop: 2,
  },
  colorway: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textDim,
    marginTop: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  tagPill: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPillText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.accentStrong,
  },
  notes: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.textDim,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textDim,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  saveBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.onAccent,
  },
  deleteBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radius.md,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.danger,
  },
});
