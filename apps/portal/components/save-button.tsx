'use client';

import { Heart } from 'lucide-react';
import { useSaved } from '@/lib/saved';

/** Heart button: saves a listing in this browser (see /saved). */
export function SaveButton({
  id,
  className = '',
  label = false,
}: {
  id: string;
  className?: string;
  label?: boolean;
}) {
  const { ids, toggle } = useSaved();
  const saved = ids.includes(id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save this property'}
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <Heart className={`h-4 w-4 ${saved ? 'fill-red-500 text-red-500' : ''}`} aria-hidden />
      {label ? (saved ? 'Saved' : 'Save') : null}
    </button>
  );
}
