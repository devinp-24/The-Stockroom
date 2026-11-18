import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  FlatList,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Plus, Search, RefreshCw, X } from 'lucide-react-native';
import {
  EMPTY_PAIR,
  filterItems,
  genId,
  getAllTags,
  getCollectionStats,
  pairFieldsFromSearchResult,
  sortItems,
  SORTS,
  getRefreshCandidates,
  describeRefreshCost,
} from '@stockroom/shared';
import { colors, radius, spacing, fonts } from '../theme';
import { fetchCollection, saveCollection, refreshMarketPrices } from '../api';
import Plate from '../components/Plate';
import RegisterTabs from '../components/RegisterTabs';
import SortMenu from '../components/SortMenu';
import AddEditModal from '../components/AddEditModal';
import AddPanel from '../components/AddPanel';
import DetailModal from '../components/DetailModal';
import Toast from '../components/Toast';

export default function StockroomScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState('owned');
  const [sort, setSort] = useState('manual');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [toast, setToast] = useState(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addedIds, setAddedIds] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  // { list, index } rather than a bare item: the detail view is a pager now,
  // and what it can swipe through is the exact list the plate was tapped in
  // -- which in the "Both" register is the section, not the whole result.
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const serverItems = await fetchCollection();
        setItems(serverItems);
        setSaveError('');
      } catch (e) {
        setSaveError('Could not reach the collection server — check your Wi-Fi and that npm run dev:all is running.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const showToast = useCallback((message) => {
    setToast({ id: Date.now(), message });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const persist = async (next, message) => {
    setItems(next);
    try {
      await saveCollection(next);
      setSaveError('');
      if (message) showToast(message);
    } catch (e) {
      setSaveError(
        e.status
          ? `NOT SAVED — the server refused this change (HTTP ${e.status}). ${e.message} Anything you add now will be lost on reload.`
          : 'NOT SAVED — could not reach the collection server. Anything you add now will be lost on reload.'
      );
    }
  };

  // Only the two tab counts survive the Phase 1.1 strip; the value/brand/
  // fresh-pickup figures fed the KPI strip and hero, both now gone.
  const { ownedCount, wantCount, collectionValue, hasTrackedValue } = getCollectionStats(items);
  const allTags = getAllTags(items);
  const silhouetteCount = new Set(items.map((i) => i.model).filter(Boolean)).size;

  // 86 of 95 pairs share a size; defaulting to it removes the only other
  // field worth typing when adding from search.
  const defaultSize = (() => {
    const counts = items.reduce((acc, i) => {
      if (i.size) acc[i.size] = (acc[i.size] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  })();

  const hasActiveFilters = query.trim().length > 0;

  const filtered = sortItems(filterItems(items, { register, query }), sort);
  const heldFiltered = filtered.filter((i) => i.status === 'owned');
  const wantedFiltered = filtered.filter((i) => i.status === 'want');

  // Counted off `filtered`, the same array the grids map over, so the figure
  // cannot disagree with what is on screen. `query` is written straight from
  // onChangeText with no debounce, so the count moves on the keystroke. The
  // qualifier names what narrowed it: the register while nothing is typed --
  // which makes the figure match the tab's own count -- the term once it is.
  const trimmedQuery = query.trim();
  const tallyQualifier = trimmedQuery
    ? `matching \u201C${trimmedQuery}\u201D`
    : register === 'owned'
    ? 'held'
    : register === 'want'
    ? 'wanted'
    : 'in the stockroom';

  const openAddModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAddedIds([]);
    setAddOpen(true);
  };

  // The full form remains for a pair KicksDB does not carry.
  const openManualForm = () => {
    setAddOpen(false);
    setEditingItem(null);
    setModalVisible(true);
  };

  // A search result IS the add — same contract as the web.
  const addFromSearch = (result, status) => {
    const fields = pairFieldsFromSearchResult(result);
    const pair = {
      ...EMPTY_PAIR,
      ...fields,
      id: genId(),
      status,
      size: defaultSize,
      price: '',
      tags: [],
      marketPriceUpdatedAt: fields.marketPrice !== null ? new Date().toISOString() : null,
      addedAt: new Date().toISOString(),
    };
    persist([...items, pair], null);
    setAddedIds((prev) => [pair.id, ...prev]);
  };

  const setAddedPrice = (id, price) => {
    persist(items.map((i) => (i.id === id ? { ...i, price: price.trim() } : i)), null);
  };

  const undoAdd = (id) => {
    persist(items.filter((i) => i.id !== id), 'Removed');
    setAddedIds((prev) => prev.filter((x) => x !== id));
  };

  const openEditModal = (item) => {
    setDetail(null);
    setEditingItem(item);
    setModalVisible(true);
  };

  const openDetail = (list, index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetail({ list, index });
  };

  const handleSave = (cleaned) => {
    // Only a genuinely new pair gets an addedAt stamp. Stamping on every save
    // would re-date an old record as filed today the moment it was edited.
    const isNew = !cleaned.id;
    const withId = {
      ...cleaned,
      id: cleaned.id || genId(),
      addedAt: cleaned.addedAt || (isNew ? new Date().toISOString() : null),
    };
    const exists = items.some((i) => i.id === withId.id);
    const next = exists ? items.map((i) => (i.id === withId.id ? withId : i)) : [...items, withId];
    const message = exists ? 'Changes saved' : `Added to ${withId.status === 'owned' ? 'I Have' : 'I Will Have'}`;
    persist(next, message);
    setModalVisible(false);
    if (!exists) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // want -> owned, mirroring the web. Writes exactly two fields.
  const acquirePair = (item, paid) => {
    const cleanPaid = String(paid ?? '').trim().replace(/^\$/, '');
    const next = items.map((i) =>
      i.id === item.id
        ? { ...i, status: 'owned', price: cleanPaid, acquiredAt: new Date().toISOString() }
        : i
    );
    persist(next, `${item.model} moved to Holdings`);
    setDetail(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmDelete = (item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Remove this pair?',
      `${item.brand} ${item.model} will be removed from your stockroom.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            persist(items.filter((i) => i.id !== item.id), 'Removed from your stockroom');
            setDetail(null);
          },
        },
      ]
    );
  };

  // NOTE: long-press drag-reorder is not available on mobile in this phase.
  // react-native-draggable-flatlist has no multi-column mode, and the grid --
  // holdings 2-up, acquisitions 3-up -- is what carries the two registers'
  // scale difference. The manual order is still read from the shared
  // collection and honoured here; it just has to be changed from the web app.
  // Stale-first and capped, same policy as the web — a press used to send all
  // 95 tracked pairs regardless of how recently they were checked.
  const refresh = getRefreshCandidates(items);

  const refreshPrices = async () => {
    if (refresh.candidates.length === 0) {
      showToast(refresh.trackable === 0 ? 'Add pairs via search to track their price' : 'Prices are already current');
      return;
    }
    setRefreshingPrices(true);
    try {
      const prices = await refreshMarketPrices(refresh.candidates.map((i) => i.kicksId));
      const now = new Date().toISOString();
      let updated = 0;
      const next = items.map((i) => {
        const price = i.kicksId ? prices[i.kicksId] : undefined;
        if (typeof price !== 'number') return i;
        updated += 1;
        return { ...i, marketPrice: price, marketPriceUpdatedAt: now };
      });
      persist(
        next,
        updated > 0
          ? `Updated ${updated} pair${updated === 1 ? '' : 's'}`
          : 'No price updates came back — try again shortly'
      );
    } catch (e) {
      setSaveError(String(e.message || e));
    } finally {
      setRefreshingPrices(false);
    }
  };

  const listHeader = (
    <View>
      <View style={styles.brandRow}>
        <View style={styles.headerText}>
          <Text style={styles.wordmark}>The Stockroom</Text>
          <View style={styles.standfirst}>
            <Text style={styles.standfirstItem}>
              <Text style={styles.standfirstNum}>{ownedCount}</Text> held
            </Text>
            <Text style={styles.standfirstItem}>
              <Text style={styles.standfirstNum}>{wantCount}</Text> wanted
            </Text>
            {hasTrackedValue && (
              <Text style={styles.standfirstItem}>
                <Text style={styles.standfirstNum}>${Math.round(collectionValue).toLocaleString()}</Text> value
              </Text>
            )}
            <Text style={styles.standfirstItem}>
              <Text style={styles.standfirstNum}>{silhouetteCount}</Text> silhouettes
            </Text>
          </View>
        </View>
      </View>

      {/* Registers get their own row and scroll horizontally, so three tabs
          can never squeeze the actions off-screen -- which is what hid the
          refresh control entirely. Sort and the actions share the row below. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.registerBar}
        contentContainerStyle={styles.registerBarContent}
      >
        <RegisterTabs
          value={register}
          onChange={setRegister}
          counts={{ owned: ownedCount, want: wantCount, all: items.length }}
        />
      </ScrollView>

      <View style={styles.controlRow}>
        <SortMenu value={sort} options={SORTS} onChange={setSort} />
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSearchOpen((v) => !v)}
            style={[styles.iconBtn, searchOpen && styles.iconBtnActive]}
            hitSlop={6}
          >
            <Search size={16} color={searchOpen ? colors.accent : colors.textDim} />
          </Pressable>
          <Pressable
            onPress={refreshPrices}
            disabled={refreshingPrices}
            style={styles.refreshBtn}
            hitSlop={6}
          >
            {refreshingPrices ? (
              <ActivityIndicator size="small" color={colors.textDim} />
            ) : (
              <>
                <RefreshCw size={14} color={colors.textDim} />
                <Text style={styles.refreshHint}>{describeRefreshCost(refresh)}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {searchOpen && (
        <View style={styles.searchRow}>
          <Search size={14} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Silhouette, colourway, brand, tag, SKU…"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoFocus
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={14} color={colors.textFaint} />
            </Pressable>
          )}
        </View>
      )}

      {/* Suppressed at zero: the empty panel below already names what found
          nothing, and "0 pairs" above it would say the same thing twice. */}
      {!loading && filtered.length > 0 && (
        <Text style={styles.tally} accessibilityLiveRegion="polite">
          <Text style={styles.tallyNum}>{filtered.length}</Text>{' '}
          {filtered.length === 1 ? 'pair' : 'pairs'} {tallyQualifier}
        </Text>
      )}

      {!!saveError && <Text style={styles.errorText}>{saveError}</Text>}
    </View>
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerFill}>
          <Text style={styles.emptyHint}>Opening the stockroom…</Text>
        </View>
      );
    }
    return (
      <View style={styles.centerFill}>
        {items.length > 0 && hasActiveFilters ? (
          <>
            <Text style={styles.emptyTitle}>Nothing matches “{query.trim()}”</Text>
            <Text style={styles.emptyHint}>
              The search reads silhouette, colourway, brand, tag and SKU. Try a shorter term.
            </Text>
            <Pressable onPress={() => setQuery('')} style={styles.clearFiltersBtn}>
              <Text style={styles.clearFiltersBtnText}>Clear search</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.emptyTitle}>
              {items.length === 0
                ? 'The stockroom is empty'
                : register === 'owned'
                ? 'No pairs held yet'
                : 'Nothing on the acquisitions list'}
            </Text>
            <Text style={styles.emptyHint}>
              {register === 'want'
                ? 'Add a pair you are chasing and its market price will be tracked against your target.'
                : 'Add your first pair — search KicksDB and the photography, colourway and price come with it.'}
            </Text>
          </>
        )}
      </View>
    );
  };

  // Two scales, mirroring the web: holdings large and 2-up, acquisitions
  // small and 3-up so more of the wishlist fits on screen at once.
  const gridFor = (scope) => (scope === 'owned' ? { cols: 2, size: 'large' } : { cols: 3, size: 'small' });

  const renderGrid = (data, scope, key) => {
    const { cols, size } = gridFor(scope);
    return (
      <FlatList
        key={`${key}-${cols}`}
        data={data}
        keyExtractor={(item) => item.id}
        numColumns={cols}
        scrollEnabled={false}
        columnWrapperStyle={{ gap: spacing.lg }}
        contentContainerStyle={{ gap: spacing.xxl }}
        style={styles.grid}
        renderItem={({ item, index }) => (
          <Plate item={item} size={size} onInspect={() => openDetail(data, index)} />
        )}
      />
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + spacing.xl + 56 + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {listHeader}

        {loading || filtered.length === 0 ? (
          renderEmpty()
        ) : register === 'all' ? (
          <>
            {heldFiltered.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Holdings</Text>
                  <Text style={styles.sectionCount}>{heldFiltered.length} pairs</Text>
                </View>
                {renderGrid(heldFiltered, 'owned', 'held')}
              </View>
            )}
            {wantedFiltered.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Acquisitions</Text>
                  <Text style={styles.sectionCount}>{wantedFiltered.length} pairs</Text>
                </View>
                {renderGrid(wantedFiltered, 'want', 'wanted')}
              </View>
            )}
          </>
        ) : (
          <View style={styles.gridWrap}>{renderGrid(filtered, register, register)}</View>
        )}
      </ScrollView>

      <Pressable
        onPress={openAddModal}
        style={[styles.fab, { bottom: insets.bottom + spacing.xl }]}
      >
        <Plus size={22} color={colors.onAccent} />
      </Pressable>

      <AddPanel
        visible={addOpen}
        register={register}
        defaultSize={defaultSize}
        added={addedIds.map((id) => items.find((i) => i.id === id)).filter(Boolean)}
        onAdd={addFromSearch}
        onSetPrice={setAddedPrice}
        onUndo={undoAdd}
        onManual={openManualForm}
        onClose={() => { setAddOpen(false); setAddedIds([]); }}
      />

      <AddEditModal
        visible={modalVisible}
        initialItem={editingItem}
        defaultStatus={register === 'want' ? 'want' : 'owned'}
        allTags={allTags}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
      />

      {detail && (
        <DetailModal
          items={detail.list}
          index={detail.index}
          onClose={() => setDetail(null)}
          onEdit={openEditModal}
          onDelete={confirmDelete}
          onAcquire={acquirePair}
        />
      )}

      <Toast message={toast?.message} />
    </View>
  );
}

// Every control in the toolbar row is this tall, so they line up.
const CONTROL_HEIGHT = 38;

const styles = StyleSheet.create({
  wordmark: {
    fontFamily: fonts.display,
    fontSize: 42,
    lineHeight: 42,
    letterSpacing: -0.5,
    textTransform: 'uppercase',
    color: colors.text,
  },
  standfirst: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
  },
  standfirstItem: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  standfirstNum: { color: colors.text, fontFamily: fonts.bold },
  registerBar: {
    flexGrow: 0,
    marginTop: spacing.lg,
  },
  registerBarContent: {
    paddingHorizontal: spacing.xl,
    alignItems: 'flex-end',
  },
  // Shares its height and border treatment with iconBtn — the two sit side by
  // side, and a 4px height difference plus a different corner and border
  // colour read as misalignment rather than as two different controls.
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: CONTROL_HEIGHT,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  refreshHint: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  gridWrap: { paddingHorizontal: spacing.xl, marginTop: spacing.lg },

  grid: { backgroundColor: colors.bg },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xxl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.text,
    paddingBottom: 7,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: colors.text,
  },
  // Same micro-type as the standfirst, so the running count reads as a
  // caption on the grid rather than another control in the header.
  tally: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  tallyNum: { color: colors.text, fontFamily: fonts.bold },
  sectionCount: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1 },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBtn: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  clearFiltersBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
  },
  clearFiltersBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.textDim,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.danger,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 72,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.text,
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.textDim,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
