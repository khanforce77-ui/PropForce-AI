export type ViewingStatus = 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Viewing {
  id: string;
  startsAt: string;
  endsAt: string;
  status: ViewingStatus;
  source: 'agent' | 'ai' | 'portal';
  notes: string | null;
  outcome: string | null;
  confirmedAt: string | null;
  lead: {
    id: string;
    stage: string;
    contact: { id: string; fullName: string; phoneE164: string | null };
  };
  property: {
    id: string;
    reference: string;
    title: string | null;
    community: string | null;
    building: string | null;
    unitNo: string | null;
    emirate: string;
  };
  agent: { id: string; user: { fullName: string } };
}

export const VIEWING_STATUS_LABEL: Record<ViewingStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  completed: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const VIEWING_STATUS_TONE: Record<ViewingStatus, string> = {
  requested: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  completed: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  cancelled: 'bg-muted text-muted-foreground line-through',
  no_show: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

const UAE_OFFSET_MS = 4 * 3_600_000;

/** YYYY-MM-DD of an instant in UAE time. */
export const uaeDate = (d: Date) =>
  new Date(d.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);

/** Midnight UAE time of a YYYY-MM-DD day, as an ISO string with offset. */
export const uaeMidnight = (day: string) => `${day}T00:00:00+04:00`;

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Monday of the UAE week containing `day`. */
export const weekStart = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
};

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AE', {
    timeZone: 'Asia/Dubai',
    hour: 'numeric',
    minute: '2-digit',
  });

export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00+04:00`).toLocaleDateString('en-AE', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export const whenLabel = (iso: string) => `${dayLabel(uaeDate(new Date(iso)))}, ${timeLabel(iso)}`;

export const placeLabel = (p: Viewing['property']) =>
  [p.unitNo ? `Unit ${p.unitNo}` : null, p.building, p.community ?? p.emirate]
    .filter(Boolean)
    .join(', ');
