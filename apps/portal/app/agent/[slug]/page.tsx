import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Results } from '@/components/results';
import { getAgent, searchListings } from '@/lib/api';
import { agentPath, idFromSlug, searchParamsToQuery } from '@/lib/format';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(slug: string) {
  const id = idFromSlug(slug);
  if (!id) notFound();
  const agent = await getAgent(id);
  if (!agent) notFound();
  return agent;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  const agent = id ? await getAgent(id).catch(() => null) : null;
  if (!agent) return { title: 'Agent not found', robots: { index: false } };
  return {
    title: `${agent.name}, real estate agent at ${agent.agency.name}`,
    description: `${agent.name}${agent.brn ? ` (BRN ${agent.brn})` : ''} at ${agent.agency.name}: ${agent.listings.total} properties for sale and rent${agent.communities.length ? ` in ${agent.communities.slice(0, 3).join(', ')}` : ''}.`,
    alternates: { canonical: agentPath(agent) },
  };
}

export default async function AgentPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const agent = await load(slug);
  const canonical = agentPath(agent);
  if (`/agent/${slug}` !== canonical) permanentRedirect(canonical);

  const query = searchParamsToQuery(undefined, { ...(await searchParams), agent: agent.id });
  const result = await searchListings(query).catch(() => null);
  const links = new URLSearchParams(query);
  links.delete('agent');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: agent.name,
    worksFor: { '@type': 'RealEstateAgent', name: agent.agency.name },
    ...(agent.brn ? { identifier: `BRN ${agent.brn}` } : {}),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <Breadcrumbs
        items={[
          { name: agent.agency.name, href: `/agency/${agent.agency.slug}` },
          { name: agent.name, href: canonical },
        ]}
      />
      <div className="flex flex-col gap-5 rounded-2xl border border-border p-6 sm:flex-row sm:items-center">
        <AgentAvatar agent={agent} size={96} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real estate agent at{' '}
            <Link href={`/agency/${agent.agency.slug}`} className="font-medium text-primary">
              {agent.agency.name}
            </Link>
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {agent.brn ? (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">BRN</dt>
                <dd className="font-medium">{agent.brn}</dd>
              </div>
            ) : null}
            {agent.agency.orn ? (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Agency ORN</dt>
                <dd className="font-medium">{agent.agency.orn}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt className="text-muted-foreground">For sale</dt>
              <dd className="font-medium">{agent.listings.sale}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">For rent</dt>
              <dd className="font-medium">{agent.listings.rent}</dd>
            </div>
          </dl>
          {agent.communities.length > 0 ? (
            <p className="mt-3 flex flex-wrap gap-2 text-sm">
              <span className="text-muted-foreground">Areas:</span>
              {agent.communities.map((c) => (
                <Link
                  key={c}
                  href={`/for-sale?community=${encodeURIComponent(c)}`}
                  className="rounded-full border border-border px-3 py-0.5 hover:border-primary hover:text-primary"
                >
                  {c}
                </Link>
              ))}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            To contact {agent.name.split(' ')[0]}, open any listing below and use Call, WhatsApp or
            Email. Their number stays private until you choose to call.
          </p>
        </div>
      </div>
      <h2 className="mb-4 mt-8 text-xl font-semibold">
        Properties listed by {agent.name}
        {result ? (
          <span className="ml-2 text-sm font-normal text-muted-foreground">({result.total})</span>
        ) : null}
      </h2>
      <Results result={result} basePath={canonical} params={links} />
    </div>
  );
}
