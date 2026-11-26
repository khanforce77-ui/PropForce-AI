import type { ListingReviewStatus, PropertyStatus } from '@/lib/api';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/listings';
import { cn } from '@/lib/utils';

export function StatusBadge({
  status,
  reviewStatus,
}: {
  status: PropertyStatus;
  /** A live listing waiting for (or refused by) PropForce's review is not on the portal yet. */
  reviewStatus?: ListingReviewStatus;
}) {
  const inReview = status === 'active' && reviewStatus === 'pending';
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        inReview
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
          : STATUS_TONE[status],
      )}
    >
      {inReview ? 'In review' : STATUS_LABEL[status]}
    </span>
  );
}
