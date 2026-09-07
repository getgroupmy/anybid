import { useEffect, useState } from 'react';
import { Text, type TextStyle } from 'react-native';
import { formatCountdown, msRemaining } from '@anybid/shared';
import { colors } from '../lib/theme';

export function Countdown({
  endsAt,
  style,
  suffix,
}: {
  endsAt: string | null;
  style?: TextStyle;
  suffix?: string;
}) {
  const [remaining, setRemaining] = useState(() => (endsAt ? msRemaining(endsAt) : 0));

  useEffect(() => {
    if (!endsAt) return;
    setRemaining(msRemaining(endsAt));
    const timer = setInterval(() => setRemaining(msRemaining(endsAt)), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (!endsAt) return <Text style={style}>—</Text>;

  const urgent = remaining > 0 && remaining < 10 * 60_000;
  const soon = remaining > 0 && remaining < 60 * 60_000;

  return (
    <Text
      style={[
        style,
        urgent ? { color: colors.brand, fontWeight: '700' } : soon ? { color: colors.warn } : null,
      ]}
    >
      {formatCountdown(remaining)}
      {suffix && remaining > 0 ? suffix : ''}
    </Text>
  );
}
