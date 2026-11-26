import { Heart, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import Link from 'next/link';
import type { SiteContent } from '@/lib/api';
import { SITE_NAME } from '@/lib/config';

const SOCIAL_LABELS: Record<keyof SiteContent['social'], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

/** Thin strip above the header, switched on in PropForce admin → Website. */
export function AnnouncementBar({ announcement }: { announcement: SiteContent['announcement'] }) {
  if (!announcement.enabled || !announcement.text) return null;
  const external = announcement.linkUrl?.startsWith('https://');
  return (
    <div className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
      <span>{announcement.text}</span>
      {announcement.linkUrl ? (
        <>
          {' '}
          <a
            href={announcement.linkUrl}
            className="font-semibold underline underline-offset-2"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {announcement.linkLabel || 'Learn more'} →
          </a>
        </>
      ) : null}
    </div>
  );
}

export function SiteHeader({ siteName = SITE_NAME }: { siteName?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-primary"
        >
          <img
            src="/brand/propforce-logo.svg"
            alt=""
            width={32}
            height={32}
            className="rounded-md"
          />
          {siteName}
        </Link>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/for-sale" className="hover:text-primary">
            Buy
          </Link>
          <Link href="/for-rent" className="hover:text-primary">
            Rent
          </Link>
          <Link href="/new-projects" className="hidden hover:text-primary sm:inline">
            New projects
          </Link>
          <Link href="/guides" className="hidden hover:text-primary md:inline">
            Guides
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/for-agencies"
            className="hidden text-xs text-muted-foreground hover:text-primary md:inline"
          >
            For agencies
          </Link>
          <Link
            href="/saved"
            className="inline-flex items-center gap-1 text-sm font-medium hover:text-primary"
          >
            <Heart className="h-4 w-4" aria-hidden /> Saved
          </Link>
        </div>
      </div>
    </header>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({
  content,
  siteName = SITE_NAME,
}: {
  content: SiteContent;
  siteName?: string;
}) {
  const { contact, social } = content;
  const socials = (Object.keys(SOCIAL_LABELS) as (keyof SiteContent['social'])[]).filter(
    (k) => social[k],
  );
  const wa = contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}` : null;
  return (
    <footer className="mt-16 border-t border-border bg-muted">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted-foreground lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="font-semibold text-foreground">{siteName}</p>
          <p className="mt-1">{content.about}</p>
          {contact.email || contact.phone || wa || contact.address ? (
            <ul className="mt-3 space-y-1">
              {contact.phone ? (
                <li>
                  <a
                    href={`tel:${contact.phone}`}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    <Phone className="h-4 w-4" aria-hidden /> {contact.phone}
                  </a>
                </li>
              ) : null}
              {wa ? (
                <li>
                  <a
                    href={wa}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp {contact.whatsapp}
                  </a>
                </li>
              ) : null}
              {contact.email ? (
                <li>
                  <a
                    href={`mailto:${contact.email}`}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    <Mail className="h-4 w-4" aria-hidden /> {contact.email}
                  </a>
                </li>
              ) : null}
              {contact.address ? (
                <li className="inline-flex items-center gap-2">
                  <MapPin className="h-4 w-4" aria-hidden /> {contact.address}
                </li>
              ) : null}
            </ul>
          ) : null}
          {socials.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {socials.map((k) => (
                <a
                  key={k}
                  href={social[k]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                >
                  {SOCIAL_LABELS[k]}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 sm:justify-items-end">
          <FooterColumn
            title="Find a home"
            links={[
              ['Buy', '/for-sale'],
              ['Rent', '/for-rent'],
              ['New projects', '/new-projects'],
              ['Saved homes', '/saved'],
            ]}
          />
          <FooterColumn
            title="Guides"
            links={[
              ['Buying in Dubai', '/guides/buying-a-home-in-dubai'],
              ['Renting in Dubai', '/guides/renting-in-dubai'],
              ['Buying off-plan', '/guides/buying-off-plan'],
              ['Spot a genuine listing', '/guides/spot-a-genuine-listing'],
            ]}
          />
          <FooterColumn
            title="PropForce"
            links={[
              ['For agencies', '/for-agencies'],
              ['For developers', '/developers'],
              ['Privacy', '/privacy'],
              ['Terms', '/terms'],
            ]}
          />
        </div>
      </div>
    </footer>
  );
}
