'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ListingForm } from '@/components/listings/listing-form';
import { Card } from '@/components/ui/card';
import type { PropertyDetail } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function NewListingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const { request } = useAuth();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/app/${agencyId}/listings`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Listings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add listing</h1>
        <p className="text-sm text-muted-foreground">
          It starts as a draft. Publish it when the details and permit are in place.
        </p>
      </div>
      <Card>
        <ListingForm
          submitLabel="Save draft"
          onSubmit={async (body) => {
            const created = await request<PropertyDetail>('/properties', {
              tenantId: agencyId,
              body,
            });
            router.push(`/app/${agencyId}/listings/${created.id}?created=1`);
          }}
        />
      </Card>
    </div>
  );
}
