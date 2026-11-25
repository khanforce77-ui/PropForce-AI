'use client';

import { Info, PartyPopper, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppNotice } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const TONES = {
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
};
const ICONS = { info: Info, warning: TriangleAlert, success: PartyPopper };

/** The notice PropForce shows to every agency (set in platform admin → Settings). */
export function AppNoticeBar() {
  const { request } = useAuth();
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    void request<{ notice: AppNotice | null }>('/notice')
      .then((r) => setNotice(r.notice))
      .catch(() => setNotice(null));
  }, [request]);
  if (!notice || hidden) return null;
  const Icon = ICONS[notice.tone];
  return (
    <div
      role="status"
      className={cn(
        'mb-6 flex items-start gap-3 rounded-lg border px-4 py-2.5 text-sm',
        TONES[notice.tone],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{notice.text}</p>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide notice">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
