import {
  BadgeCheck,
  Bath,
  BedDouble,
  CalendarDays,
  MapPin,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ContactActions } from '@/components/contact-actions';
import { EnquiryForm } from '@/components/enquiry-form';
import { PhotoPlaceholder } from '@/components/listing-card';
import { getListing, type ListingDetail } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import {
  bedsLabel,
  formatArea,
  formatPrice,
  FURNISHING_LABEL,
  idFromSlug,
  listingPath,
  listingTitle,
  PURPOSE_PATH,
  TYPE_LABEL,
} from '@/lib/format';

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<ListingDetail> {
  const id = idFromSlug(slug);
  if (!id) notFound();
  const listing = await getListing(id);
  if (!listing) notFound();
  return listing;
}

const location = (l: ListingDetail) =>
  [l.building, l.subCommunity, l.community, l.emirate].filter(Boolean).join(', ');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  const l = id ? await getListing(id) : null;
  if (!l) return { title: 'Property not found', robots: { index: false } };
  const title = listingTitle(l);
  const description = `${formatPrice(l.price, l.rentPeriod)} · ${[bedsLabel(l.bedrooms), formatArea(l.areaSqft)].filter(Boolean).join(' · ')} · ${location(l)}. Listed by ${l.agency.name}.`;
  return {
    title,
    description,
    alternates: { canonical: listingPath(l) },
    openGraph: { title, description, url: listingPath(l), type: 'website' },
  };
}

export default async function PropertyPage({ params }: Props) {
  const { slug } = await params;
  const l = await load(slug);
  const canonical = listingPath(l);
  if (`/property/${slug}` !== canonical) permanentRedirect(canonical);

  const title = listingTitle(l);
  const facts: [string, string | null][] = [
    ['Type', TYPE_LABEL[l.type] ?? 'Property'],
    ['Purpose', l.purpose === 'rent' ? 'For rent' : 'For sale'],
    ['Completion', l.completion === 'off_plan' ? 'Off-plan' : 'Ready'],
    ['Furnishing', l.furnishing ? (FURNISHING_LABEL[l.furnishing] ?? null) : null],
    ['Parking', l.parking != null ? String(l.parking) : null],
    ['View', l.view],
    ['Developer', l.developer],
    ['Project', l.project],
    ['Handover', l.handoverDate],
    [
      'Service charge',
      l.serviceChargePerSqft != null ? `AED ${l.serviceChargePerSqft} / sqft` : null,
    ],
    ['Reference', l.reference],
  ];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: title,
    url: `${siteUrl()}${canonical}`,
    datePosted: l.listedAt,
    description: l.description ?? undefined,
    offers: l.price
      ? {
          '@type': 'Offer',
          price: l.price,
          priceCurrency: 'AED',
          availability: 'https://schema.org/InStock',
        }
      : undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: l.community ?? undefined,
      addressRegion: l.emirate,
      addressCountry: 'AE',
    },
    provider: { '@type': 'RealEstateAgent', name: l.agency.name },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href={`/${PURPOSE_PATH[l.purpose]}`} className="hover:text-primary">
          {l.purpose === 'rent' ? 'Rent' : 'Buy'}
        </Link>
        {' / '}
        <Link
          href={`/${PURPOSE_PATH[l.purpose]}?emirate=${encodeURIComponent(l.emirate)}`}
          className="hover:text-primary"
        >
          {l.emirate}
        </Link>
        {l.community ? (
          <>
            {' / '}
            <Link
              href={`/${PURPOSE_PATH[l.purpose]}?community=${encodeURIComponent(l.community)}`}
              className="hover:text-primary"
            >
              {l.community}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <PhotoPlaceholder type={l.type} className="h-64 rounded-2xl sm:h-96" />
          <div>
            <p className="text-3xl font-bold">{formatPrice(l.price, l.rentPeriod)}</p>
            <h1 className="mt-1 text-xl font-semibold">{title}</h1>
            <p className="mt-1 flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden /> {location(l)}
            </p>
            <ul className="mt-4 flex flex-wrap gap-5 text-sm">
              {bedsLabel(l.bedrooms) ? (
                <li className="flex items-center gap-1.5">
                  <BedDouble className="h-4 w-4" aria-hidden /> {bedsLabel(l.bedrooms)}
                </li>
              ) : null}
              {l.bathrooms != null ? (
                <li className="flex items-center gap-1.5">
                  <Bath className="h-4 w-4" aria-hidden /> {l.bathrooms} Baths
                </li>
              ) : null}
              {formatArea(l.areaSqft) ? (
                <li className="flex items-center gap-1.5">
                  <Ruler className="h-4 w-4" aria-hidden /> {formatArea(l.areaSqft)}
                </li>
              ) : null}
              {l.verifiedAt ? (
                <li className="flex items-center gap-1.5 text-primary">
                  <BadgeCheck className="h-4 w-4" aria-hidden /> Checked by agent{' '}
                  {new Date(l.verifiedAt).toLocaleDateString('en-AE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </li>
              ) : null}
            </ul>
          </div>

          {l.description ? (
            <section>
              <h2 className="text-lg font-semibold">Description</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6">{l.description}</p>
            </section>
          ) : null}

          <section>
            <h2 className="text-lg font-semibold">Property details</h2>
            <dl className="mt-2 grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-border py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {l.amenities.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Amenities</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {l.amenities.map((a) => (
                  <li key={a} className="rounded-full bg-muted px-3 py-1 text-sm">
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {l.paymentPlan && l.paymentPlan.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Payment plan</h2>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-sm">
                {l.paymentPlan.map((m, i) => (
                  <li key={i} className="flex justify-between px-4 py-2">
                    <span>{m.milestone}</span>
                    <span className="font-medium">{m.percent}%</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {l.permit ? (
            <section className="rounded-xl border border-border p-4" aria-labelledby="permit">
              <h2 id="permit" className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Regulatory information
              </h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">
                    Advertising permit ({l.permit.authority})
                  </dt>
                  <dd className="font-semibold">{l.permit.number}</dd>
                </div>
                {l.permit.validUntil ? (
                  <div>
                    <dt className="text-muted-foreground">Permit valid until</dt>
                    <dd className="flex items-center gap-1 font-medium">
                      <CalendarDays className="h-4 w-4" aria-hidden /> {l.permit.validUntil}
                    </dd>
                  </div>
                ) : null}
                {l.agency.orn ? (
                  <div>
                    <dt className="text-muted-foreground">Agency ORN</dt>
                    <dd className="font-medium">{l.agency.orn}</dd>
                  </div>
                ) : null}
                {l.agent?.brn ? (
                  <div>
                    <dt className="text-muted-foreground">Agent BRN</dt>
                    <dd className="font-medium">{l.agent.brn}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Permit details are provided by the listing agency.
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-border p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Listed by</p>
            <p className="mt-1 text-lg font-semibold">{l.agent?.name}</p>
            {l.agent?.brn ? (
              <p className="text-xs text-muted-foreground">BRN {l.agent.brn}</p>
            ) : null}
            <Link
              href={`/agency/${l.agency.slug}`}
              className="mt-1 block text-sm font-medium text-primary"
            >
              {l.agency.name}
            </Link>
            <div className="mt-4">
              <ContactActions
                listingId={l.id}
                canCall={Boolean(l.agent?.canCall)}
                canWhatsapp={Boolean(l.agent?.canWhatsapp)}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-border p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">Send an enquiry</h2>
            <EnquiryForm
              listingId={l.id}
              defaultMessage={`Hi, I'm interested in "${title}" (Ref ${l.reference}). Please contact me.`}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
