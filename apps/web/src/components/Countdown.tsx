'use client';

import { useEffect, useState } from 'react';
import { formatCountdown, msRemaining } from '@anybid/shared';
import clsx from 'clsx';

interface Props {
  endsAt: string | null;
  className?: string;
  /** ticks every second under an hour, every minute above it */
  compact?: boolean;
  onEnd?: () => void;
}

/**
 * Countdown that renders nothing on the server pass, so a server-rendered
 * timestamp can never disagree with the client clock and trip hydration.
 */
export function Countdown({ endsAt, className, compact, onEnd }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) return;
    const update = () => {
      const ms = msRemaining(endsAt);
      setRemaining(ms);
      if (ms <= 0) onEnd?.();
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt, onEnd]);

  if (!endsAt) return <span className={className}>No closing time</span>;
  if (remaining === null) {
    return <span className={clsx('tabular-nums opacity-0', className)}>00m 00s</span>;
  }

  const urgent = remaining > 0 && remaining < 10 * 60_000;
  const soon = remaining > 0 && remaining < 60 * 60_000;

  return (
    <span
      className={clsx(
        'tabular-nums',
        urgent && 'font-semibold text-bid-600',
        !urgent && soon && 'font-medium text-amber-600',
        className,
      )}
    >
      {compact ? formatCountdown(remaining) : `${formatCountdown(remaining)} left`}
    </span>
  );
}
