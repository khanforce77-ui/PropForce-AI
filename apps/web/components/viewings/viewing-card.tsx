'use client';

import { Bot, Clock, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  placeLabel,
  timeLabel,
  VIEWING_STATUS_LABEL,
  VIEWING_STATUS_TONE,
  whenLabel,
  type Viewing,
  type ViewingStatus,
} from '@/lib/viewings';

export function ViewingStatusBadge({ status }: { status: ViewingStatus }) {
  return (
    <span
      className={cn('rounded-full px-2 py-0.5 text-xs font-medium', VIEWING_STATUS_TONE[status])}
    >
      {VIEWING_STATUS_LABEL[status]}
    </span>
  );
}

type Action = 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'reschedule';

/** One viewing with the actions that fit its status (confirm, done, no-show, move, cancel). */
export function ViewingCard({
  agencyId,
  viewing: v,
  showLead = true,
  showDate = false,
  onChanged,
}: {
  agencyId: string;
  viewing: Viewing;
  showLead?: boolean;
  showDate?: boolean;
  onChanged: (message: string) => void | Promise<void>;
}) {
  const { request } = useAuth();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const past = new Date(v.startsAt).getTime() <= Date.now();
  const open = v.status === 'requested' || v.status === 'confirmed';

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!action) return;
    setError(null);
    try {
      if (action === 'reschedule') {
        await request(`/viewings/${v.id}`, {
          tenantId: agencyId,
          method: 'PATCH',
          body: { startsAt: `${when}:00+04:00` },
        });
        await onChanged('Viewing moved.');
      } else {
        await request(`/viewings/${v.id}/status`, {
          tenantId: agencyId,
          method: 'POST',
          body: { status: action, outcome: text.trim() || null },
        });
        await onChanged(`Viewing ${VIEWING_STATUS_LABEL[action].toLowerCase()}.`);
      }
      setAction(null);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    }
  };

  const quick = (a: Action) => {
    setError(null);
    setAction(a);
    if (a === 'reschedule') {
      setWhen(new Date(new Date(v.startsAt).getTime() + 4 * 3_600_000).toISOString().slice(0, 16));
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {showDate ? whenLabel(v.startsAt) : `${timeLabel(v.startsAt)} – ${timeLabel(v.endsAt)}`}
          </p>
          {showLead ? (
            <Link href={`/app/${agencyId}/leads/${v.lead.id}`} className="hover:underline">
              {v.lead.contact.fullName}
            </Link>
          ) : null}
          <p className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <Link
              href={`/app/${agencyId}/listings/${v.property.id}`}
              className="truncate hover:underline"
            >
              {v.property.reference} · {placeLabel(v.property)}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            {v.agent.user.fullName}
            {v.source === 'ai' ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <Bot className="h-3 w-3" aria-hidden /> Requested on WhatsApp
              </span>
            ) : null}
          </p>
          {v.notes ? <p className="mt-1 text-xs">{v.notes}</p> : null}
          {v.outcome ? <p className="mt-1 text-xs italic">{v.outcome}</p> : null}
        </div>
        <ViewingStatusBadge status={v.status} />
      </div>

      {open && !action ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {v.status === 'requested' ? (
            <Button size="sm" onClick={() => quick('confirmed')}>
              Confirm
            </Button>
          ) : null}
          {v.status === 'confirmed' && past ? (
            <>
              <Button size="sm" onClick={() => quick('completed')}>
                Mark done
              </Button>
              <Button size="sm" variant="outline" onClick={() => quick('no_show')}>
                No-show
              </Button>
            </>
          ) : null}
          {!past ? (
            <Button size="sm" variant="outline" onClick={() => quick('reschedule')}>
              Move
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600"
            onClick={() => quick('cancelled')}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {action ? (
        <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-wrap items-end gap-2">
          {action === 'reschedule' ? (
            <Input
              type="datetime-local"
              aria-label="New time (UAE)"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="max-w-56"
            />
          ) : action === 'confirmed' ? null : (
            <Input
              aria-label={action === 'cancelled' ? 'Why is it cancelled?' : 'How did it go?'}
              placeholder={
                action === 'cancelled' ? 'Why is it cancelled?' : 'How did it go? (optional)'
              }
              required={action === 'cancelled'}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-w-48 flex-1"
            />
          )}
          <Button size="sm" type="submit">
            {action === 'reschedule'
              ? 'Save time'
              : action === 'cancelled'
                ? 'Cancel viewing'
                : `Mark ${VIEWING_STATUS_LABEL[action].toLowerCase()}`}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAction(null)}>
            Back
          </Button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
