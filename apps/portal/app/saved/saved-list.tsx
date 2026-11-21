'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ListingCard as Card } from '@/lib/api';
import { useSaved } from '@/lib/saved';
import { ListingCard } from '@/components/listing-card';

export function SavedList() {
  const { ids } = useSaved();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState(false);
  const key = ids.join(',');

  useEffect(() => {
    if (!key) {
      setCards([]);
      return;
    }
    let live = true;
    fetch(`/api/saved?ids=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((b: { data: Card[] }) => live && setCards(b.data))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [key]);

  if (error) {
    return (
      <p className="text-muted-foreground">
        Could not load your saved properties. Please try again.
      </p>
    );
  }
  if (cards === null) return <p className="text-muted-foreground">Loading…</p>;
  const shown = cards.filter((c) => ids.includes(c.id));
  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Nothing saved yet. Tap the heart on any property to keep it here.{' '}
        <Link href="/for-sale" className="text-primary">
          Browse properties
        </Link>
      </p>
    );
  }
  return (
    <>
      {ids.length > shown.length ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {ids.length - shown.length} saved{' '}
          {ids.length - shown.length === 1 ? 'property is' : 'properties are'} no longer listed.
        </p>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <ListingCard key={c.id} listing={c} />
        ))}
      </div>
    </>
  );
}
