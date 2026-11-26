import { CheckCircle2, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { GUIDES, GUIDES_REVIEWED, guideBySlug } from '@/lib/guides';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = guideBySlug((await params).slug);
  if (!g) return {};
  return {
    title: g.title,
    description: g.summary,
    alternates: { canonical: `/guides/${g.slug}` },
  };
}

export default async function GuidePage({ params }: Props) {
  const g = guideBySlug((await params).slug);
  if (!g) notFound();
  const others = GUIDES.filter((x) => x.slug !== g.slug);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Guides', href: '/guides' },
          { name: g.title, href: `/guides/${g.slug}` },
        ]}
      />
      <p className="mt-2 text-sm font-medium text-primary">
        {g.audience} · {g.minutes} min read
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{g.title}</h1>
      <p className="mt-2 text-lg text-muted-foreground">{g.summary}</p>

      <div className="mt-8 space-y-8">
        {g.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-xl font-semibold">{s.heading}</h2>
            <ul className="mt-3 space-y-2">
              {s.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-10 flex gap-2 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        General information only, not legal or financial advice. Fees and rules change; confirm with
        Dubai Land Department, your bank or a lawyer before you commit. Last reviewed{' '}
        {GUIDES_REVIEWED}.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/for-sale"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Browse homes for sale
        </Link>
        <Link href="/for-rent" className="rounded-lg border border-border px-4 py-2 text-sm">
          Browse rentals
        </Link>
      </div>

      <h2 className="mt-12 text-lg font-semibold">More guides</h2>
      <ul className="mt-3 space-y-2">
        {others.map((o) => (
          <li key={o.slug}>
            <Link href={`/guides/${o.slug}`} className="text-primary hover:underline">
              {o.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
