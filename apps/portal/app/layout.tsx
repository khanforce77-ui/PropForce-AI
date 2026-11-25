import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AnnouncementBar, SiteFooter, SiteHeader } from '@/components/chrome';
import { getSite } from '@/lib/api';
import { SITE_NAME, siteUrl } from '@/lib/config';
import './globals.css';

/** Title and description can be changed in PropForce admin → Website → SEO. */
export async function generateMetadata(): Promise<Metadata> {
  const { content } = await getSite();
  const name = content.siteName || SITE_NAME;
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: content.seo.title || `${name}: properties for sale and rent in Dubai`,
      template: `%s | ${name}`,
    },
    description:
      content.seo.description ||
      'Search verified apartments, villas and townhouses for sale and rent in Dubai, and contact the agent directly on WhatsApp or phone.',
    openGraph: { siteName: name, type: 'website', locale: 'en_AE' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { content } = await getSite();
  const name = content.siteName || SITE_NAME;
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <AnnouncementBar announcement={content.announcement} />
        <SiteHeader siteName={name} />
        <main className="flex-1">{children}</main>
        <SiteFooter content={content} siteName={name} />
      </body>
    </html>
  );
}
