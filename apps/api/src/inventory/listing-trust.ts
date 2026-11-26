import type { ListingType, TransactionClient } from '@propforce/db';
import { AppError } from '../common/app-error';

/** Photos a listing should have before PropForce approves it (Bayut-style quality bar). */
export const MIN_PHOTOS = 5;
/** Characters of description a listing should have. */
export const MIN_DESCRIPTION_CHARS = 100;
/** An agency with this many approved listings no longer waits for review. */
export const TRUSTED_AGENCY_APPROVED_LISTINGS = 10;

export const LISTING_REVIEW_FLAG = 'platform.require_listing_review';

export interface ListingCheck {
  key:
    | 'permit'
    | 'permit_purpose'
    | 'permit_qr'
    | 'photos'
    | 'description'
    | 'basics'
    | 'agent_verified';
  label: string;
  ok: boolean;
  /** Required checks block publishing; the others are what PropForce's reviewers look for. */
  required: boolean;
}

export interface ChecksInput {
  listingType: ListingType;
  price: unknown;
  areaSqft: unknown;
  community: string | null;
  description: string | null;
  photoCount: number;
  permits: {
    purpose: ListingType | null;
    permitNumber: string | null;
    validUntil: Date;
    verificationUrl: string | null;
    hasDocument: boolean;
  }[];
  agentVerifiedUntil: Date | null;
}

function today() {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Which permits are unexpired and on file (a number or the document). */
export function validPermits(permits: ChecksInput['permits']) {
  const t = today();
  return permits.filter((p) => p.validUntil >= t && (p.permitNumber || p.hasDocument));
}

/** The checklist shown to the agency on the listing and to PropForce reviewers in the queue. */
export function listingChecks(input: ChecksInput): ListingCheck[] {
  const valid = validPermits(input.permits);
  const matching = valid.filter((p) => !p.purpose || p.purpose === input.listingType);
  const description = (input.description ?? '').trim().length;
  return [
    {
      key: 'basics',
      label: 'Price, size and community filled in',
      ok: input.price != null && input.areaSqft != null && !!input.community,
      required: true,
    },
    {
      key: 'permit',
      label: 'Valid DLD (Trakheesi) advertising permit on file',
      ok: valid.length > 0,
      required: true,
    },
    {
      key: 'permit_purpose',
      label: `Permit is for ${input.listingType === 'sale' ? 'sale' : 'rent'}, like the listing`,
      ok: valid.length > 0 && matching.length > 0,
      required: true,
    },
    {
      key: 'permit_qr',
      label: 'Permit QR link (DLD Madmoun) added',
      ok: matching.some((p) => !!p.verificationUrl),
      required: false,
    },
    {
      key: 'photos',
      label: `At least ${MIN_PHOTOS} photos`,
      ok: input.photoCount >= MIN_PHOTOS,
      required: false,
    },
    {
      key: 'description',
      label: `Description of at least ${MIN_DESCRIPTION_CHARS} characters`,
      ok: description >= MIN_DESCRIPTION_CHARS,
      required: false,
    },
    {
      key: 'agent_verified',
      label: 'Assigned agent is a verified broker (BRN checked)',
      ok: !!input.agentVerifiedUntil && input.agentVerifiedUntil >= today(),
      required: false,
    },
  ];
}

/**
 * A Trakheesi permit belongs to one agency's listing. Refuses a number that another agency has on
 * an unexpired permit. Inside the agency, the unique index already refuses a second listing.
 */
export async function assertPermitNotUsedElsewhere(
  tx: TransactionClient,
  tenantId: string,
  permitNumber: string | null | undefined,
) {
  if (!permitNumber) return;
  await tx.$executeRaw`SELECT set_config('app.permit_lookup', ${permitNumber}, true)`;
  try {
    const elsewhere = await tx.propertyPermit.findFirst({
      where: {
        permitNumber,
        tenantId: { not: tenantId },
        validUntil: { gte: today() },
      },
      select: { id: true },
    });
    if (elsewhere) {
      throw new AppError(
        409,
        'PERMIT_IN_USE',
        'Another agency already advertises with this permit number. A DLD permit belongs to one listing of one agency.',
        [{ path: 'permitNumber', message: 'Used by another agency' }],
      );
    }
  } finally {
    await tx.$executeRaw`SELECT set_config('app.permit_lookup', '', true)`;
  }
}

/** Whether a listing being published must wait for PropForce's review. */
export async function reviewRequired(
  tx: TransactionClient,
  tenantId: string,
  current: { reviewStatus: string },
) {
  if (current.reviewStatus === 'approved') return false;
  const flag = await tx.featureFlag.findUnique({ where: { key: LISTING_REVIEW_FLAG } });
  if (!flag?.enabled) return false;
  const agency = await tx.agency.findUniqueOrThrow({
    where: { id: tenantId },
    select: { isPlatformOwned: true },
  });
  if (agency.isPlatformOwned) return false;
  const approved = await tx.property.count({
    where: { tenantId, reviewStatus: 'approved', deletedAt: null },
  });
  return approved < TRUSTED_AGENCY_APPROVED_LISTINGS;
}
