/**
 * Shown when the marketplace API cannot be reached. It says what is wrong
 * rather than showing an empty grid that looks like "no listings exist".
 */
export function ServiceUnavailable({
  what = 'Listings',
  compact,
}: {
  what?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`card border-amber-200 bg-amber-50 text-center ${compact ? 'p-5' : 'p-10'}`}
      role="status"
    >
      <p className="text-sm font-semibold text-amber-900">{what} are temporarily unavailable</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-amber-800">
        We can&apos;t reach the AnyBid marketplace service right now. Bidding and search will be
        back as soon as it is. Nothing you have bid on is affected.
      </p>
    </div>
  );
}
