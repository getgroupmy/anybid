import { useCallback, useState } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ListingSummary } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { ListingCard } from '../../src/components/ListingCard';
import { Button, Empty, Loading, Screen } from '../../src/components/ui';
import { colors, spacing } from '../../src/lib/theme';

export default function WatchlistScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ListingSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    try {
      const result = await api.listings.watchlist({ perPage: 40 });
      setItems(result.items);
    } catch {
      setItems([]);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!user) {
    return (
      <Screen>
        <Empty
          title="Sign in to use your watchlist"
          body="We will alert you an hour before a watched auction closes."
        />
        <Button
          title="Sign in"
          onPress={() => router.push('/auth/sign-in')}
          style={{ marginHorizontal: spacing.xl }}
        />
      </Screen>
    );
  }

  if (!items) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.lg }}
        renderItem={({ item }) => <ListingCard listing={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <Empty
            title="Nothing watched yet"
            body="Tap the heart on any auction to follow it here."
          />
        }
      />
    </Screen>
  );
}
