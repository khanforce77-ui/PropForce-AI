import type {
  AgencyDocumentStatus,
  AgencyDocumentType,
  TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';

/** Feature flag: new agencies upload KYC documents and PropForce approves them before going live. */
export const KYC_FLAG = 'platform.require_agency_documents';

export const AGENCY_DOCUMENT_TYPES = [
  'trade_license',
  'moa',
  'ejari',
  'orn_certificate',
  'owner_passport',
  'owner_emirates_id',
  'employee_brn_card',
  'employee_emirates_id',
  'permit',
  'employee_list',
] as const satisfies readonly AgencyDocumentType[];

/** Who a document type belongs to. */
export const DOCUMENT_SUBJECT: Record<AgencyDocumentType, 'agency' | 'owner' | 'employee'> = {
  trade_license: 'agency',
  moa: 'agency',
  ejari: 'agency',
  orn_certificate: 'agency',
  owner_passport: 'owner',
  owner_emirates_id: 'owner',
  employee_brn_card: 'employee',
  employee_emirates_id: 'employee',
  permit: 'agency',
  employee_list: 'agency',
};

/** Types whose expiry date must be given (the platform tracks renewals). */
export const EXPIRY_REQUIRED: ReadonlySet<AgencyDocumentType> = new Set([
  'trade_license',
  'ejari',
  'orn_certificate',
  'owner_passport',
  'owner_emirates_id',
  'employee_brn_card',
  'employee_emirates_id',
  'permit',
]);

/** Types an agency may hold several of; for the others a new upload replaces the old one. */
export const MULTIPLE_ALLOWED: ReadonlySet<AgencyDocumentType> = new Set([
  'permit',
  'employee_list',
]);

export const DOCUMENT_LABELS: Record<AgencyDocumentType, string> = {
  trade_license: 'Trade licence',
  moa: 'Memorandum of association (MOA)',
  ejari: 'Office Ejari',
  orn_certificate: 'DLD / RERA office card (ORN)',
  owner_passport: 'Passport',
  owner_emirates_id: 'Emirates ID',
  employee_brn_card: 'DLD broker card (BRN)',
  employee_emirates_id: 'Emirates ID',
  permit: 'Permit',
  employee_list: 'Employee list',
};

export interface KycDocumentMeta {
  id: string;
  type: AgencyDocumentType;
  ownerId: string | null;
  employeeId: string | null;
  status: AgencyDocumentStatus;
  expiresAt: Date | null;
}
export interface KycOwnerMeta {
  id: string;
  fullName: string;
  uaeResident: boolean;
}
export interface KycEmployeeMeta {
  id: string;
  fullName: string;
  isBroker: boolean;
  brn: string | null;
}
export interface KycAgencyMeta {
  tradeLicenseNo: string | null;
  orn: string | null;
  website: string | null;
  hasLogo: boolean;
}

/** missing: nothing on file; expired: the newest file has expired. */
export type KycItemState = 'missing' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface KycItem {
  key: string;
  label: string;
  /** What the item is about: the agency, or an owner's / employee's name. */
  subject: string;
  kind: 'field' | 'document' | 'list';
  type?: AgencyDocumentType;
  ownerId?: string;
  employeeId?: string;
  documentId?: string;
  state: KycItemState;
}

export interface KycChecklist {
  items: KycItem[];
  /** Every required item is on file (pending or approved): the agency may submit. */
  complete: boolean;
  /** Every required item is approved: PropForce may approve the agency (it goes live). */
  approved: boolean;
  missing: string[];
}

const startOfToday = (now: Date) => new Date(now.toISOString().slice(0, 10));

function docState(doc: KycDocumentMeta | undefined, now: Date): KycItemState {
  if (!doc) return 'missing';
  if (doc.expiresAt && doc.expiresAt < startOfToday(now)) return 'expired';
  return doc.status;
}

/**
 * The Dubai registration checklist. Fields (trade licence number, ORN, website, logo) are simple
 * "given / not given" items that count as approved once given; documents carry PropForce's
 * decision. Permits and an uploaded staff list are optional and not listed here.
 */
export function kycChecklist(
  agency: KycAgencyMeta,
  owners: KycOwnerMeta[],
  employees: KycEmployeeMeta[],
  documents: KycDocumentMeta[],
  now = new Date(),
): KycChecklist {
  const items: KycItem[] = [];
  const field = (key: string, label: string, given: boolean) =>
    items.push({ key, label, subject: 'Agency', kind: 'field', state: given ? 'approved' : 'missing' });
  field('trade_license_no', 'Trade licence number', !!agency.tradeLicenseNo);
  field('orn', 'Office registration number (ORN)', !!agency.orn);
  field('website', 'Website', !!agency.website);
  field('logo', 'Company logo', agency.hasLogo);

  // The newest document for each slot counts.
  const newest = new Map<string, KycDocumentMeta>();
  for (const d of documents) {
    const slot = `${d.type}:${d.ownerId ?? ''}:${d.employeeId ?? ''}`;
    if (!newest.has(slot)) newest.set(slot, d);
  }
  const doc = (
    type: AgencyDocumentType,
    subject: string,
    ids: { ownerId?: string; employeeId?: string } = {},
  ) => {
    const d = newest.get(`${type}:${ids.ownerId ?? ''}:${ids.employeeId ?? ''}`);
    items.push({
      key: [type, ids.ownerId ?? ids.employeeId].filter(Boolean).join(':'),
      label: DOCUMENT_LABELS[type],
      subject,
      kind: 'document',
      type,
      ...ids,
      ...(d ? { documentId: d.id } : {}),
      state: docState(d, now),
    });
  };
  doc('trade_license', 'Agency');
  doc('moa', 'Agency');
  doc('ejari', 'Agency');
  doc('orn_certificate', 'Agency');

  items.push({
    key: 'owners',
    label: 'At least one owner',
    subject: 'Owners',
    kind: 'list',
    state: owners.length > 0 ? 'approved' : 'missing',
  });
  for (const o of owners) {
    doc('owner_passport', o.fullName, { ownerId: o.id });
    if (o.uaeResident) doc('owner_emirates_id', o.fullName, { ownerId: o.id });
  }

  items.push({
    key: 'employees',
    label: 'Employee list (at least one person)',
    subject: 'Employees',
    kind: 'list',
    state: employees.length > 0 ? 'approved' : 'missing',
  });
  for (const e of employees) {
    doc('employee_emirates_id', e.fullName, { employeeId: e.id });
    if (e.isBroker) {
      items.push({
        key: `brn:${e.id}`,
        label: 'BRN number',
        subject: e.fullName,
        kind: 'field',
        employeeId: e.id,
        state: e.brn ? 'approved' : 'missing',
      });
      doc('employee_brn_card', e.fullName, { employeeId: e.id });
    }
  }

  const describe = (i: KycItem) =>
    i.subject === 'Agency' || i.kind === 'list' ? i.label : `${i.label} (${i.subject})`;
  const open = items.filter((i) => i.state === 'missing' || i.state === 'rejected' || i.state === 'expired');
  return {
    items,
    complete: open.length === 0,
    approved: items.every((i) => i.state === 'approved'),
    missing: open.map(describe),
  };
}

/** Reads everything the checklist needs, in the agency's (or platform admin's) transaction. */
export async function loadKyc(tx: TransactionClient, tenantId: string) {
  const [agency, logo, owners, employees, documents] = await Promise.all([
    tx.agency.findUniqueOrThrow({
      where: { id: tenantId },
      select: { tradeLicenseNo: true, orn: true, website: true, isPlatformOwned: true },
    }),
    tx.agencyLogo.findUnique({ where: { tenantId }, select: { tenantId: true } }),
    tx.agencyOwner.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        nationality: true,
        sharePercent: true,
        uaeResident: true,
      },
    }),
    tx.agencyEmployee.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        designation: true,
        isBroker: true,
        brn: true,
        email: true,
      },
    }),
    tx.agencyDocument.findMany({
      where: { tenantId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        ownerId: true,
        employeeId: true,
        label: true,
        documentNumber: true,
        expiresAt: true,
        status: true,
        reason: true,
        contentType: true,
        fileName: true,
        uploadedAt: true,
        reviewedAt: true,
      },
    }),
  ]);
  const checklist = kycChecklist(
    { ...agency, hasLogo: !!logo },
    owners,
    employees,
    documents,
  );
  return { agency, owners, employees, documents, checklist };
}

