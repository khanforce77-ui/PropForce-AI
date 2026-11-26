import { Inject, Injectable } from '@nestjs/common';
import {
  withPlatformAdmin,
  withTenant,
  type AgencyDocumentStatus,
  type AgencyDocumentType,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { MediaError, normaliseDocument } from '@propforce/media';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import {
  DOCUMENT_SUBJECT,
  EXPIRY_REQUIRED,
  MULTIPLE_ALLOWED,
  kycRequired,
  loadKyc,
} from './kyc-rules';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const invalid = (path: string, message: string) =>
  new AppError(400, 'VALIDATION_FAILED', message, [{ path, message }]);

export interface OwnerInput {
  fullName: string;
  nationality?: string | null | undefined;
  sharePercent?: number | null | undefined;
  uaeResident?: boolean | undefined;
}
export interface EmployeeInput {
  fullName: string;
  designation?: string | null | undefined;
  isBroker?: boolean | undefined;
  brn?: string | null | undefined;
  email?: string | null | undefined;
}
export interface DocumentUpload {
  type: AgencyDocumentType;
  ownerId?: string | undefined;
  employeeId?: string | undefined;
  expiresAt?: string | undefined;
  documentNumber?: string | undefined;
  label?: string | undefined;
  fileName: string;
}

const today = () => new Date(new Date().toISOString().slice(0, 10));
const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

/**
 * Agency KYC: owners, employees and their documents. The agency's owners and admins upload; a
 * PropForce platform admin approves or rejects each document. Files stay private: no public route
 * serves them, downloads are `no-store`, and RLS limits rows to the agency and platform admins.
 */
@Injectable()
export class KycService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  // ───── agency side ─────

  get(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const [required, kyc, agency] = await Promise.all([
        kycRequired(tx, ctx.tenantId),
        loadKyc(tx, ctx.tenantId),
        tx.agency.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { status: true, approvalStatus: true },
        }),
      ]);
      return {
        required,
        status: agency.status,
        approvalStatus: agency.approvalStatus,
        agency: {
          tradeLicenseNo: kyc.agency.tradeLicenseNo,
          orn: kyc.agency.orn,
          website: kyc.agency.website,
        },
        owners: kyc.owners,
        employees: kyc.employees,
        documents: kyc.documents,
        checklist: kyc.checklist,
      };
    });
  }

  addOwner(ctx: TenantRequestContext, input: OwnerInput) {
    return this.run(ctx, async (tx) => {
      if ((await tx.agencyOwner.count({ where: { tenantId: ctx.tenantId } })) >= 20) {
        throw new AppError(409, 'LIMIT_REACHED', 'An agency can list at most 20 owners.');
      }
      const owner = await tx.agencyOwner.create({
        data: { tenantId: ctx.tenantId, ...clean(input) },
      });
      await audit(tx, ctx, {
        action: 'agency.kyc_owner_added',
        entityType: 'agency_owner',
        entityId: owner.id,
        after: { fullName: owner.fullName },
      });
      return owner;
    });
  }

  updateOwner(ctx: TenantRequestContext, id: string, input: Partial<OwnerInput>) {
    return this.run(ctx, async (tx) => {
      const found = await tx.agencyOwner.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!found) throw notFound('Owner');
      const owner = await tx.agencyOwner.update({ where: { id }, data: clean(input) });
      await audit(tx, ctx, {
        action: 'agency.kyc_owner_updated',
        entityType: 'agency_owner',
        entityId: id,
        after: clean(input),
      });
      return owner;
    });
  }

  removeOwner(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const found = await tx.agencyOwner.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!found) throw notFound('Owner');
      await tx.agencyOwner.delete({ where: { id } });
      await audit(tx, ctx, {
        action: 'agency.kyc_owner_removed',
        entityType: 'agency_owner',
        entityId: id,
        before: { fullName: found.fullName },
      });
    });
  }

  addEmployee(ctx: TenantRequestContext, input: EmployeeInput) {
    return this.run(ctx, async (tx) => {
      if ((await tx.agencyEmployee.count({ where: { tenantId: ctx.tenantId } })) >= 500) {
        throw new AppError(409, 'LIMIT_REACHED', 'An agency can list at most 500 employees.');
      }
      const employee = await tx.agencyEmployee.create({
        data: { tenantId: ctx.tenantId, ...clean(input) },
      });
      await audit(tx, ctx, {
        action: 'agency.kyc_employee_added',
        entityType: 'agency_employee',
        entityId: employee.id,
        after: { fullName: employee.fullName, brn: employee.brn },
      });
      return employee;
    });
  }

  updateEmployee(ctx: TenantRequestContext, id: string, input: Partial<EmployeeInput>) {
    return this.run(ctx, async (tx) => {
      const found = await tx.agencyEmployee.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!found) throw notFound('Employee');
      const employee = await tx.agencyEmployee.update({ where: { id }, data: clean(input) });
      await audit(tx, ctx, {
        action: 'agency.kyc_employee_updated',
        entityType: 'agency_employee',
        entityId: id,
        after: clean(input),
      });
      return employee;
    });
  }

  removeEmployee(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const found = await tx.agencyEmployee.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!found) throw notFound('Employee');
      await tx.agencyEmployee.delete({ where: { id } });
      await audit(tx, ctx, {
        action: 'agency.kyc_employee_removed',
        entityType: 'agency_employee',
        entityId: id,
        before: { fullName: found.fullName },
      });
    });
  }

  /**
   * Saves one document. For single-copy types (everything except permits and staff lists) the new
   * file replaces the earlier one for the same agency / owner / employee, and waits for review.
   */
  async upload(ctx: TenantRequestContext, input: DocumentUpload, body: Buffer) {
    const subject = DOCUMENT_SUBJECT[input.type];
    if (subject === 'owner' && !input.ownerId) throw invalid('ownerId', 'Choose the owner.');
    if (subject === 'employee' && !input.employeeId) {
      throw invalid('employeeId', 'Choose the employee.');
    }
    if (subject !== 'owner' && input.ownerId) throw invalid('ownerId', 'Not used for this document.');
    if (subject !== 'employee' && input.employeeId) {
      throw invalid('employeeId', 'Not used for this document.');
    }
    if (EXPIRY_REQUIRED.has(input.type) && !input.expiresAt) {
      throw invalid('expiresAt', 'Enter the expiry date printed on the document.');
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt < today()) {
      throw invalid('expiresAt', 'This document has expired. Upload the renewed one.');
    }
    if (input.type === 'permit' && !input.label) {
      throw invalid('label', 'Say which permit this is.');
    }
    const doc = await normaliseDocument(body).catch((err: unknown) => {
      if (err instanceof MediaError) {
        throw new AppError(err.code === 'IMAGE_TOO_LARGE' ? 413 : 415, err.code, err.message);
      }
      throw err;
    });
    const fileName = (
      doc.contentType === 'application/pdf'
        ? input.fileName.replace(/(\.pdf)?$/i, '.pdf')
        : input.fileName.replace(/\.[a-z0-9]{1,5}$/i, '') + '.jpg'
    ).slice(0, 200);
    return this.run(ctx, async (tx) => {
      if (input.ownerId) {
        const o = await tx.agencyOwner.findFirst({
          where: { id: input.ownerId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!o) throw notFound('Owner');
      }
      if (input.employeeId) {
        const e = await tx.agencyEmployee.findFirst({
          where: { id: input.employeeId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!e) throw notFound('Employee');
      }
      let replaced = 0;
      if (!MULTIPLE_ALLOWED.has(input.type)) {
        const r = await tx.agencyDocument.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            type: input.type,
            ownerId: input.ownerId ?? null,
            employeeId: input.employeeId ?? null,
          },
        });
        replaced = r.count;
      } else if ((await tx.agencyDocument.count({ where: { tenantId: ctx.tenantId, type: input.type } })) >= 30) {
        throw new AppError(409, 'LIMIT_REACHED', 'Remove an old file before adding another.');
      }
      const saved = await tx.agencyDocument.create({
        data: {
          tenantId: ctx.tenantId,
          type: input.type,
          ownerId: input.ownerId ?? null,
          employeeId: input.employeeId ?? null,
          label: input.label ?? null,
          documentNumber: input.documentNumber ?? null,
          expiresAt,
          contentType: doc.contentType,
          fileName,
          bytes: new Uint8Array(doc.bytes),
          sha256: doc.sha256,
          uploadedBy: ctx.userId,
        },
        select: {
          id: true,
          type: true,
          ownerId: true,
          employeeId: true,
          label: true,
          documentNumber: true,
          expiresAt: true,
          status: true,
          contentType: true,
          fileName: true,
          uploadedAt: true,
        },
      });
      await audit(tx, ctx, {
        action: 'agency.kyc_document_uploaded',
        entityType: 'agency_document',
        entityId: saved.id,
        after: {
          type: input.type,
          ownerId: input.ownerId ?? null,
          employeeId: input.employeeId ?? null,
          sha256: doc.sha256,
          bytes: doc.bytes.length,
          replaced,
        },
      });
      return saved;
    });
  }

  file(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const doc = await tx.agencyDocument.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { contentType: true, fileName: true, bytes: true },
      });
      if (!doc) throw notFound('Document');
      return doc;
    });
  }

  /** An approved document stays: replace it with a new upload instead. */
  removeDocument(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const doc = await tx.agencyDocument.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, type: true, status: true },
      });
      if (!doc) throw notFound('Document');
      if (doc.status === 'approved' && !ctx.platform) {
        throw new AppError(
          409,
          'INVALID_STATUS_CHANGE',
          'PropForce has approved this document. Upload a newer one to replace it.',
        );
      }
      await tx.agencyDocument.delete({ where: { id } });
      await audit(tx, ctx, {
        action: 'agency.kyc_document_removed',
        entityType: 'agency_document',
        entityId: id,
        before: { type: doc.type, status: doc.status },
      });
    });
  }

  // ───── platform admin side ─────

  /** Agencies with documents in the given state, or waiting for approval, newest activity first. */
  queue(adminUserId: string, status: AgencyDocumentStatus) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const grouped = await tx.agencyDocument.groupBy({
        by: ['tenantId'],
        where: { status },
        _count: { _all: true },
        _min: { uploadedAt: true },
      });
      const extra =
        status === 'pending'
          ? await tx.agency.findMany({
              where: { approvalStatus: 'pending', isPlatformOwned: false },
              select: { id: true },
            })
          : [];
      const ids = [...new Set([...grouped.map((g) => g.tenantId), ...extra.map((a) => a.id)])];
      const agencies = await tx.agency.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          emirate: true,
          status: true,
          approvalStatus: true,
          orn: true,
          tradeLicenseNo: true,
          createdAt: true,
          onboardedAt: true,
        },
      });
      const counts = new Map(grouped.map((g) => [g.tenantId, g]));
      return agencies
        .map((a) => ({
          ...a,
          documents: counts.get(a.id)?._count._all ?? 0,
          oldestUpload: counts.get(a.id)?._min.uploadedAt ?? null,
        }))
        .sort(
          (x, y) =>
            (x.oldestUpload?.getTime() ?? x.createdAt.getTime()) -
            (y.oldestUpload?.getTime() ?? y.createdAt.getTime()),
        );
    });
  }

  agencyKyc(adminUserId: string, agencyId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const agency = await tx.agency.findUnique({
        where: { id: agencyId },
        select: {
          id: true,
          name: true,
          emirate: true,
          status: true,
          approvalStatus: true,
          statusReason: true,
          tradeLicenseNo: true,
          orn: true,
          website: true,
          isPlatformOwned: true,
          memberships: {
            where: { role: 'owner', status: 'active' },
            select: { user: { select: { fullName: true, email: true } } },
          },
        },
      });
      if (!agency) throw notFound('Agency');
      const kyc = await loadKyc(tx, agencyId);
      const { memberships, ...rest } = agency;
      return {
        agency: { ...rest, owner: memberships[0]?.user ?? null },
        owners: kyc.owners,
        employees: kyc.employees,
        documents: kyc.documents,
        checklist: kyc.checklist,
      };
    });
  }

  async adminFile(adminUserId: string, id: string) {
    const doc = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.agencyDocument.findUnique({
        where: { id },
        select: { contentType: true, fileName: true, bytes: true },
      }),
    );
    if (!doc) throw notFound('Document');
    return doc;
  }

  async decide(
    adminUserId: string,
    id: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
  ) {
    if (decision === 'reject' && !reason) {
      throw invalid('reason', 'Give the agency a reason.');
    }
    const found = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.agencyDocument.findUnique({ where: { id }, select: { tenantId: true } }),
    );
    if (!found) throw notFound('Document');
    const ctx: TenantRequestContext = {
      tenantId: found.tenantId,
      userId: adminUserId,
      membershipId: null,
      role: 'admin',
      platform: true,
    };
    return this.run(ctx, async (tx) => {
      const d = await tx.agencyDocument.findUnique({ where: { id } });
      if (!d) throw notFound('Document');
      if (decision === 'approve' && d.expiresAt && d.expiresAt < today()) {
        throw new AppError(
          409,
          'INVALID_STATUS_CHANGE',
          'This document has expired. Reject it and ask for the renewed one.',
        );
      }
      const updated = await tx.agencyDocument.update({
        where: { id },
        data: {
          status: decision === 'approve' ? 'approved' : 'rejected',
          reason: decision === 'reject' ? (reason ?? null) : null,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
        select: { id: true, type: true, status: true, reason: true, reviewedAt: true },
      });
      await audit(tx, ctx, {
        action: decision === 'approve' ? 'agency.kyc_document_approved' : 'agency.kyc_document_rejected',
        entityType: 'agency_document',
        entityId: id,
        before: { status: d.status },
        after: { type: d.type, status: updated.status, reason: updated.reason },
      });
      return updated;
    });
  }
}
