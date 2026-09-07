import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { AdPlacement, ServedAd } from '@anybid/shared';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

/** Sponsored card. Clicks route through the API so the advertiser is billed. */
export function AdCard({ placement, categoryId }: { placement: AdPlacement; categoryId?: string }) {
  const [ad, setAd] = useState<ServedAd | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.ads
      .serve(placement, { categoryId, limit: 1 })
      .then((res) => {
        if (!cancelled) setAd(res.ads[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [placement, categoryId]);

  if (!ad) return null;

  async function open() {
    if (!ad) return;
    try {
      const { redirectUrl } = await api.ads.click(ad.slotId);
      await Linking.openURL(redirectUrl);
    } catch {
      await Linking.openURL(ad.ctaUrl).catch(() => undefined);
    }
  }

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={open}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: ad.imageUrl }} style={styles.image} contentFit="cover" transition={150} />
        <View style={styles.sponsored}>
          <Text style={styles.sponsoredText}>Sponsored</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.headline}>{ad.headline}</Text>
        {ad.body && (
          <Text numberOfLines={2} style={styles.sub}>
            {ad.body}
          </Text>
        )}
        <View style={styles.footer}>
          <Text style={styles.cta}>{ad.ctaLabel} →</Text>
          <Text numberOfLines={1} style={styles.advertiser}>
            {ad.advertiserName}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  imageWrap: { aspectRatio: 3 / 1, backgroundColor: colors.bg },
  image: { width: '100%', height: '100%' },
  sponsored: {
    position: 'absolute',
    right: 6,
    top: 6,
    backgroundColor: 'rgba(33,38,47,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  sponsoredText: { color: '#fff', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  body: { padding: spacing.md, gap: 3 },
  headline: { fontSize: 14, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, gap: spacing.sm },
  cta: { fontSize: 12, fontWeight: '600', color: colors.brand },
  advertiser: { fontSize: 11, color: colors.textFaint, flexShrink: 1 },
});
