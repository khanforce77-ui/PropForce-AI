import { Bath, BedDouble, Building2, Camera, Home, MapPin, Ruler, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { SaveButton } from '@/components/save-button';
import type { ListingCard as Card } from '@/lib/api';
import { photoUrl } from '@/lib/photos';
import {
  agentPath,
  bedsLabel,
  formatArea,
  formatPrice,
  listingPath,
  listingTitle,
  TYPE_LABEL,
} from '@/lib/format';

/** Placeholder until listing photos are supported. */
export function PhotoPlaceholder({ type, className = '' }: { type: string; className?: string }) {
  const Icon = ['apartment', 'penthouse', 'office', 'commercial', 'retail'].includes(type)
    ? Building2
    : Home;
  return (
    <div className={`flex items-center justify-center bg-accent text-primary/60 ${className}`}>
      <Icon className="h-12 w-12" aria-hidden />
    </div>
  );
}

export function ListingCard({ listing }: { listing: Card }) {
  const title = listingTitle(listing);
  const location = [listing.building, listing.subCommunity, listing.community, listing.emirate]
    .filter(Boolean)
    .join(', ');
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-shadow hover:shadow-md">
      <Link href={listingPath(listing)} className="block">
        <div className="relative">
          {listing.photos?.[0] ? (
            <img
              src={photoUrl(listing.photos[0], 'thumb')}
              alt={title}
              width={480}
              height={320}
              loading="lazy"
              className="h-44 w-full bg-accent object-cover"
            />
          ) : (
            <PhotoPlaceholder type={listing.type} className="h-44" />
          )}
          <SaveButton
            id={listing.id}
            className="absolute bottom-3 left-3 rounded-full bg-background/90 p-2 hover:text-red-500"
          />
          {listing.photoCount ? (
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              <Camera className="h-3 w-3" aria-hidden /> {listing.photoCount}
            </span>
          ) : null}
          <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
            {TYPE_LABEL[listing.type] ?? 'Property'}
            {listing.completion === 'off_plan'
              ? ` · Off-plan${listing.handoverDate ? `, handover ${listing.handoverDate.slice(0, 4)}` : ''}`
              : ''}
          </span>
          {listing.permit ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              <ShieldCheck className="h-3 w-3" aria-hidden /> {listing.permit.authority} permit
            </span>
          ) : null}
        </div>
        <div className="space-y-2 p-4">
          <p className="text-lg font-bold">{formatPrice(listing.price, listing.rentPeriod)}</p>
          <h3 className="line-clamp-1 font-medium">{title}</h3>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-1">{location}</span>
          </p>
          <ul className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {bedsLabel(listing.bedrooms) ? (
              <li className="flex items-center gap-1">
                <BedDouble className="h-4 w-4" aria-hidden /> {bedsLabel(listing.bedrooms)}
              </li>
            ) : null}
            {listing.bathrooms != null ? (
              <li className="flex items-center gap-1">
                <Bath className="h-4 w-4" aria-hidden /> {listing.bathrooms} Baths
              </li>
            ) : null}
            {formatArea(listing.areaSqft) ? (
              <li className="flex items-center gap-1">
                <Ruler className="h-4 w-4" aria-hidden /> {formatArea(listing.areaSqft)}
              </li>
            ) : null}
          </ul>
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {listing.agent ? (
          <Link
            href={agentPath(listing.agent)}
            className="flex min-w-0 items-center gap-2 hover:text-primary"
          >
            <AgentAvatar agent={listing.agent} size={28} />
            <span className="line-clamp-1 font-medium text-foreground">{listing.agent.name}</span>
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={`/agency/${listing.agency.slug}`}
          className="line-clamp-1 font-medium hover:text-primary"
        >
          {listing.agency.name}
        </Link>
      </div>
    </article>
  );
}
