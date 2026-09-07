import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { NotificationItem } from '@anybid/shared';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { relativeTime } from '../src/lib/format';
import { Badge, Body, Empty, Loading, Muted, Screen } from '../src/components/ui';
import { colors, spacing } from '../src/lib/theme';

function tone(type: string) {
  if (['AUCTION_WON', 'ITEM_SOLD', 'PAYMENT_RECEIVED'].includes(type)) return 'good' as const;
  if (['OUTBID', 'AUCTION_ENDING', 'APPROVAL_REQUESTED'].includes(type)) return 'warn' as const;
  return 'neutral' as const;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.notifications.list({ perPage: 50 });
      setItems(result.items);
    } catch {
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function open(item: NotificationItem) {
    if (!item.read) {
      setItems((prev) => prev?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? null);
      await api.notifications.markRead(item.id).catch(() => undefined);
      await refresh();
    }
    // Deep links from the API are web paths; map the listing ones into the app.
    const match = item.link?.match(/\/listing\/([^/?]+)/);
    if (match) router.push(`/listing/${match[1]}`);
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
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        ListEmptyComponent={
          <Empty title="Nothing yet" body="Outbid alerts and order updates arrive here." />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, !item.read && { backgroundColor: colors.brandSoft }]}
            onPress={() => open(item)}
          >
            <Badge label={item.type.replace(/_/g, ' ').toLowerCase()} tone={tone(item.type)} />
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontWeight: '600' }}>{item.title}</Body>
              <Muted>{item.body}</Muted>
            </View>
            <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'flex-start',
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  time: { fontSize: 10, color: colors.textFaint },
});
