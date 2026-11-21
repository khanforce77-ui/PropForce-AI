import { Inject, Injectable } from '@nestjs/common';
import { withPublicPortal, withTenant, type PrismaClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import { parsePhotoDataUrl } from './agent-photo';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Member not found.');

/** Agents' profile photos: set by the agent (or a manager), shown on the public portal. */
@Injectable()
export class AgentPhotoService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private assertMayEdit(ctx: TenantRequestContext, membershipId: string) {
    if (membershipId !== ctx.membershipId && !hasPermission(ctx.role, 'property:manage')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You can only change your own photo.');
    }
  }

  private run<T>(ctx: TenantRequestContext, fn: Parameters<typeof withTenant<T>>[2]) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  get(ctx: TenantRequestContext, membershipId: string) {
    return this.run(ctx, async (tx) => {
      const photo = await tx.memberPhoto.findFirst({
        where: { membershipId, tenantId: ctx.tenantId },
      });
      return {
        photo: photo
          ? {
              sha256: photo.sha256,
              dataUrl: `data:${photo.contentType};base64,${Buffer.from(photo.bytes).toString('base64')}`,
            }
          : null,
      };
    });
  }

  set(ctx: TenantRequestContext, membershipId: string, image: string) {
    this.assertMayEdit(ctx, membershipId);
    const parsed = parsePhotoDataUrl(image);
    if ('error' in parsed) {
      throw new AppError(400, 'VALIDATION_FAILED', parsed.error, [
        { path: 'image', message: parsed.error },
      ]);
    }
    return this.run(ctx, async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, status: { not: 'removed' } },
        select: { id: true },
      });
      if (!member) throw notFound();
      const data = {
        contentType: parsed.contentType,
        bytes: new Uint8Array(parsed.bytes),
        sha256: parsed.sha256,
      };
      await tx.memberPhoto.upsert({
        where: { membershipId: member.id },
        create: { membershipId: member.id, tenantId: ctx.tenantId, ...data },
        update: data,
        select: { sha256: true },
      });
      await audit(tx, ctx, {
        action: 'member.photo_updated',
        entityType: 'membership',
        entityId: member.id,
        after: { sha256: parsed.sha256, bytes: parsed.bytes.length },
      });
      return { photo: { sha256: parsed.sha256 } };
    });
  }

  remove(ctx: TenantRequestContext, membershipId: string) {
    this.assertMayEdit(ctx, membershipId);
    return this.run(ctx, async (tx) => {
      const deleted = await tx.memberPhoto.deleteMany({
        where: { membershipId, tenantId: ctx.tenantId },
      });
      if (deleted.count > 0) {
        await audit(tx, ctx, {
          action: 'member.photo_removed',
          entityType: 'membership',
          entityId: membershipId,
        });
      }
    });
  }

  /** For the public portal: only photos of agents the portal may show. */
  publicPhoto(membershipId: string) {
    return withPublicPortal(this.prisma, (tx) =>
      tx.memberPhoto.findUnique({
        where: { membershipId },
        select: { contentType: true, bytes: true, sha256: true },
      }),
    );
  }
}