export async function kycRequired(tx: TransactionClient, tenantId: string) {
  const [flag, agency] = await Promise.all([
    tx.featureFlag.findUnique({ where: { key: KYC_FLAG }, select: { enabled: true } }),
    tx.agency.findUniqueOrThrow({ where: { id: tenantId }, select: { isPlatformOwned: true } }),
  ]);
  return flag?.enabled === true && !agency.isPlatformOwned;
}

const listOf = (missing: string[]) =>
  missing.length > 6 ? `${missing.slice(0, 6).join(', ')} and ${missing.length - 6} more` : missing.join(', ');

/** Before submitting for approval: every required item must be on file. */
export async function assertKycComplete(tx: TransactionClient, tenantId: string) {
  if (!(await kycRequired(tx, tenantId))) return false;
  const { checklist } = await loadKyc(tx, tenantId);
  if (!checklist.complete) {
    throw new AppError(
      409,
      'KYC_INCOMPLETE',
      `Upload the remaining registration documents first: ${listOf(checklist.missing)}.`,
    );
  }
  return true;
}

/** Before PropForce approves the agency: every required item must be approved. */
export async function assertKycApproved(tx: TransactionClient, tenantId: string) {
  if (!(await kycRequired(tx, tenantId))) return;
  const { checklist } = await loadKyc(tx, tenantId);
  if (!checklist.approved) {
    const waiting = checklist.items
      .filter((i) => i.state !== 'approved')
      .map((i) => (i.subject === 'Agency' || i.kind === 'list' ? i.label : `${i.label} (${i.subject})`));
    throw new AppError(
      409,
      'KYC_NOT_APPROVED',
      `Approve every registration document before approving the agency. Still open: ${listOf(waiting)}.`,
    );
  }
}
