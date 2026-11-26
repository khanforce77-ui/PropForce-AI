'use client';

import { useParams } from 'next/navigation';
import { AgencyDocuments } from '@/components/kyc/agency-documents';
import { Alert } from '@/components/ui/card';
import { useAgencyMembership } from '@/lib/agency-context';

/** The agency's registration documents: upload, renew expired ones, and see PropForce's review. */
export default function CompanyDocumentsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const membership = useAgencyMembership();
  const allowed =
    !!membership && (membership.platform || ['owner', 'admin'].includes(membership.role));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trade licence, MOA, Ejari, ORN card, and your owners’ and team’s IDs. Only owners and
          admins of your agency, and PropForce reviewers, can open these files.
        </p>
      </div>
      {allowed ? (
        <AgencyDocuments agencyId={agencyId} />
      ) : (
        <Alert>Only the agency’s owners and admins can see company documents.</Alert>
      )}
    </div>
  );
}
