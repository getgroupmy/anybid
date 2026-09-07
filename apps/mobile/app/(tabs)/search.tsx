import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Category, ListingSummary } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { ListingCard } from '../../src/components/ListingCard';
import { Empty, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/lib/theme';

const SORTS = [
  ['ending_soon', 'Ending soon'],
  ['newest', 'Newest'],
  ['most_bids', 'Most bids'],
  ['price_asc', 'Cheapest'],
  ['price_desc', 'Priciest'],
] as const;

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; categorySlug?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const [categorySlug, setCategorySlug] = useState(params.categorySlug ?? '');
  const [sort, setSort] = useState<string>('ending_soon');
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<ListingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api.categories
      .tree()
      .then((r) => setCategories(r.categories))
      .catch(() => undefined);
  }, []);

  const run = useCallback(
    async (nextPage: number, replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      try {
        const result = await api.listings.search({
          q: query || undefined,
          categorySlug: categorySlug || undefined,
          sort,
          page: nextPage,
          perPage: 20,
        });
        setTotal(result.total);
        setPage(result.page);
        setItems((prev) => (replace ? result.items : [...prev, ...result.items]));
      } catch {
        if (replace) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, categorySlug, sort],
  );

  // Debounce the search so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void run(1, true), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [run, query]);

  return (
    <Screen>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search auctions"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {SORTS.map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => setSort(value)}
            style={[styles.chip, sort === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, sort === value && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Pressable
          onPress={() => setCategorySlug('')}
          style={[styles.chip, categorySlug === '' && styles.chipActive]}
        >
          <Text style={[styles.chipText, categorySlug === '' && styles.chipTextActive]}>All</Text>
        </Pressable>
        {categories.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setCategorySlug(c.slug)}
            style={[styles.chip, categorySlug === c.slug && styles.chipActive]}
          >
            <Text style={[styles.chipText, categorySlug === c.slug && styles.chipTextActive]}>
              {c.icon} {c.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.brand} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md, paddingBottom: spacing.xxl }}
          renderItem={({ item }) => <ListingCard listing={item} />}
          ListHeaderComponent={
            <Text style={styles.count}>
              {total.toLocaleString()} {total === 1 ? 'listing' : 'listings'}
            </Text>
          }
          ListEmptyComponent={
            <Empty title="Nothing found" body="Try a different search or clear your filters." />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && items.length < total) void run(page + 1, false);
          }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.brand} /> : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  filterRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  chipTextActive: { color: '#fff' },
  count: { paddingHorizontal: spacing.lg, fontSize: 12, color: colors.textMuted },
});
