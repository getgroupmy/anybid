import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import type { Category, ListingSummary } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { ListingCard } from '../../src/components/ListingCard';
import { Empty, H2, Loading, Muted, Screen } from '../../src/components/ui';
import { AdCard } from '../../src/components/AdCard';
import { colors, radius, spacing } from '../../src/lib/theme';

interface Feed {
  endingSoon: ListingSummary[];
  newest: ListingSummary[];
  categories: Category[];
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [endingSoon, newest, categories] = await Promise.all([
        api.listings.search({ sort: 'ending_soon', perPage: 8, endingWithinHours: 48 }),
        api.listings.search({ sort: 'newest', perPage: 20 }),
        api.categories.tree(),
      ]);
      setFeed({
        endingSoon: endingSoon.items,
        newest: newest.items,
        categories: categories.categories,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load auctions');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!feed) {
    return (
      <Screen>
        {error ? <Empty title="Cannot reach AnyBid" body={error} /> : <Loading label="Loading auctions" />}
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={feed.newest}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        renderItem={({ item }) => <ListingCard listing={item} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Name your maximum.{'\n'}We bid for you.</Text>
              <Text style={styles.heroBody}>
                Proxy bidding raises your bid only as far as it needs to go — never past your limit.
              </Text>
              <Pressable style={styles.heroButton} onPress={() => router.push('/search')}>
                <Text style={styles.heroButtonText}>Browse auctions</Text>
              </Pressable>
            </View>

            <View style={{ gap: spacing.sm }}>
              <View style={styles.sectionHead}>
                <H2>Ending soon</H2>
                <Link href="/search" style={styles.link}>
                  See all
                </Link>
              </View>
              <FlatList
                horizontal
                data={feed.endingSoon}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
                renderItem={({ item }) => (
                  <View style={{ width: 165 }}>
                    <ListingCard listing={item} />
                  </View>
                )}
              />
            </View>

            <View style={{ gap: spacing.sm }}>
              <View style={styles.sectionHead}>
                <H2>Categories</H2>
              </View>
              <FlatList
                horizontal
                data={feed.categories}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.categoryChip}
                    onPress={() => router.push(`/search?categorySlug=${item.slug}`)}
                  >
                    <Text style={styles.categoryIcon}>{item.icon}</Text>
                    <Text style={styles.categoryName}>{item.name}</Text>
                    <Muted style={{ fontSize: 10 }}>{item.listingCount ?? 0} live</Muted>
                  </Pressable>
                )}
              />
            </View>

            <View style={{ paddingHorizontal: spacing.lg }}>
              <AdCard placement="MOBILE_FEED" />
            </View>

            <View style={[styles.sectionHead, { marginTop: spacing.sm }]}>
              <H2>Just listed</H2>
            </View>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 29 },
  heroBody: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 19 },
  heroButton: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  heroButtonText: { fontWeight: '700', color: colors.text, fontSize: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  link: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  categoryChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
    width: 104,
  },
  categoryIcon: { fontSize: 20 },
  categoryName: { fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
