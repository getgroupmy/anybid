import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ApprovalRequest, Organization, OrgMember } from '@anybid/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { formatMoney, relativeTime } from '../../src/lib/format';
import { Badge, Body, Button, Card, Empty, H2, Loading, Muted, Row, Screen } from '../../src/components/ui';
import { Countdown } from '../../src/components/Countdown';
import { colors, spacing } from '../../src/lib/theme';

interface Totals {
  budget: number;
  spent: number;
  committed: number;
  remaining: number;
  outstanding?: number;
  creditLimit?: number;
}

export default function CorporateConsole() {
  const router = useRouter();
  const { user } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [o, spend, pending, team] = await Promise.all([
        api.corporate.org(),
        api.corporate.spend(),
        api.corporate.approvals({ status: 'PENDING', perPage: 20 }),
        api.corporate.members(),
      ]);
      setOrg(o.organization);
      setTotals(spend.totals as Totals);
      setApprovals(pending.items);
      setMembers(team.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'You are not part of an organisation');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const canApprove = ['OWNER', 'ADMIN', 'APPROVER'].includes(user?.orgRole ?? '');

  async function decide(approval: ApprovalRequest, decision: 'APPROVE' | 'REJECT') {
    setBusyId(approval.id);
    try {
      await api.corporate.decide(approval.id, { decision });
      await load();
    } catch (err) {
      Alert.alert('Could not record the decision', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusyId(null);
    }
  }

  if (error && !org) {
    return (
      <Screen>
        <Empty title="No organisation" body={error} />
        <Button
          title="Set one up on the web"
          variant="secondary"
          onPress={() => router.back()}
          style={{ marginHorizontal: spacing.xl }}
        />
      </Screen>
    );
  }
  if (!org || !totals) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const used = org.monthlyBudget > 0 ? (totals.spent / org.monthlyBudget) * 100 : 0;

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
          <Muted>{org.name}</Muted>
          <Text style={styles.spend}>{formatMoney(totals.spent)}</Text>
          <Muted>spent this month of {formatMoney(org.monthlyBudget)}</Muted>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, used)}%`,
                  backgroundColor: used > 90 ? colors.danger : used > 70 ? colors.warn : colors.good,
                },
              ]}
            />
          </View>

          <Row label="Committed in live bids" value={formatMoney(totals.committed)} />
          <Row label="Remaining" value={formatMoney(totals.remaining)} strong />
          <Row
            label="Credit used"
            value={`${formatMoney(totals.outstanding ?? 0)} of ${formatMoney(org.creditLimit)}`}
          />
          <Row label="Payment terms" value={org.paymentTerms.replace('_', ' ')} />
        </Card>

        <H2>
          Approvals{approvals.length > 0 ? ` (${approvals.length})` : ''}
        </H2>
        {approvals.length === 0 ? (
          <Card>
            <Empty
              title="Nothing pending"
              body="Bids above a member's threshold wait here for sign-off before they reach the auction."
            />
          </Card>
        ) : (
          approvals.map((a) => {
            const mine = a.requestedBy.id === user?.id;
            return (
              <Card key={a.id} style={{ padding: spacing.lg, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  {a.listing.image && (
                    <Image source={{ uri: a.listing.image }} style={styles.thumb} contentFit="cover" />
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body numberOfLines={2} style={{ fontWeight: '500' }}>
                      {a.listing.title}
                    </Body>
                    <Muted style={{ fontSize: 11 }}>
                      {a.requestedBy.displayName} · {relativeTime(a.createdAt)}
                    </Muted>
                    {a.reference && <Muted style={{ fontSize: 11 }}>{a.reference}</Muted>}
                  </View>
                </View>

                <Row label="Requested maximum" value={formatMoney(a.amount)} strong />
                <Row label="Current price" value={formatMoney(a.listing.currentPrice)} />
                {a.listing.endsAt && (
                  <View style={styles.closeRow}>
                    <Muted>Auction closes in</Muted>
                    <Countdown endsAt={a.listing.endsAt} style={styles.closeValue} />
                  </View>
                )}

                {mine ? (
                  <Badge label="Waiting on an approver" tone="warn" />
                ) : canApprove ? (
                  <View style={{ gap: spacing.sm }}>
                    <Button
                      title={`Approve ${formatMoney(a.amount)}`}
                      loading={busyId === a.id}
                      onPress={() => decide(a, 'APPROVE')}
                      full
                    />
                    <Button
                      title="Decline"
                      variant="secondary"
                      disabled={busyId === a.id}
                      onPress={() => decide(a, 'REJECT')}
                      full
                    />
                  </View>
                ) : (
                  <Badge label="Pending approval" tone="warn" />
                )}
              </Card>
            );
          })
        )}

        <H2>Team</H2>
        <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
          {members.map((m) => (
            <View key={m.id} style={styles.memberRow}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '500' }}>{m.user.displayName}</Body>
                <Muted style={{ fontSize: 11 }}>
                  {m.orgRole} ·{' '}
                  {m.approvalThreshold === null
                    ? `default ${formatMoney(org.defaultApprovalThreshold)}`
                    : m.approvalThreshold === 0
                      ? 'no limit'
                      : `above ${formatMoney(m.approvalThreshold)}`}
                </Muted>
              </View>
              <Text style={styles.memberSpend}>{formatMoney(m.spentThisMonth)}</Text>
            </View>
          ))}
        </Card>

        <Muted style={{ textAlign: 'center', fontSize: 11 }}>
          Seats, budgets and invoices are managed in the Corporate console on the web.
        </Muted>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spend: { fontSize: 30, fontWeight: '700', color: colors.text },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  progressFill: { height: '100%', borderRadius: 4 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.border },
  closeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  memberSpend: { fontSize: 14, fontWeight: '600', color: colors.text },
});
