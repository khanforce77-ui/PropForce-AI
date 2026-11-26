import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GUIDES, GUIDES_REVIEWED } from '@/lib/guides';

export const metadata: Metadata = {
  title: 'Guides to buying and renting in Dubai',
  description:
    'Plain-English guides to buying, renting and buying off-plan in Dubai, and how to spot a genuine listing.',
  alternates: { canonical: '/guides' },
};

export default function GuidesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Guides</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Plain-English help with buying and renting a home in Dubai. General information only, last
        reviewed {GUIDES_REVIEWED}.
      </p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <Link
            key={g.slug}
            href={`/guides/${g.slug}`}
            className="group rounded-2xl border border-border bg-background p-6 transition hover:border-primary hover:shadow-md"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">
              <BookOpen className="h-3 w-3" aria-hidden /> {g.audience} · {g.minutes} min read
            </span>
            <h2 className="mt-3 text-lg font-semibold group-hover:text-primary">{g.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{g.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
