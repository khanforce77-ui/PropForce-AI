'use client';

import { CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { addDays, uaeDate, uaeMidnight, type Viewing } from '@/lib/viewings';
import { BookViewing } from './book-viewing';
import { ViewingCard } from './viewing-card';

/** Viewings on one lead (last 60 days and upcoming) with a booking form. */
export function LeadViewings({
  agencyId,
  leadId,
  propertyId,
  canAssign,
  open,
  onChanged,
}: {
  agencyId: string;
  leadId: string;
  propertyId: string | null;
  canAssign: boolean;
  /** Closed leads show history only. */
  open: boolean;
  onChanged: (message: string) => void | Promise<void>;
}) {
  const { request } = useAuth();
  const [rows, setRows] = useState<Viewing[]>([]);
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    const today = uaeDate(new Date());
    const q = new URLSearchParams({
      leadId,
      from: uaeMidnight(addDays(today, -30)),
      to: uaeMidnight(addDays(today, 31)),
    });
    try {
      setRows((await request<{ data: Viewing[] }>(`/viewings?${q}`, { tenantId: agencyId })).data);
    } catch {
      setRows([]);
    }
  }, [agencyId, leadId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async (message: string) => {
    setBooking(false);
    await load();
    await onChanged(message);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Viewings</h2>
        {open && !booking ? (
          <Button size="sm" onClick={() => setBooking(true)}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Book viewing
          </Button>
        ) : null}
      </div>
      {booking ? (
        <div className="mt-4">
          <BookViewing
            agencyId={agencyId}
            leadId={leadId}
            defaultPropertyId={propertyId}
            canAssign={canAssign}
            onBooked={changed}
            onCancel={() => setBooking(false)}
          />
        </div>
      ) : null}
      {rows.length === 0 && !booking ? (
        <p className="mt-2 text-sm text-muted-foreground">No viewings yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((v) => (
            <ViewingCard
              key={v.id}
              agencyId={agencyId}
              viewing={v}
              showLead={false}
              showDate
              onChanged={changed}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
