import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { Button, Card, ErrorText, Field, H2, Muted, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/lib/theme';

const DEMO = [
  ['aisha@example.com', 'Buyer & seller'],
  ['admin@anybid.my', 'Admin console'],
  ['advertiser@brandco.my', 'Advertiser console'],
  ['procurement@megacorp.my', 'Corporate console'],
];

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email or password is incorrect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card style={{ padding: spacing.lg, gap: spacing.md }}>
            <Field
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
            />
            <ErrorText>{error}</ErrorText>
            <Button
              title="Sign in"
              loading={busy}
              disabled={!email || !password}
              onPress={submit}
              full
            />
          </Card>

          <Pressable onPress={() => router.replace('/auth/register')}>
            <Muted style={{ textAlign: 'center' }}>
              New to AnyBid? <Text style={{ color: colors.brand, fontWeight: '600' }}>Create an account</Text>
            </Muted>
          </Pressable>

          <Card style={{ padding: spacing.lg, gap: spacing.sm }}>
            <H2>Demo accounts</H2>
            <Muted>Every seeded account uses the password Password123.</Muted>
            {DEMO.map(([demoEmail, label]) => (
              <Pressable
                key={demoEmail}
                style={styles.demoRow}
                onPress={() => {
                  setEmail(demoEmail!);
                  setPassword('Password123');
                }}
              >
                <Text style={styles.demoEmail}>{demoEmail}</Text>
                <Text style={styles.demoLabel}>{label}</Text>
              </Pressable>
            ))}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  demoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  demoEmail: { fontSize: 12, color: colors.text, flexShrink: 1 },
  demoLabel: { fontSize: 11, color: colors.textMuted },
});
