import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { consolesFor, type BidSummary, type ListingSummary } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { formatMoney } from '../../src/lib/format';
import { Badge, Body, Button, Card, H2, Muted, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/lib/theme';

type MyBid = BidSummary & { listing: ListingSummary };

export default function AccountScreen() {
  const { user, signOut, refresh } = useAuth();
  const router = useRouter();
  const [bids, setBids] = useState<MyBid[]>([]);
  const [listings, setListings] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    await refresh();
    try {
      const [myBids, myListings] = await Promise.all([
        api.bidding.myBids({ perPage: 10 }),
        api.listings.mine({ perPage: 1 }),
      ]);
      setBids(myBids.items as MyBid[]);
      setListings(myListings.total);
    } catch {
      /* leave the last known state on screen */
    }
  }, [user, refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!user) {
    return (
      <Screen>
        <View style={styles.signedOut}>
          <H2>Sign in to AnyBid</H2>
          <Muted style={{ textAlign: 'center' }}>
            Bid, sell and manage your consoles from one account.
          </Muted>
          <Button title="Sign in" onPress={() => router.push('/auth/sign-in')} full />
          <Button
            title="Create an account"
            variant="secondary"
            onPress={() => router.push('/auth/register')}
            full
          />
        </View>
      </Screen>
    );
  }

  const consoles = consolesFor(user);
  const winning = bids.filter((b) => b.listing.viewer?.isLeading).length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <Card style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.displayName.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{user.displayName}</Text>
            <Muted>{user.email}</Muted>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
              {user.verified && <Badge label="Verified" tone="good" />}
              {user.orgName && <Badge label={user.orgName} tone="brand" />}
            </View>
          </View>
        </Card>

        <View style={styles.statRow}>
          <Stat label="Winning" value={String(winning)} tone="good" />
          <Stat label="Active bids" value={String(bids.length)} />
          <Stat label="Listings" value={String(listings)} />
          <Stat label="Credit" value={formatMoney(user.balance)} />
        </View>

        <Card>
          <MenuItem
            icon="cart"
            label="My purchases"
            onPress={() => router.push('/orders')}
          />
          <MenuItem
            icon="notifications"
            label="Notifications"
            badge={user.unreadNotifications}
            onPress={() => router.push('/notifications')}
          />
          <MenuItem
            icon="pricetags"
            label="My listings"
            onPress={() => router.push('/(tabs)/sell')}
          />
        </Card>

        {consoles.length > 1 && (
          <>
            <H2 style={{ marginTop: spacing.sm }}>Consoles</H2>
            <Card>
              {consoles
                .filter((c) => c.key !== 'user')
                .map((c, i, arr) => (
                  <MenuItem
                    key={c.key}
                    icon={
                      c.key === 'admin'
                        ? 'shield-checkmark'
                        : c.key === 'advertiser'
                          ? 'megaphone'
                          : 'business'
                    }
                    label={c.label}
                    last={i === arr.length - 1}
                    onPress={() => router.push(`/console/${c.key}` as never)}
                  />
                ))}
            </Card>
          </>
        )}

        <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
          <H2>Bids in play</H2>
          {bids.length === 0 ? (
            <Muted>You have not bid on anything yet.</Muted>
          ) : (
            bids.slice(0, 6).map((b) => (
              <Pressable
                key={b.id}
                style={styles.bidRow}
                onPress={() => router.push(`/listing/${b.listing.id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontWeight: '500' }}>
                    {b.listing.title}
                  </Body>
                  <Muted>{formatMoney(b.listing.currentPrice)}</Muted>
                </View>
                <Badge
                  label={b.listing.viewer?.isLeading ? 'Winning' : 'Outbid'}
                  tone={b.listing.viewer?.isLeading ? 'good' : 'warn'}
                />
              </Pressable>
            ))
          )}
        </Card>

        <Button title="Sign out" variant="secondary" onPress={signOut} full />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, tone === 'good' && { color: colors.good }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function MenuItem({
  icon,
  label,
  badge,
  last,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: number;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuItem, !last && styles.menuBorder, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.menuLabel}>{label}</Text>
      {badge !== undefined && badge > 0 && (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  signedOut: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: colors.brandDark },
  name: { fontSize: 17, fontWeight: '700', color: colors.text },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, padding: spacing.md, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  menuBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  menuBadge: {
    backgroundColor: colors.brand,
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  menuBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  bidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
