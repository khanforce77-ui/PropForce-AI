import { STAGE_LABEL, STAGE_TONE, type LeadStage } from '@/lib/crm';
import { cn } from '@/lib/utils';

export function StageBadge({ stage }: { stage: LeadStage }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STAGE_TONE[stage],
      )}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
