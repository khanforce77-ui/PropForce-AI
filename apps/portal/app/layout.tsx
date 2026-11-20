import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/chrome';
import { SITE_NAME, siteUrl } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME}: properties for sale and rent in the UAE`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Search verified apartments, villas and townhouses for sale and rent in Dubai and Abu Dhabi, and contact the agent directly on WhatsApp or phone.',
  openGraph: { siteName: SITE_NAME, type: 'website', locale: 'en_AE' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
