'use client';

import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BookViewing } from '@/components/viewings/book-viewing';
import { ViewingCard } from '@/components/viewings/viewing-card';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ApiError, type Member } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { canManageCrm } from '@/lib/crm';
import { cn } from '@/lib/utils';
import { addDays, dayLabel, uaeDate, uaeMidnight, weekStart, type Viewing } from '@/lib/viewings';

export default function CalendarPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const manage = canManageCrm(useAgencyMembership()?.role);
  const today = uaeDate(new Date());
  const [week, setWeek] = useState(weekStart(today));
  const [agent, setAgent] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Viewing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({
      from: uaeMidnight(week),
      to: uaeMidnight(addDays(week, 7)),
    });
    if (agent) q.set('agentMembershipId', agent);
    try {
      setRows((await request<{ data: Viewing[] }>(`/viewings?${q}`, { tenantId: agencyId })).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the calendar.');
    }
  }, [agencyId, agent, request, week]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!manage) return;
    void request<{ data: Member[] }>('/members', { tenantId: agencyId })
      .then((r) => setMembers(r.data.filter((m) => m.status === 'active')))
      .catch(() => setMembers([]));
  }, [agencyId, manage, request]);

  const changed = async (message: string) => {
    setNotice(message);
    setError(null);
    setBooking(false);
    await load();
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay = new Map<string, Viewing[]>();
  for (const v of rows ?? []) {
    const d = uaeDate(new Date(v.startsAt));
    byDay.set(d, [...(byDay.get(d) ?? []), v]);
  }
  const pending = (rows ?? []).filter((v) => v.status === 'requested').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarDays className="h-6 w-6" aria-hidden /> Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Viewings in UAE time. Bookings keep 15 minutes free between viewings for travel.
          </p>
        </div>
        <Button onClick={() => setBooking((b) => !b)}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> Book viewing
        </Button>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {booking ? (
        <Card>
          <h2 className="mb-4 font-medium">Book a viewing</h2>
          <BookViewing
            agencyId={agencyId}
            canAssign={manage}
            onBooked={changed}
            onCancel={() => setBooking(false)}
          />
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous week"
          onClick={() => setWeek(addDays(week, -7))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setWeek(weekStart(today))}>
          This week
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next week"
          onClick={() => setWeek(addDays(week, 7))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-sm font-medium">
          {dayLabel(week)} – {dayLabel(addDays(week, 6))}
        </span>
        {pending ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {pending} to confirm
          </span>
        ) : null}
        {manage ? (
          <Select
            aria-label="Agent"
            className="ml-auto max-w-56"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">All agents</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.fullName}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => (
            <section
              key={d}
              className={cn(
                'flex min-h-32 flex-col gap-2 rounded-xl border border-border bg-card p-2',
                d === today && 'border-primary',
              )}
            >
              <h2 className={cn('px-1 text-sm font-medium', d === today && 'text-primary')}>
                {dayLabel(d)}
              </h2>
              {(byDay.get(d) ?? []).map((v) => (
                <ViewingCard key={v.id} agencyId={agencyId} viewing={v} onChanged={changed} />
              ))}
              {!byDay.get(d)?.length ? (
                <p className="px-1 text-xs text-muted-foreground">No viewings</p>
              ) : null}
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Google Calendar sync is not connected yet: viewings live in PropForce only, and busy times
        in an agent&apos;s Google Calendar are not checked.
      </p>
    </div>
  );
}
