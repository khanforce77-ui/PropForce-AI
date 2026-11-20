'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/listings/status-badge';
import { Alert, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ApiError, type PropertyList, type PropertySummary } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { bedroomsLabel, formatPrice, titleCase } from '@/lib/listings';

export default function ListingsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [rows, setRows] = useState<PropertySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [listingType, setListingType] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);

  const load = useCallback(
    async (after?: string) => {
      setError(null);
      try {
        const res = await request<PropertyList>('/properties', {
          tenantId: agencyId,
          query: {
            q: q.trim() || undefined,
            listingType: listingType || undefined,
            status: status || undefined,
            mine: mine ? 'true' : undefined,
            cursor: after,
          },
        });
        setRows((prev) => (after ? [...prev, ...res.data] : res.data));
        setTotal(res.total);
        setCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load listings.');
      } finally {
        setLoaded(true);
      }
    },
    [agencyId, request, q, listingType, status, mine],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
          <p className="text-sm text-muted-foreground">
            {loaded ? `${total} listing${total === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <Link
          href={`/app/${agencyId}/listings/new`}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add listing
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem_auto] sm:items-center">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search listings"
            placeholder="Search reference, community, building"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="Sale or rent"
          value={listingType}
          onChange={(e) => setListingType(e.target.value)}
        >
          <option value="">Sale & rent</option>
          <option value="sale">Sale</option>
          <option value="rent">Rent</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All but archived</option>
          <option value="draft">Draft</option>
          <option value="active">Live</option>
          <option value="under_offer">Under offer</option>
          <option value="sold">Sold</option>
          <option value="rented">Rented</option>
          <option value="archived">Archived</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
          only
        </label>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {loaded && rows.length === 0 && !error ? (
        <Card className="text-center">
          <p className="font-medium">No listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first property to start building your inventory.
          </p>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Listing</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Beds</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/${agencyId}/listings/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title ||
                        [p.building, p.community].filter(Boolean).join(', ') ||
                        p.reference}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {p.reference} · {[p.community, p.emirate].filter(Boolean).join(', ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {titleCase(p.propertyType)} · {p.listingType === 'sale' ? 'Sale' : 'Rent'}
                  </td>
                  <td className="px-4 py-3">{bedroomsLabel(p.bedrooms)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatPrice(p)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.assigned?.user.fullName ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {cursor ? (
        <button
          type="button"
          className="self-center text-sm font-medium underline"
          onClick={() => void load(cursor)}
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
