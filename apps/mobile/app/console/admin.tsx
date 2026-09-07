import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AdminMetrics, AuditEntry } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { formatMoney, formatMoneyCompact, relativeTime } from '../../src/lib/format';
import { Card, Empty, H2, Loading, Muted, Screen } from '../../src/components/ui';
import { colors, spacing } from '../../src/lib/theme';

export default function AdminConsole() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [m, a] = await Promise.all([api.admin.metrics(), api.admin.audit({ perPage: 10 })]);
      setMetrics(m);
      setAudit(a.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load metrics');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (error) {
    return (
      <Screen>
        <Empty title="Admin access required" body={error} />
      </Screen>
    );
  }
  if (!metrics) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const maxGmv = Math.max(1, ...metrics.timeseries.map((t) => t.gmv));

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
        <View style={styles.grid}>
          <Stat label="GMV 30d" value={formatMoneyCompact(metrics.gmv.last30d)} />
          <Stat label="Commission" value={formatMoneyCompact(metrics.revenue.commission)} tone="good" />
          <Stat label="Live auctions" value={metrics.listings.live.toLocaleString()} />
          <Stat label="Bids 24h" value={metrics.bids.last24h.toLocaleString()} />
          <Stat label="Users" value={metrics.users.total.toLocaleString()} />
          <Stat
            label="Open disputes"
            value={String(metrics.orders.disputed)}
            tone={metrics.orders.disputed > 0 ? 'bad' : undefined}
          />
        </View>

        <Card style={{ padding: spacing.lg, gap: spacing.md }}>
          <H2>GMV — last 14 days</H2>
          <View style={styles.chart}>
            {metrics.timeseries.map((point) => (
              <View key={point.date} style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${Math.max(2, (point.gmv / maxGmv) * 100)}%`,
                      opacity: point.gmv === 0 ? 0.2 : 0.9,
                    },
                  ]}
                />
                <Text style={styles.barLabel}>{point.date.slice(8)}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
          <H2>Needs attention</H2>
          <Line label="Awaiting review" value={metrics.listings.pendingReview} />
          <Line label="Awaiting payment" value={metrics.orders.awaitingPayment} />
          <Line label="KYC pending" value={metrics.users.pendingKyc} />
          <Line label="Suspended accounts" value={metrics.users.suspended} />
          <Line label="Closing within the hour" value={metrics.listings.endingSoon} />
        </Card>

        <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
          <H2>Recent admin actions</H2>
          {audit.map((entry) => (
            <View key={entry.id} style={styles.auditRow}>
              <Text style={styles.auditAction}>{entry.action}</Text>
              <Muted style={{ flex: 1 }} numberOfLines={1}>
                {entry.actor?.displayName ?? 'system'}
              </Muted>
              <Muted style={{ fontSize: 10 }}>{relativeTime(entry.createdAt)}</Muted>
            </View>
          ))}
        </Card>

        <Muted style={{ textAlign: 'center', fontSize: 11 }}>
          Moderation, user management and settings live in the full Admin console on the web.
        </Muted>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <Card style={styles.stat}>
      <Text
        style={[
          styles.statValue,
          tone === 'good' && { color: colors.good },
          tone === 'bad' && { color: colors.danger },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.line}>
      <Muted>{label}</Muted>
      <Text style={styles.lineValue}>{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { width: '31%', flexGrow: 1, padding: spacing.md, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 120 },
  barSlot: { flex: 1, alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.brand, borderRadius: 2 },
  barLabel: { fontSize: 8, color: colors.textFaint },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  lineValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  auditAction: { fontSize: 11, fontWeight: '600', color: colors.text },
});
