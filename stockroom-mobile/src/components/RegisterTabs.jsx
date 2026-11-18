import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, fonts } from '../theme';

// Holdings / Acquisitions, with "Both" set apart as a secondary lookup rather
// than a peer — showing everything at one scale flattens the distinction the
// two registers exist to make.
export default function RegisterTabs({ value, onChange, counts }) {
  const primary = [
    { id: 'owned', label: 'Holdings', count: counts.owned },
    { id: 'want', label: 'Acquisitions', count: counts.want },
  ];

  const Tab = ({ tab, secondary }) => {
    const active = value === tab.id;
    return (
      <Pressable
        key={tab.id}
        onPress={() => onChange(tab.id)}
        style={[styles.tab, secondary && styles.secondary, active && styles.tabActive]}
      >
        <Text style={[styles.label, secondary && styles.labelSecondary, active && styles.labelActive]}>
          {tab.label}
        </Text>
        <Text style={[styles.count, active && styles.countActive]}>{tab.count}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.row}>
      {primary.map((t) => <Tab key={t.id} tab={t} />)}
      <Tab tab={{ id: 'all', label: 'Both', count: counts.all }} secondary />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  tab: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.text },
  secondary: { marginLeft: 2, paddingLeft: spacing.md, borderLeftWidth: 0 },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  labelSecondary: { fontSize: 10.5 },
  labelActive: { color: colors.text },
  count: { fontFamily: fonts.medium, fontSize: 10, color: colors.textFaint },
  countActive: { color: colors.textDim },
});
