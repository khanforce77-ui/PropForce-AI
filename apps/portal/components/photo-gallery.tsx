'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ListingPhoto } from '@/lib/api';
import { photoUrl } from '@/lib/photos';

/** Main photo with previous/next and a thumbnail strip. */
export function PhotoGallery({ photos, title }: { photos: ListingPhoto[]; title: string }) {
  const [i, setI] = useState(0);
  const current = photos[i]!;
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-2xl bg-accent">
        <img
          src={photoUrl(current, 'display')}
          alt={`${title}, photo ${i + 1} of ${photos.length}`}
          width={current.width}
          height={current.height}
          className="h-64 w-full object-cover sm:h-96"
        />
        {photos.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-2 shadow hover:bg-background"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-2 shadow hover:bg-background"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              {i + 1} / {photos.length}
            </span>
          </>
        ) : null}
      </div>
      {photos.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, n) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show photo ${n + 1}`}
              aria-current={n === i}
              className={`shrink-0 overflow-hidden rounded-lg border-2 ${n === i ? 'border-primary' : 'border-transparent opacity-80 hover:opacity-100'}`}
            >
              <img
                src={photoUrl(p, 'thumb')}
                alt=""
                width={96}
                height={64}
                loading="lazy"
                className="h-16 w-24 object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
