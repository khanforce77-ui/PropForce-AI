import Link from 'next/link';
import { siteUrl } from '@/lib/config';

export interface Crumb {
  name: string;
  href: string;
}

/** Visible breadcrumbs plus schema.org BreadcrumbList for search engines. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${siteUrl()}${c.href}`,
    })),
  };
  return (
    <nav className="mb-4 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {c.name}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-primary">
                {c.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
