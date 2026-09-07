import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { Button, Card, ErrorText, Field, Muted, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/lib/theme';

const EXTRA_ROLES = [
  ['ADVERTISER', 'Advertising', 'Run promoted placements across AnyBid.'],
  ['CORPORATE', 'Company buying', 'Purchase for an organisation with approvals and budgets.'],
] as const;

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await register({
        displayName,
        email: email.trim(),
        password,
        accountType: roles.includes('CORPORATE') ? 'BUSINESS' : 'PERSONAL',
        requestRoles: roles,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card style={{ padding: spacing.lg, gap: spacing.md }}>
            <Field label="Your name" value={displayName} onChangeText={setDisplayName} placeholder="Aisha Rahman" />
            <Field
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              hint="At least 10 characters, with a letter and a number."
            />

            <View style={{ gap: spacing.sm }}>
              <Text style={styles.label}>What else will you use AnyBid for?</Text>
              {EXTRA_ROLES.map(([value, title, body]) => {
                const selected = roles.includes(value);
                return (
                  <Pressable
                    key={value}
                    style={[styles.roleOption, selected && styles.roleOptionActive]}
                    onPress={() =>
                      setRoles((prev) =>
                        prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value],
                      )
                    }
                  >
                    <Text style={styles.roleTitle}>{title}</Text>
                    <Text style={styles.roleBody}>{body}</Text>
                  </Pressable>
                );
              })}
            </View>

            <ErrorText>{error}</ErrorText>
            <Button
              title="Create account"
              loading={busy}
              disabled={!displayName || !email || password.length < 10}
              onPress={submit}
              full
            />
          </Card>

          <Pressable onPress={() => router.replace('/auth/sign-in')}>
            <Muted style={{ textAlign: 'center' }}>
              Already have an account?{' '}
              <Text style={{ color: colors.brand, fontWeight: '600' }}>Sign in</Text>
            </Muted>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '500', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  roleOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  roleOptionActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  roleTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  roleBody: { fontSize: 12, color: colors.textMuted },
});
