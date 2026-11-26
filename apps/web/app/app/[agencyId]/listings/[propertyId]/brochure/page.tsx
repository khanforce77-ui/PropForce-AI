'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Brochure } from '@/lib/marketing';

const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
const words = (s: string | null) => (s ? s.replace(/_/g, ' ') : null);
const date = (s: string) =>
  new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** A branded one-page brochure. Printing it (or saving as PDF from the print dialog) drops the app chrome. */
export default function BrochurePage() {
  const { agencyId, propertyId } = useParams<{ agencyId: string; propertyId: string }>();
  const { request } = useAuth();
  const [b, setB] = useState<Brochure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<Brochure>(`/marketing/brochure/${propertyId}`, { tenantId: agencyId })
      .then(setB)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the brochure.'),
      );
  }, [agencyId, propertyId, request]);

  if (error) return <Alert>{error}</Alert>;
  if (!b) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const l = b.listing;
  const accent = b.agency.primaryColor ?? '#0f766e';
  const place = [l.building, l.subCommunity, l.community, l.emirate].filter(Boolean).join(', ');
  const price =
    l.price == null
      ? 'Price on request'
      : `${aed(l.price)}${l.listingType === 'rent' ? ` / ${words(l.rentPeriod) ?? 'year'}` : ''}`;
  const facts: [string, string | null][] = [
    ['Type', words(l.propertyType)],
    ['Bedrooms', l.bedrooms == null ? null : l.bedrooms === 0 ? 'Studio' : String(l.bedrooms)],
    ['Bathrooms', l.bathrooms == null ? null : String(l.bathrooms)],
    ['Size', l.areaSqft == null ? null : `${l.areaSqft.toLocaleString('en-AE')} sq ft`],
    ['Completion', l.completion === 'off_plan' ? 'Off-plan' : 'Ready'],
    ['Handover', l.handoverDate ? date(l.handoverDate) : null],
    ['Furnishing', words(l.furnishing)],
    ['Parking', l.parking == null ? null : String(l.parking)],
    ['View', l.view],
    ['Developer', l.developer],
  ];
  const [cover, ...rest] = b.photos;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/app/${agencyId}/listings/${propertyId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to listing
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" aria-hidden /> Print or save as PDF
        </Button>
      </div>
      {l.status !== 'active' ? (
        <Alert tone="info" className="print:hidden">
          This listing is not live. Only share a brochure for a listing you can advertise.
        </Alert>
      ) : null}
      {b.permits.length === 0 ? (
        <Alert className="print:hidden">
          No valid advertising permit on file. In Dubai, ads for a property need a valid Trakheesi
          permit number.
        </Alert>
      ) : null}

      <article className="mx-auto w-full max-w-[210mm] bg-white text-neutral-900 shadow print:max-w-none print:shadow-none">
        <header
          className="flex items-center justify-between gap-4 px-8 py-5"
          style={{ borderBottom: `4px solid ${accent}` }}
        >
          {b.agency.logo ? (
            <img src={b.agency.logo} alt={b.agency.name} className="h-12 w-auto object-contain" />
          ) : (
            <span className="text-xl font-semibold">{b.agency.name}</span>
          )}
          <span className="text-right text-xs text-neutral-500">Ref. {l.reference}</span>
        </header>

        {cover ? (
          <img src={cover.url} alt="" className="aspect-[16/9] w-full object-cover" />
        ) : null}

        <section className="flex flex-col gap-1 px-8 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: accent }}>
            {l.listingType === 'rent' ? 'For rent' : 'For sale'}
          </p>
          <h1 className="text-2xl font-semibold">{l.title ?? place}</h1>
          <p className="text-sm text-neutral-600">{place}</p>
          <p className="mt-2 text-2xl font-semibold" style={{ color: accent }}>
            {price}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-x-8 gap-y-2 px-8 py-5 text-sm sm:grid-cols-3">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-neutral-500">{k}</p>
                <p className="font-medium capitalize">{v}</p>
              </div>
            ))}
        </section>

        {rest.length > 0 ? (
          <section className="grid grid-cols-2 gap-2 px-8 sm:grid-cols-4">
            {rest.map((p) => (
              <img
                key={p.id}
                src={p.url}
                alt=""
                className="aspect-[4/3] w-full rounded object-cover"
              />
            ))}
          </section>
        ) : null}

        {l.description ? (
          <section className="px-8 pt-5 text-sm leading-relaxed whitespace-pre-line text-neutral-700">
            {l.description}
          </section>
        ) : null}

        {l.amenities.length > 0 ? (
          <section className="px-8 pt-4 text-sm">
            <p className="text-xs text-neutral-500">Amenities</p>
            <p>{l.amenities.join(' · ')}</p>
          </section>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-neutral-200 px-8 py-5 text-xs text-neutral-600">
          <div>
            {b.agent ? (
              <>
                <p className="text-sm font-semibold text-neutral-900">{b.agent.name}</p>
                {b.agent.phone ? <p>{b.agent.phone}</p> : null}
                {b.agent.brn ? <p>BRN {b.agent.brn}</p> : null}
              </>
            ) : null}
            <p className="mt-1">
              {b.agency.name}
              {b.agency.orn ? ` · ORN ${b.agency.orn}` : ''}
              {b.agency.tradeLicenseNo ? ` · Licence ${b.agency.tradeLicenseNo}` : ''}
            </p>
          </div>
          <div className="text-right">
            {b.permits.map((p) => (
              <p key={`${p.authority}:${p.permitNumber}`}>
                {p.authority} permit {p.permitNumber ?? 'on file'} · valid to {date(p.validUntil)}
              </p>
            ))}
            <p className="mt-1 text-[10px] text-neutral-400">
              Details as provided by the agency and subject to change.
            </p>
          </div>
        </footer>
      </article>
    </div>
  );
}
