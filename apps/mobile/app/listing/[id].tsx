import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  effectiveIncrement,
  listingChannel,
  type ListingDetail,
  type ServerMessage,
} from '@anybid/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useRealtime } from '../../src/lib/useRealtime';
import { formatMoney, moneyInputToMinor, relativeTime } from '../../src/lib/format';
import {
  Badge,
  Body,
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  H2,
  Loading,
  Muted,
  Row,
  Screen,
} from '../../src/components/ui';
import { Countdown } from '../../src/components/Countdown';
import { AdCard } from '../../src/components/AdCard';
import { colors, radius, spacing } from '../../src/lib/theme';

interface Live {
  currentPrice: number;
  minimumBid: number;
  bidCount: number;
  endsAt: string | null;
  /**
   * Our pseudonym on this listing if we are the leader, else whoever is. The
   * live feed carries a per-listing pseudonym rather than a user id, so this
   * is compared with the listing's own `viewer.myRef`.
   */
  leaderRef: string | null;
  reserveMet: boolean;
  status: string;
}

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [extended, setExtended] = useState(false);
  const [watching, setWatching] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { listing: l } = await api.listings.get(id);
      setListing(l);
      setWatching(l.viewer?.watching ?? false);
      setLive({
        currentPrice: l.currentPrice,
        minimumBid: l.minimumBid,
        bidCount: l.bidCount,
        endsAt: l.endsAt,
        leaderRef: l.viewer?.isLeading ? (l.viewer?.myRef ?? null) : null,
        reserveMet: l.reserveMet,
        status: l.status,
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this listing');
    }
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === 'bid') {
      setLive((prev) =>
        prev
          ? {
              ...prev,
              currentPrice: message.payload.currentPrice,
              minimumBid: message.payload.minimumBid,
              bidCount: message.payload.bidCount,
              endsAt: message.payload.endsAt,
              leaderRef: message.payload.leaderRef,
              reserveMet: message.payload.reserveMet,
            }
          : prev,
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (message.t === 'extended') {
      setLive((prev) => (prev ? { ...prev, endsAt: message.payload.endsAt } : prev));
      setExtended(true);
      setTimeout(() => setExtended(false), 6000);
    } else if (message.t === 'closed') {
      setLive((prev) => (prev ? { ...prev, status: message.payload.status } : prev));
      void load();
    }
  }, [load]);

  useRealtime(id ? [listingChannel(id)] : [], onMessage);

  const increment = useMemo(
    () => (live && listing ? effectiveIncrement(live.currentPrice, listing.bidIncrement) : 0),
    [live, listing],
  );

  if (loadError) {
    return (
      <Screen>
        <Empty title="Listing unavailable" body={loadError} />
      </Screen>
    );
  }
  if (!listing || !live) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const isLive = live.status === 'LIVE';
  const isSeller = listing.viewer?.isSeller ?? false;
  const myRef = listing.viewer?.myRef ?? null;
  const isLeading = myRef !== null && live.leaderRef === myRef;

  async function placeBid(maxAmount: number) {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }
    // Checked before the comparison below, because NaN < anything is false —
    // an unreadable amount would sail past a minimum-bid check.
    if (!Number.isFinite(maxAmount)) {
      setBidError('That is not an amount — enter what you are willing to pay.');
      return;
    }
    if (maxAmount < live!.minimumBid) {
      setBidError(`The minimum bid is ${formatMoney(live!.minimumBid)}`);
      return;
    }
    setBusy(true);
    setBidError(null);
    setNotice(null);
    try {
      const result = await api.bidding.place(listing!.id, {
        maxAmount,
        expectedPrice: live!.currentPrice,
      });
      if (!result.accepted) {
        setNotice(
          (result as unknown as { message?: string }).message ??
            'Your bid needs approval before it can be placed.',
        );
      } else {
        void Haptics.notificationAsync(
          result.isLeading
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        );
        setLive((prev) =>
          prev
            ? {
                ...prev,
                currentPrice: result.currentPrice,
                minimumBid: result.minimumBid,
                endsAt: result.endsAt,
                reserveMet: result.reserveMet,
                leaderRef: result.isLeading ? myRef : prev.leaderRef,
              }
            : prev,
        );
        setAmount('');
        setNotice(
          result.isLeading
            ? "You're the highest bidder."
            : 'Another bidder has a higher maximum — you have been outbid.',
        );
      }
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Your bid could not be placed');
    } finally {
      setBusy(false);
    }
  }

  async function buyNow() {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }
    Alert.alert(
      'Buy it now',
      `Buy ${listing!.title} for ${formatMoney(listing!.buyNowPrice ?? 0)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy',
          style: 'default',
          onPress: async () => {
            setBusy(true);
            try {
              await api.bidding.buyNow(listing!.id, { quantity: 1 });
              router.push('/orders');
            } catch (err) {
              setBidError(err instanceof Error ? err.message : 'Purchase failed');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  async function toggleWatch() {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }
    const next = !watching;
    setWatching(next);
    try {
      const res = next
        ? await api.listings.watch(listing!.id)
        : await api.listings.unwatch(listing!.id);
      setWatching(res.watching);
    } catch {
      setWatching(!next);
    }
  }

  const quickBids = [live.minimumBid, live.minimumBid + increment * 2, live.minimumBid + increment * 5];

  return (
    <Screen>
      <Stack.Screen options={{ title: listing.category.name }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          <View style={styles.gallery}>
            <Image
              source={{ uri: listing.images[activeImage] ?? listing.images[0] }}
              style={styles.heroImage}
              contentFit="cover"
              transition={150}
            />
          </View>
          {listing.images.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbs}
            >
              {listing.images.map((src, i) => (
                <Pressable key={src} onPress={() => setActiveImage(i)}>
                  <Image
                    source={{ uri: src }}
                    style={[styles.thumb, i === activeImage && styles.thumbActive]}
                    contentFit="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.section}>
            <View style={styles.badgeRow}>
              <Badge label={listing.status} tone={isLive ? 'good' : 'neutral'} />
              <Badge label={listing.condition.replace(/_/g, ' ')} />
              {listing.hasReserve && (
                <Badge
                  label={live.reserveMet ? 'Reserve met' : 'Reserve not met'}
                  tone={live.reserveMet ? 'good' : 'warn'}
                />
              )}
            </View>
            <Text style={styles.title}>{listing.title}</Text>
            <Muted>
              {listing.viewCount.toLocaleString()} views · {listing.watchCount} watching ·{' '}
              {listing.locationState ?? 'Malaysia'}
            </Muted>
          </View>

          {/* --- bid panel --- */}
          <Card style={[styles.section, styles.bidCard]}>
            <View style={styles.priceHeader}>
              <View>
                <Muted style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.4 }}>
                  {live.bidCount > 0 ? 'Current bid' : 'Starting bid'}
                </Muted>
                <Text style={styles.price}>{formatMoney(live.currentPrice)}</Text>
                <Muted>
                  {live.bidCount} {live.bidCount === 1 ? 'bid' : 'bids'}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Muted style={{ fontSize: 10 }}>{isLive ? 'CLOSES IN' : 'CLOSED'}</Muted>
                <Countdown endsAt={live.endsAt} style={styles.countdown} />
                {isLeading && isLive && <Badge label="You are winning" tone="good" />}
              </View>
            </View>

            {extended && (
              <View style={styles.extendBanner}>
                <Text style={styles.extendText}>
                  A late bid extended this auction — everyone gets a chance to answer.
                </Text>
              </View>
            )}

            {!isLive ? (
              <View style={styles.closedBox}>
                <Body style={{ textAlign: 'center', color: colors.textMuted }}>
                  {live.status === 'SOLD' ? 'This auction has sold.' : 'Bidding has closed.'}
                </Body>
              </View>
            ) : isSeller ? (
              <View style={styles.closedBox}>
                <Body style={{ textAlign: 'center', color: colors.textMuted }}>
                  This is your listing — you cannot bid on it.
                </Body>
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                {listing.kind !== 'BUY_NOW' && (
                  <>
                    <Field
                      label="Your maximum bid (RM)"
                      keyboardType="decimal-pad"
                      placeholder={(live.minimumBid / 100).toFixed(2)}
                      value={amount}
                      onChangeText={setAmount}
                      hint={`We bid only as much as needed to keep you in front. Minimum ${formatMoney(
                        live.minimumBid,
                      )}.`}
                    />

                    <View style={styles.quickRow}>
                      {quickBids.map((v) => (
                        <Pressable
                          key={v}
                          style={styles.quickChip}
                          onPress={() => setAmount((v / 100).toFixed(2))}
                        >
                          <Text style={styles.quickChipText}>{formatMoney(v)}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <Button
                      title={busy ? 'Placing…' : 'Place bid'}
                      loading={busy}
                      disabled={!amount}
                      onPress={() => placeBid(moneyInputToMinor(amount))}
                      full
                    />
                  </>
                )}

                {listing.buyNowPrice && live.currentPrice < listing.buyNowPrice && (
                  <Button
                    title={`Buy now for ${formatMoney(listing.buyNowPrice)}`}
                    variant="secondary"
                    onPress={buyNow}
                    disabled={busy}
                    full
                  />
                )}
              </View>
            )}

            {listing.viewer?.requiresApproval && (
              <Text style={styles.approvalNote}>
                Bids above your organisation&apos;s threshold go to an approver before they reach
                the auction.
              </Text>
            )}

            <ErrorText>{bidError}</ErrorText>
            {notice && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}

            <Button
              title={watching ? '♥ Watching' : '♡ Watch this auction'}
              variant="ghost"
              onPress={toggleWatch}
              full
            />
          </Card>

          <Card style={styles.section}>
            <H2>Description</H2>
            {listing.description.split('\n\n').map((p, i) => (
              <Body key={i} style={{ marginTop: spacing.sm, lineHeight: 21, color: colors.textMuted }}>
                {p}
              </Body>
            ))}
          </Card>

          <Card style={styles.section}>
            <H2>Details</H2>
            <View style={{ marginTop: spacing.sm }}>
              <Row label="Starting price" value={formatMoney(listing.startPrice)} />
              <Row
                label="Bid increment"
                value={listing.bidIncrement ? formatMoney(listing.bidIncrement) : 'Automatic'}
              />
              <Row
                label="Shipping"
                value={listing.shippingCost > 0 ? formatMoney(listing.shippingCost) : 'Free'}
              />
              <Row label="Local pickup" value={listing.localPickup ? 'Available' : 'No'} />
              <Row
                label="Anti-snipe"
                value={
                  listing.antiSnipeWindowSec > 0
                    ? `${listing.antiSnipeWindowSec / 60} min window`
                    : 'Off'
                }
              />
              <Row label="Seller" value={listing.seller.displayName} />
              <Row
                label="Seller rating"
                value={
                  listing.seller.ratingCount > 0
                    ? `★ ${listing.seller.ratingAvg.toFixed(1)} (${listing.seller.ratingCount})`
                    : 'No reviews yet'
                }
              />
            </View>
          </Card>

          <Card style={styles.section}>
            <H2>Bid history</H2>
            {listing.bids.length === 0 ? (
              <Muted style={{ marginTop: spacing.sm }}>
                No bids yet — be the first to open this auction.
              </Muted>
            ) : (
              <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                {listing.bids.slice(0, 12).map((b) => (
                  <View key={b.id} style={styles.bidRow}>
                    <Text style={styles.bidder}>{b.bidder.masked}</Text>
                    <Text style={styles.bidAmount}>{formatMoney(b.amount)}</Text>
                    <Text style={styles.bidTime}>{relativeTime(b.createdAt)}</Text>
                  </View>
                ))}
                <Muted style={{ fontSize: 11 }}>
                  Bidder identities are masked and maximum bids stay private.
                </Muted>
              </View>
            )}
          </Card>

          <View style={{ paddingHorizontal: spacing.lg }}>
            <AdCard placement="LISTING_SIDEBAR" categoryId={listing.category.id} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gallery: { aspectRatio: 4 / 3, backgroundColor: colors.border },
  heroImage: { width: '100%', height: '100%' },
  thumbs: { gap: spacing.sm, padding: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: colors.brand },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, gap: 6 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  title: { fontSize: 19, fontWeight: '700', color: colors.text, lineHeight: 25 },
  bidCard: { gap: spacing.md },
  priceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  price: { fontSize: 28, fontWeight: '700', color: colors.text },
  countdown: { fontSize: 15, fontWeight: '600', color: colors.text },
  extendBanner: { backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: spacing.md },
  extendText: { color: colors.warn, fontSize: 12 },
  closedBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.lg },
  quickRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  quickChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  quickChipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  approvalNote: {
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  noticeBox: { backgroundColor: colors.goodSoft, borderRadius: radius.md, padding: spacing.md },
  noticeText: { color: colors.good, fontSize: 13 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bidder: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, color: colors.textMuted, flex: 1 },
  bidAmount: { fontSize: 13, fontWeight: '700', color: colors.text },
  bidTime: { fontSize: 11, color: colors.textFaint, width: 70, textAlign: 'right' },
});
