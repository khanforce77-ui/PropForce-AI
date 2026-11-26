'use client';

import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { Alert, Card } from '@/components/ui/card';
import type { PropertyDetail } from '@/lib/api';

/** PropForce's review state, shown above the listing so the agent knows why it is or isn't live. */
export function ReviewNotice({ property }: { property: PropertyDetail }) {
  if (property.reviewStatus === 'pending' && property.status === 'active') {
    return (
      <Alert>
        Waiting for PropForce review. The listing goes on the portal once a reviewer approves it,
        usually within one working day.
        {property.reviewReason ? ` Note from PropForce: ${property.reviewReason}` : ''}
      </Alert>
    );
  }
  if (property.reviewStatus === 'rejected') {
    return (
      <Alert>
        PropForce did not approve this listing
        {property.reviewReason ? `: ${property.reviewReason}` : '.'} Fix it and publish again to
        send it for a new review.
      </Alert>
    );
  }
  return null;
}

/** The same checklist PropForce reviewers see. Required items block publishing. */
export function QualityChecklist({ property }: { property: PropertyDetail }) {
  const checks = property.qualityChecks ?? [];
  if (checks.length === 0) return null;
  const done = checks.filter((c) => c.ok).length;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Listing quality
        </h2>
        <span className="text-sm text-muted-foreground">
          {done} of {checks.length} done
        </span>
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <Circle
                className={`mt-0.5 h-4 w-4 shrink-0 ${c.required ? 'text-red-600' : 'text-muted-foreground'}`}
                aria-hidden
              />
            )}
            <span className={c.ok ? '' : c.required ? 'text-red-600' : 'text-muted-foreground'}>
              {c.label}
              {!c.ok && c.required ? ' (required)' : ''}
              <span className="sr-only">{c.ok ? ' – done' : ' – not done'}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
