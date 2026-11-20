import type { PropertyStatus } from '@/lib/api';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/listings';
import { cn } from '@/lib/utils';

export function StatusBadge({ status }: { status: PropertyStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
