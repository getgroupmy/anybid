import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Campaign } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { formatMoney } from '../../src/lib/format';
import { Badge, Body, Button, Card, Empty, H2, Loading, Muted, Row, Screen } from '../../src/components/ui';
import { colors, spacing } from '../../src/lib/theme';

interface Overview {
  balance: number;
  spendToday: number;
  impressions: number;
  clicks: number;
  campaigns: number;
  companyName: string;
}

function tone(status: string) {
  if (status === 'ACTIVE') return 'good' as const;
  if (['PAUSED', 'PENDING_REVIEW'].includes(status)) return 'warn' as const;
  if (['REJECTED', 'OUT_OF_BUDGET'].includes(status)) return 'bad' as const;
  return 'neutral' as const;
}

export default function AdvertiserConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [o, c] = await Promise.all([
        api.advertiser.overview() as Promise<Overview>,
        api.advertiser.campaigns({ perPage: 20 }),
      ]);
      setOverview(o);
      setCampaigns(c.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your campaigns');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggle(campaign: Campaign) {
    setBusyId(campaign.id);
    try {
      await api.advertiser.setCampaignStatus(
        campaign.id,
        campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status');
    } finally {
      setBusyId(null);
    }
  }

  async function topUp() {
    setBusyId('wallet');
    try {
      await api.advertiser.topUp({ amount: 100_00, method: 'FPX' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setBusyId(null);
    }
  }

  if (error && !overview) {
    return (
      <Screen>
        <Empty title="Advertiser access required" body={error} />
      </Screen>
    );
  }
  if (!overview) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const ctr = overview.impressions ? ((overview.clicks / overview.impressions) * 100).toFixed(2) : '0.00';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
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
      >
        <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Muted>{overview.companyName}</Muted>
          <Text style={styles.balance}>{formatMoney(overview.balance)}</Text>
          <Muted>Ad wallet balance · {formatMoney(overview.spendToday)} spent today</Muted>
          <Button
            title="Top up RM100"
            variant="secondary"
            loading={busyId === 'wallet'}
            onPress={topUp}
            full
          />
        </Card>

        <View style={styles.statRow}>
          <Stat label="Impressions" value={overview.impressions.toLocaleString()} />
          <Stat label="Clicks" value={overview.clicks.toLocaleString()} />
          <Stat label="CTR" value={`${ctr}%`} />
        </View>

        <H2>Campaigns</H2>
        {campaigns.length === 0 ? (
          <Card>
            <Empty title="No campaigns" body="Create one in the Advertiser console on the web." />
          </Card>
        ) : (
          campaigns.map((c) => (
            <Card key={c.id} style={{ padding: spacing.lg, gap: spacing.sm }}>
              <View style={styles.campaignHead}>
                <Body style={{ fontWeight: '600', flex: 1 }}>{c.name}</Body>
                <Badge label={c.status.replace(/_/g, ' ')} tone={tone(c.status)} />
              </View>

              <Row label="Bid" value={`${formatMoney(c.bidAmount)} ${c.pricingModel}`} />
              <Row label="Today" value={`${formatMoney(c.spendToday)} of ${formatMoney(c.dailyBudget)}`} />
              <Row label="Impressions" value={c.impressions.toLocaleString()} />
              <Row label="Clicks" value={`${c.clicks.toLocaleString()} (${c.ctr}%)`} />
              <Row label="Total spend" value={formatMoney(c.spend)} strong />

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, c.dailyBudget ? (c.spendToday / c.dailyBudget) * 100 : 0)}%`,
                    },
                  ]}
                />
              </View>

              {['ACTIVE', 'PAUSED', 'DRAFT', 'OUT_OF_BUDGET'].includes(c.status) && (
                <Button
                  title={c.status === 'ACTIVE' ? 'Pause campaign' : 'Activate campaign'}
                  variant="secondary"
                  loading={busyId === c.id}
                  onPress={() => toggle(c)}
                  full
                />
              )}
            </Card>
          ))
        )}

        {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  balance: { fontSize: 30, fontWeight: '700', color: colors.text },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, padding: spacing.md, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted },
  campaignHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.brand, borderRadius: 3 },
});
