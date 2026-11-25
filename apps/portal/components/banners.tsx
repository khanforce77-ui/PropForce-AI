import { ArrowRight } from 'lucide-react';
import type { SiteBanner } from '@/lib/api';
import { cn } from '@/lib/utils';

export const bannerImage = (b: SiteBanner) =>
  `/media/banners/${b.id}?v=${encodeURIComponent(b.image.version)}`;
export const bannerHref = (b: SiteBanner) => (b.hasLink ? `/go/banner/${b.id}` : undefined);

/** "Sponsored · Advertiser" label that every paid advert carries. */
export function SponsoredTag({ banner, className }: { banner: SiteBanner; className?: string }) {
  if (banner.kind !== 'ad') return null;
  return (
    <span
      className={cn(
        'rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white uppercase',
        className,
      )}
    >
      Sponsored{banner.advertiser ? ` · ${banner.advertiser}` : ''}
    </span>
  );
}

function Wrap({
  banner,
  className,
  children,
}: {
  banner: SiteBanner;
  className?: string;
  children: React.ReactNode;
}) {
  const href = bannerHref(banner);
  return href ? (
    <a
      href={href}
      rel={banner.kind === 'ad' ? 'sponsored nofollow' : 'nofollow'}
      className={cn('group block', className)}
    >
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** A promo card: image with the title and button over a dark fade. */
export function BannerCard({
  banner,
  className,
  tall,
}: {
  banner: SiteBanner;
  className?: string;
  tall?: boolean;
}) {
  return (
    <Wrap
      banner={banner}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-muted shadow-sm',
        className,
      )}
    >
      <img
        src={bannerImage(banner)}
        alt=""
        width={banner.image.width}
        height={banner.image.height}
        loading="lazy"
        className={cn(
          'w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]',
          tall ? 'aspect-square' : 'aspect-[2/1]',
        )}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <SponsoredTag banner={banner} className="absolute top-3 left-3" />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <p className="text-lg leading-snug font-semibold">{banner.title}</p>
        {banner.subtitle ? <p className="mt-0.5 text-sm text-white/85">{banner.subtitle}</p> : null}
        {banner.hasLink ? (
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium">
            {banner.ctaLabel || 'Learn more'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : null}
      </div>
    </Wrap>
  );
}

/** A wide strip (top of search results). */
export function BannerStrip({ banner }: { banner: SiteBanner }) {
  return (
    <Wrap
      banner={banner}
      className="relative overflow-hidden rounded-2xl border border-border bg-muted shadow-sm"
    >
      <img
        src={bannerImage(banner)}
        alt=""
        width={banner.image.width}
        height={banner.image.height}
        className="aspect-[5/1] min-h-28 w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
      <SponsoredTag banner={banner} className="absolute top-3 right-3" />
      <div className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-center p-5 text-white">
        <p className="text-lg font-semibold sm:text-xl">{banner.title}</p>
        {banner.subtitle ? (
          <p className="hidden text-sm text-white/85 sm:block">{banner.subtitle}</p>
        ) : null}
        {banner.hasLink ? (
          <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-medium text-black">
            {banner.ctaLabel || 'Learn more'} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
    </Wrap>
  );
}
