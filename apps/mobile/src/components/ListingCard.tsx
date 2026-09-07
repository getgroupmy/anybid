import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import type { ListingSummary } from '@anybid/shared';
import { formatMoney } from '../lib/format';
import { colors, radius, shadow, spacing } from '../lib/theme';
import { Countdown } from './Countdown';

export function ListingCard({ listing, wide }: { listing: ListingSummary; wide?: boolean }) {
  const isAuction = listing.kind !== 'BUY_NOW';
  const closed = listing.status !== 'LIVE';

  return (
    <Link href={`/listing/${listing.id}`} asChild>
      <Pressable style={({ pressed }) => [styles.card, wide && styles.wide, pressed && { opacity: 0.85 }]}>
        <View style={styles.imageWrap}>
          {listing.image ? (
            <Image
              source={{ uri: listing.image }}
              style={styles.image}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.image, styles.imageFallback]} />
          )}

          {listing.featured && (
            <View style={[styles.chip, { backgroundColor: colors.brand, left: 6, top: 6 }]}>
              <Text style={styles.chipText}>Featured</Text>
            </View>
          )}
          {closed && (
            <View style={styles.closedOverlay}>
              <Text style={styles.closedText}>
                {listing.status === 'SOLD' ? 'Sold' : 'Ended'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Text numberOfLines={2} style={styles.title}>
            {listing.title}
          </Text>

          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>
                {isAuction ? (listing.bidCount > 0 ? 'Current bid' : 'Starting bid') : 'Price'}
              </Text>
              <Text style={styles.price}>{formatMoney(listing.currentPrice)}</Text>
            </View>
            {isAuction && (
              <Text style={styles.bids}>
                {listing.bidCount} {listing.bidCount === 1 ? 'bid' : 'bids'}
              </Text>
            )}
          </View>

          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={styles.meta}>
              {listing.locationState ?? 'Malaysia'}
            </Text>
            {isAuction && listing.status === 'LIVE' && (
              <Countdown endsAt={listing.endsAt} style={styles.meta} />
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow,
  },
  wide: { flexDirection: 'row' },
  imageWrap: { aspectRatio: 4 / 3, backgroundColor: colors.bg },
  image: { width: '100%', height: '100%' },
  imageFallback: { backgroundColor: colors.border },
  chip: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  chipText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  closedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  body: { padding: spacing.md, gap: spacing.sm, flex: 1 },
  title: { fontSize: 13, fontWeight: '500', color: colors.text, lineHeight: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  priceLabel: { fontSize: 10, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.3 },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  bids: { fontSize: 11, color: colors.textMuted },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  meta: { fontSize: 11, color: colors.textMuted, flexShrink: 1 },
});
