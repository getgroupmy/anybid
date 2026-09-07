import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Order } from '@anybid/shared';
import { api } from '../src/lib/api';
import { formatMoney, relativeTime } from '../src/lib/format';
import { Badge, Body, Card, Empty, Loading, Muted, Screen } from '../src/components/ui';
import { colors, spacing } from '../src/lib/theme';

function tone(status: string) {
  if (['COMPLETED', 'PAID', 'DELIVERED'].includes(status)) return 'good' as const;
  if (['AWAITING_PAYMENT', 'AWAITING_SHIPMENT', 'SHIPPED'].includes(status)) return 'warn' as const;
  if (['CANCELLED', 'REFUNDED', 'DISPUTED'].includes(status)) return 'bad' as const;
  return 'neutral' as const;
}

export default function OrdersScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.orders.list({ role: 'buying', perPage: 30 });
      setOrders(result.items);
    } catch {
      setOrders([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!orders) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={
          <Empty title="No purchases yet" body="Auctions you win will show up here." />
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.row}>
              {item.listing?.image && (
                <Image source={{ uri: item.listing.image }} style={styles.image} contentFit="cover" />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Body numberOfLines={2} style={{ fontWeight: '500' }}>
                  {item.listing?.title}
                </Body>
                <Muted style={{ fontSize: 11 }}>{item.reference}</Muted>
                <Muted style={{ fontSize: 11 }}>
                  {item.seller?.displayName} · {relativeTime(item.createdAt)}
                </Muted>
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={styles.total}>{formatMoney(item.total)}</Text>
              <Badge label={item.status.replace(/_/g, ' ')} tone={tone(item.status)} />
            </View>

            {item.trackingNumber && (
              <Muted style={{ fontSize: 11 }}>
                {item.courier} · {item.trackingNumber}
              </Muted>
            )}

            {item.status === 'AWAITING_PAYMENT' && (
              <Pressable onPress={() => router.push(`/listing/${item.listing?.id}`)}>
                <Text style={styles.payNote}>
                  Payment is due{item.dueAt ? ` by ${new Date(item.dueAt).toLocaleDateString()}` : ''} —
                  complete it on the AnyBid website.
                </Text>
              </Pressable>
            )}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  image: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.border },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 17, fontWeight: '700', color: colors.text },
  payNote: { fontSize: 12, color: colors.warn },
});
