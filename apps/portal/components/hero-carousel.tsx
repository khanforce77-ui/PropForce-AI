'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SiteBanner } from '@/lib/api';
import { cn } from '@/lib/utils';
import { bannerHref, bannerImage, SponsoredTag } from './banners';

/**
 * Home page hero. With banners from PropForce admin, their images fade behind the heading every
 * few seconds and the current one's caption links through; without, the plain gradient stays.
 */
export function HeroCarousel({
  banners,
  children,
}: {
  banners: SiteBanner[];
  children: ReactNode;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (banners.length < 2) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [banners.length]);

  const current = banners[i];
  const hasImages = banners.length > 0;

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden',
        hasImages ? 'bg-slate-900 text-white' : 'bg-gradient-to-b from-accent to-background',
      )}
    >
      {banners.map((b, n) => (
        <img
          key={b.id}
          src={bannerImage(b)}
          alt=""
          aria-hidden
          fetchPriority={n === 0 ? 'high' : 'low'}
          className={cn(
            'absolute inset-0 -z-20 h-full w-full object-cover transition-opacity duration-1000',
            n === i ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
      {hasImages ? (
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />
      ) : null}
      {children}
      {current ? (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pb-5">
          <div className="flex items-center gap-2" role="group" aria-label="Banners">
            {banners.length > 1
              ? banners.map((b, n) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`Show banner ${n + 1}`}
                    aria-current={n === i}
                    onClick={() => setI(n)}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      n === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50',
                    )}
                  />
                ))
              : null}
          </div>
          {bannerHref(current) ? (
            <a
              href={bannerHref(current)}
              rel={current.kind === 'ad' ? 'sponsored nofollow' : 'nofollow'}
              className="group flex items-center gap-3 rounded-full bg-white/10 py-1.5 pr-2 pl-4 text-sm backdrop-blur hover:bg-white/20"
            >
              <SponsoredTag banner={current} />
              <span className="font-medium">{current.title}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                {current.ctaLabel || 'View'} <ArrowRight className="h-3 w-3" />
              </span>
            </a>
          ) : (
            <span className="flex items-center gap-2 text-sm text-white/90">
              <SponsoredTag banner={current} />
              {current.title}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
