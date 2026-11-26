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
import { AgentAvatar } from '@/components/agent-avatar';
import { VerifiedAgentBadge } from '@/components/verified-agent-badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ListingCard } from '@/components/listing-card';
import { LocationMap } from '@/components/location-map';
import { PermitQr } from '@/components/permit-qr';
import { ReportListing } from '@/components/report-listing';
import { areaCrumbs } from '@/components/search-page';
import { SaveButton } from '@/components/save-button';
import { ShareButtons } from '@/components/share-buttons';
import { notFound, permanentRedirect } from 'next/navigation';
import { BannerCard } from '@/components/banners';
import { ContactActions } from '@/components/contact-actions';
import { EnquiryForm } from '@/components/enquiry-form';
import { PhotoPlaceholder } from '@/components/listing-card';
import { PhotoGallery } from '@/components/photo-gallery';
import { photoUrl } from '@/lib/photos';
import { getListing, getSimilar, getSite, type ListingDetail } from '@/lib/api';
import { siteUrl, SITE_NAME } from '@/lib/config';
import {
  agentPath,
  bedsLabel,
  formatArea,
  formatPrice,
  FURNISHING_LABEL,
  idFromSlug,
  listingPath,
  listingTitle,
  TYPE_LABEL,
} from '@/lib/format';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });

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
    openGraph: {
      title,
      description,
      url: listingPath(l),
      type: 'website',
      ...(l.photos?.[0] ? { images: [photoUrl(l.photos[0], 'display')] } : {}),
    },
  };
}

export default async function PropertyPage({ params }: Props) {
  const { slug } = await params;
  const l = await load(slug);
  const canonical = listingPath(l);
  if (`/property/${slug}` !== canonical) permanentRedirect(canonical);

  const title = listingTitle(l);
  const [similar, site] = await Promise.all([getSimilar(l.id), getSite()]);
  const sidebarAd = site.banners.listing_sidebar[0];
  const facts: [string, string | null][] = [
    ['Type', TYPE_LABEL[l.type] ?? 'Property'],
    ['Purpose', l.purpose === 'rent' ? 'For rent' : 'For sale'],
    ['Completion', l.completion === 'off_plan' ? 'Off-plan' : 'Ready'],
    ['Furnishing', l.furnishing ? (FURNISHING_LABEL[l.furnishing] ?? null) : null],
    ['Parking', l.parking != null ? String(l.parking) : null],
    ['View', l.view],
    ['Developer', l.developer],
    ['Project', l.project ?? null],
    ['Handover', l.handoverDate ?? null],
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
      <Breadcrumbs
        items={[
          ...areaCrumbs(l.purpose, {
            emirate: l.emirate,
            ...(l.community ? { community: l.community } : {}),
          }),
          { name: title, href: canonical },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {l.photos?.length ? (
            <PhotoGallery photos={l.photos} title={title} />
          ) : (
            <PhotoPlaceholder type={l.type} className="h-64 rounded-2xl sm:h-96" />
          )}
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
            </ul>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {l.permit ? (
                <li className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {l.permit.authority} permit
                  {l.permit.validUntil ? ` valid until ${shortDate(l.permit.validUntil)}` : ''}
                </li>
              ) : null}
              {l.verifiedAt ? (
                <li
                  className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-medium"
                  title="The agent confirmed this property is still available on this date. Listings that are not re-confirmed leave the site."
                >
                  <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> Availability
                  confirmed by agent {shortDate(l.verifiedAt)}
                </li>
              ) : null}
            </ul>
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                <SaveButton
                  id={l.id}
                  label
                  className="h-9 rounded-lg border border-border px-3 text-sm hover:border-primary hover:text-primary"
                />
                <ShareButtons url={`${siteUrl()}${canonical}`} title={title} />
              </div>
            </div>
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

          {l.location ? (
            <LocationMap
              lat={l.location.lat}
              lng={l.location.lng}
              radiusM={l.location.radiusM}
              label={location(l)}
            />
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
                  <dd className="font-semibold">
                    {l.permit.number ?? `${l.permit.authority} permit on file with the agency`}
                  </dd>
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
              {l.permit.verificationUrl ? (
                <div className="mt-4 flex items-center gap-4">
                  <PermitQr
                    url={l.permit.verificationUrl}
                    label={`Check this ${l.permit.authority} permit on the regulator's website`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Scan or tap the QR code to check this permit on the {l.permit.authority}{' '}
                    website.
                  </p>
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                Permit details are provided by the listing agency. Listings leave {SITE_NAME} when
                their permit expires.
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-border p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Listed by</p>
            <div className="mt-2 flex items-center gap-3">
              {l.agent ? <AgentAvatar agent={l.agent} size={56} /> : null}
              <div className="min-w-0">
                {l.agent ? (
                  <Link
                    href={agentPath(l.agent)}
                    className="text-lg font-semibold hover:text-primary"
                  >
                    {l.agent.name}
                  </Link>
                ) : null}
                {l.agent?.brn ? (
                  <p className="text-xs text-muted-foreground">BRN {l.agent.brn}</p>
                ) : null}
                {l.agent?.verified ? (
                  <div className="mt-1">
                    <VerifiedAgentBadge />
                  </div>
                ) : null}
              </div>
            </div>
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
            <h2 className="font-semibold">Email the agent</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Your message goes straight to the agent&apos;s inbox. Their email address and number
              stay private.
            </p>
            <EnquiryForm
              listingId={l.id}
              defaultMessage={`Hi, I'm interested in "${title}" (Ref ${l.reference}). Please contact me.`}
            />
          </div>
          <ReportListing listingId={l.id} />
          {sidebarAd ? <BannerCard banner={sidebarAd} tall /> : null}
        </aside>
      </div>

      {similar.length > 0 ? (
        <section className="mt-12" aria-labelledby="similar">
          <h2 id="similar" className="text-xl font-semibold">
            Similar properties
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {similar.map((s) => (
              <ListingCard key={s.id} listing={s} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
