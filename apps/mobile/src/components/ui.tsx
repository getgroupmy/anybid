import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { colors, radius, shadow, spacing, type } from '../lib/theme';

export function Card({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, style]} />;
}

export function Screen({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.screen, style]} />;
}

export function H1({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.h1, style]} />;
}
export function H2({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.h2, style]} />;
}
export function Body({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.body, style]} />;
}
export function Muted({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.muted, style]} />;
}

interface ButtonProps extends PressableProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  full?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  loading,
  full,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        full && { alignSelf: 'stretch' },
        isDisabled && { opacity: 0.5 },
        pressed && !isDisabled && { opacity: 0.85 },
        style as object,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.text} size="small" />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && { color: '#fff' },
            variant === 'ghost' && { color: colors.textMuted },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, style, ...props },
  ref,
) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...props}
      />
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
});

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}) {
  const palette = {
    neutral: { bg: colors.bg, fg: colors.textMuted },
    good: { bg: colors.goodSoft, fg: colors.good },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    bad: { bg: colors.dangerSoft, fg: colors.danger },
    brand: { bg: colors.brandSoft, fg: colors.brandDark },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorBoxText}>{children}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.brand} />
      {label && <Muted style={{ marginTop: spacing.sm }}>{label}</Muted>}
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontSize: 16, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow,
  },
  h1: { ...type.h1, color: colors.text },
  h2: { ...type.h2, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.small, color: colors.textMuted },
  label: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  hintText: { ...type.small, color: colors.textFaint },
  errorText: { ...type.small, color: colors.danger },
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.text },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBoxText: { color: colors.danger, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.xl, gap: 4 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptyBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  loading: { paddingVertical: 48, alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 5 },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 14, fontWeight: '500', color: colors.text, textAlign: 'right', flexShrink: 1 },
});
