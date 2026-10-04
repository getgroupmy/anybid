import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { computeFees, DEFAULT_FEES, type Category, type ListingSummary } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { formatMoney, moneyInputToMinor, unreadableMoney } from '../../src/lib/format';
import { uploadListingPhotos } from '../../src/lib/upload';
import { Badge, Body, Button, Card, ErrorText, Field, H2, Muted, Row, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/lib/theme';

/** Matches the `images` cap in the shared createListingSchema. */
const MAX_PHOTOS = 12;

const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'REFURBISHED', 'FOR_PARTS'] as const;
const DURATIONS = [
  [24, '1 day'],
  [72, '3 days'],
  [168, '7 days'],
] as const;

export default function SellScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [mine, setMine] = useState<ListingSummary[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>('GOOD');
  const [startPrice, setStartPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [buyNowPrice, setBuyNowPrice] = useState('');
  const [durationHours, setDurationHours] = useState(72);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cats, listings] = await Promise.all([
        api.categories.tree(),
        user ? api.listings.mine({ perPage: 10, status: 'ALL' }) : Promise.resolve(null),
      ]);
      setCategories(cats.categories);
      if (listings) setMine(listings.items);
    } catch {
      /* keep whatever is on screen */
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const fees = useMemo(() => {
    const minor = moneyInputToMinor(startPrice);
    return minor > 0 ? computeFees(minor, DEFAULT_FEES) : null;
  }, [startPrice]);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('AnyBid needs photo access to add pictures to your listing.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS,
    });
    if (result.canceled) return;

    const room = MAX_PHOTOS - images.length;
    if (room <= 0) {
      setError(`A listing can have ${MAX_PHOTOS} photos.`);
      return;
    }

    // Upload straight away rather than at submit, so a failure surfaces while
    // the seller is still looking at the photo they picked.
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadListingPhotos(result.assets.slice(0, room).map((a) => a.uri));
      setImages((prev) => [...prev, ...uploaded].slice(0, MAX_PHOTOS));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      title,
      description,
      categoryId,
      kind: buyNowPrice ? ('AUCTION_WITH_BUY_NOW' as const) : ('AUCTION' as const),
      condition,
      quantity: 1,
      images,
      startPrice: moneyInputToMinor(startPrice),
      reservePrice: reservePrice ? moneyInputToMinor(reservePrice) : null,
      buyNowPrice: buyNowPrice ? moneyInputToMinor(buyNowPrice) : null,
      durationHours,
      shippingCost: 15_00,
      localPickup: true,
      antiSnipeWindowSec: 120,
      antiSnipeExtensionSec: 120,
      tags: [],
    };

    // An unreadable price must not be sent: JSON turns NaN into null, and null
    // is how a reserve says there isn't one.
    const unreadable = unreadableMoney(payload);
    if (Object.keys(unreadable).length > 0) {
      setError('Check the prices — one of them is not an amount.');
      setBusy(false);
      return;
    }

    try {
      const { listing } = await api.listings.create(payload);
      setTitle('');
      setDescription('');
      setStartPrice('');
      setReservePrice('');
      setBuyNowPrice('');
      setImages([]);
      router.push(`/listing/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The listing could not be created');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <Screen>
        <View style={styles.signedOut}>
          <H2>Sell on AnyBid</H2>
          <Muted style={{ textAlign: 'center' }}>
            Sign in to list an item and let the market set the price.
          </Muted>
          <Button title="Sign in" onPress={() => router.push('/auth/sign-in')} full />
        </View>
      </Screen>
    );
  }

  const subcategories = categories.flatMap((c) => c.children ?? []);
  const ready = title.length >= 6 && description.length >= 20 && categoryId && startPrice;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
          <Card style={{ padding: spacing.lg, gap: spacing.md }}>
            <H2>List an item</H2>

            <Field
              label="Title"
              placeholder="iPhone 15 Pro Max 256GB"
              value={title}
              onChangeText={setTitle}
              hint="At least 6 characters. Model, capacity, colour."
            />

            <Field
              label="Description"
              placeholder="Condition, what is included, any flaws…"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              style={{ minHeight: 110, textAlignVertical: 'top' }}
              hint="At least 20 characters. Mentioning flaws saves disputes later."
            />

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {subcategories.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setCategoryId(c.id)}
                    style={[styles.chip, categoryId === c.id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Condition</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {CONDITIONS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCondition(c)}
                    style={[styles.chip, condition === c && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, condition === c && styles.chipTextActive]}>
                      {c.replace(/_/g, ' ').toLowerCase()}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <Pressable
                  style={styles.addPhoto}
                  onPress={pickImage}
                  disabled={uploading || images.length >= MAX_PHOTOS}
                >
                  <Text style={{ fontSize: 22, color: colors.textMuted }}>
                    {uploading ? '…' : '＋'}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>
                    {uploading ? 'Sending' : 'Add'}
                  </Text>
                </Pressable>
                {images.map((uri) => (
                  <Pressable key={uri} onLongPress={() => setImages((p) => p.filter((x) => x !== uri))}>
                    <Image source={{ uri }} style={styles.photo} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
              <Muted style={{ fontSize: 11 }}>
                Long-press a photo to remove it. The first is the cover.
              </Muted>
            </View>
          </Card>

          <Card style={{ padding: spacing.lg, gap: spacing.md }}>
            <H2>Price and duration</H2>

            <Field
              label="Starting price (RM)"
              keyboardType="decimal-pad"
              placeholder="100.00"
              value={startPrice}
              onChangeText={setStartPrice}
              hint="Start low to attract bidders — the auction finds the real price."
            />
            <Field
              label="Reserve (optional, RM)"
              keyboardType="decimal-pad"
              placeholder="Hidden floor"
              value={reservePrice}
              onChangeText={setReservePrice}
              hint="Bidders see only whether it has been met. Nothing sells below it."
            />
            <Field
              label="Buy-now price (optional, RM)"
              keyboardType="decimal-pad"
              placeholder="Ends the auction instantly"
              value={buyNowPrice}
              onChangeText={setBuyNowPrice}
            />

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Duration</Text>
              <View style={styles.chipRow}>
                {DURATIONS.map(([hours, label]) => (
                  <Pressable
                    key={hours}
                    onPress={() => setDurationHours(hours)}
                    style={[styles.chip, durationHours === hours && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, durationHours === hours && styles.chipTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {fees && (
              <View style={styles.feeBox}>
                <Muted style={{ fontWeight: '600', color: colors.text }}>
                  If it sells at your starting price
                </Muted>
                <Row label="Hammer price" value={formatMoney(fees.hammerPrice)} />
                <Row label="AnyBid commission" value={`− ${formatMoney(fees.sellerCommission)}`} />
                <Row label="You receive" value={formatMoney(fees.sellerPayout)} strong />
              </View>
            )}

            <ErrorText>{error}</ErrorText>

            <Button
              title={busy ? 'Publishing…' : 'Publish listing'}
              loading={busy}
              disabled={!ready}
              onPress={submit}
              full
            />
          </Card>

          {mine.length > 0 && (
            <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
              <H2>Your listings</H2>
              {mine.map((l) => (
                <Pressable
                  key={l.id}
                  style={styles.mineRow}
                  onPress={() => router.push(`/listing/${l.id}`)}
                >
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontWeight: '500' }}>
                      {l.title}
                    </Body>
                    <Muted>
                      {formatMoney(l.currentPrice)} · {l.bidCount} bids
                    </Muted>
                  </View>
                  <Badge label={l.status} tone={l.status === 'LIVE' ? 'good' : 'neutral'} />
                </Pressable>
              ))}
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signedOut: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  label: { fontSize: 11, fontWeight: '500', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  chipTextActive: { color: '#fff' },
  addPhoto: {
    width: 68,
    height: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: 68, height: 68, borderRadius: radius.md },
  feeBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  mineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
