import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  withPublicPortal,
  withTenant,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import {
  defaultWatermark,
  MediaError,
  normaliseLogo,
  prepareWatermark,
  processListingPhoto,
  renderDisplayVariants,
} from '@propforce/media';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';

/** Most photos one listing can hold. */
export const MAX_PHOTOS_PER_LISTING = 30;
export type PublicVariant = 'display' | 'thumb';
export type Variant = PublicVariant | 'original';

const versionTag = (p: { sha256: string; version: number }) =>
  `${p.sha256.slice(0, 32)}-${p.version}`;

const notFound = (what = 'Photo') => new AppError(404, 'NOT_FOUND', `${what} not found.`);

const photoMeta = {
  id: true,
  position: true,
  width: true,
  height: true,
  version: true,
  createdAt: true,
} as const;

function mediaToAppError(err: unknown): never {
  if (err instanceof MediaError) {
    const status =
      err.code === 'IMAGE_TOO_LARGE' ? 413 : err.code === 'UNSUPPORTED_IMAGE' ? 415 : 422;
    throw new AppError(status, err.code, err.message);
  }
  throw err;
}

/**
 * Listing photos and the agency logo that watermarks them. The clean original is kept for the
 * agency; everything shown to anyone else is a watermarked copy rendered on the server.
 */
@Injectable()
export class PhotosService {
  private readonly log = new Logger(PhotosService.name);
  /** Prepared watermarks by logo hash; logos change rarely, so a small cache is enough. */
  private readonly marks = new Map<string, Promise<Buffer>>();

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  /** Agents may change photos of listings assigned to them; managers of any listing. */
  private async loadEditable(tx: TransactionClient, ctx: TenantRequestContext, propertyId: string) {
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, assignedMembershipId: true },
    });
    if (!property) throw notFound('Listing');
    if (
      !hasPermission(ctx.role, 'property:manage') &&
      property.assignedMembershipId !== ctx.membershipId
    ) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You can only change listings assigned to you.');
    }
    return property;
  }

  /** The watermark for this agency: its own logo, or the PropForce mark when it has none. */
  private async watermarkFor(tx: TransactionClient, ctx: TenantRequestContext) {
    const logo = await tx.agencyLogo.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { sha256: true, bytes: true },
    });
    if (!logo) return { mark: await defaultWatermark(), markSha256: null };
    return {
      mark: await this.prepared(logo.sha256, Buffer.from(logo.bytes)),
      markSha256: logo.sha256,
    };
  }

  private prepared(sha256: string, png: Buffer) {
    let mark = this.marks.get(sha256);
    if (!mark) {
      if (this.marks.size >= 50) this.marks.delete(this.marks.keys().next().value!);
      mark = prepareWatermark(png);
      mark.catch(() => this.marks.delete(sha256));
      this.marks.set(sha256, mark);
    }
    return mark;
  }

  // ───── listing photos ─────

  list(ctx: TenantRequestContext, propertyId: string) {
    return this.run(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw notFound('Listing');
      const rows = await tx.propertyPhoto.findMany({
        where: { propertyId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { ...photoMeta, thumb: true },
      });
      return {
        data: rows.map(({ thumb, ...p }) => ({
          ...p,
          thumbUrl: `data:image/webp;base64,${Buffer.from(thumb).toString('base64')}`,
        })),
        max: MAX_PHOTOS_PER_LISTING,
      };
    });
  }

  async add(ctx: TenantRequestContext, propertyId: string, input: Buffer) {
    // Check access before spending time on the image, then again when saving.
    const { mark, markSha256 } = await this.run(ctx, async (tx) => {
      await this.loadEditable(tx, ctx, propertyId);
      return this.watermarkFor(tx, ctx);
    });
    const processed = await processListingPhoto(input, mark).catch(mediaToAppError);
    return this.run(ctx, async (tx) => {
      const property = await this.loadEditable(tx, ctx, propertyId);
      // Serialise uploads to one listing so the count and positions stay right.
      await tx.$executeRaw`SELECT 1 FROM "property" WHERE id = ${property.id}::uuid FOR UPDATE`;
      const existing = await tx.propertyPhoto.findMany({
        where: { propertyId: property.id },
        select: { sha256: true, position: true },
      });
      if (existing.length >= MAX_PHOTOS_PER_LISTING) {
        throw new AppError(
          409,
          'TOO_MANY_PHOTOS',
          `A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos.`,
        );
      }
      if (existing.some((p) => p.sha256 === processed.sha256)) {
        throw new AppError(409, 'DUPLICATE_PHOTO', 'This photo is already on the listing.');
      }
      const position = existing.reduce((m, p) => Math.max(m, p.position + 1), 0);
      const photo = await tx.propertyPhoto.create({
        data: {
          tenantId: ctx.tenantId,
          propertyId: property.id,
          position,
          sha256: processed.sha256,
          width: processed.original.width,
          height: processed.original.height,
          original: new Uint8Array(processed.original.bytes),
          display: new Uint8Array(processed.display.bytes),
          thumb: new Uint8Array(processed.thumb.bytes),
          markSha256,
          createdBy: ctx.userId,
        },
        select: photoMeta,
      });
      await audit(tx, ctx, {
        action: 'property.photo_added',
        entityType: 'property',
        entityId: property.id,
        after: { photoId: photo.id, sha256: processed.sha256, bytes: input.length },
      });
      return photo;
    });
  }

  reorder(ctx: TenantRequestContext, propertyId: string, ids: string[]) {
    return this.run(ctx, async (tx) => {
      const property = await this.loadEditable(tx, ctx, propertyId);
      const current = await tx.propertyPhoto.findMany({
        where: { propertyId: property.id },
        select: { id: true },
      });
      const known = new Set(current.map((p) => p.id));
      if (
        ids.length !== known.size ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !known.has(id))
      ) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'Send every photo of the listing exactly once.',
          [{ path: 'ids', message: 'Must list each photo once' }],
        );
      }
      for (const [position, id] of ids.entries()) {
        await tx.propertyPhoto.update({ where: { id }, data: { position } });
      }
      await audit(tx, ctx, {
        action: 'property.photos_reordered',
        entityType: 'property',
        entityId: property.id,
        after: { ids },
      });
      return { ids };
    });
  }

  remove(ctx: TenantRequestContext, propertyId: string, photoId: string) {
    return this.run(ctx, async (tx) => {
      const property = await this.loadEditable(tx, ctx, propertyId);
      const deleted = await tx.propertyPhoto.deleteMany({
        where: { id: photoId, propertyId: property.id },
      });
      if (deleted.count === 0) throw notFound();
      // Close the gap so the order stays 0, 1, 2…
      const rest = await tx.propertyPhoto.findMany({
        where: { propertyId: property.id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, position: true },
      });
      for (const [position, p] of rest.entries()) {
        if (p.position !== position) {
          await tx.propertyPhoto.update({ where: { id: p.id }, data: { position } });
        }
      }
      await audit(tx, ctx, {
        action: 'property.photo_removed',
        entityType: 'property',
        entityId: property.id,
        before: { photoId },
      });
    });
  }

  /** One version of a photo for the agency's own users. */
  file(ctx: TenantRequestContext, propertyId: string, photoId: string, variant: Variant) {
    return this.run(ctx, async (tx) => {
      const photo = await tx.propertyPhoto.findFirst({
        where: { id: photoId, propertyId, property: { deletedAt: null } },
        select: {
          sha256: true,
          version: true,
          original: variant === 'original',
          display: variant === 'display',
          thumb: variant === 'thumb',
        },
      });
      const bytes = photo?.[variant];
      if (!photo || !bytes) throw notFound();
      return {
        bytes: Buffer.from(bytes),
        contentType: variant === 'original' ? 'image/jpeg' : 'image/webp',
        etag: variant === 'original' ? photo.sha256 : versionTag(photo),
      };
    });
  }

  /** For the public portal: only watermarked versions, only of listings the portal may show. */
  publicFile(photoId: string, variant: PublicVariant) {
    return withPublicPortal(this.prisma, async (tx) => {
      const photo = await tx.propertyPhoto.findUnique({
        where: { id: photoId },
        // Never the original: it is clean, without the watermark.
        select: {
          sha256: true,
          version: true,
          display: variant === 'display',
          thumb: variant === 'thumb',
        },
      });
      const bytes = photo?.[variant];
      if (!photo || !bytes) return null;
      return { bytes: Buffer.from(bytes), etag: versionTag(photo) };
    });
  }

  // ───── agency logo ─────

  getLogo(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const logo = await tx.agencyLogo.findUnique({ where: { tenantId: ctx.tenantId } });
      return {
        logo: logo
          ? {
              sha256: logo.sha256,
              width: logo.width,
              height: logo.height,
              updatedAt: logo.updatedAt,
              dataUrl: `data:image/png;base64,${Buffer.from(logo.bytes).toString('base64')}`,
            }
          : null,
      };
    });
  }

  async setLogo(ctx: TenantRequestContext, input: Buffer) {
    const logo = await normaliseLogo(input).catch(mediaToAppError);
    // A blank or invisible logo would leave photos unprotected: refuse it up front.
    await prepareWatermark(logo.bytes).catch(mediaToAppError);
    await this.run(ctx, async (tx) => {
      const data = {
        bytes: new Uint8Array(logo.bytes),
        sha256: logo.sha256,
        width: logo.width,
        height: logo.height,
      };
      await tx.agencyLogo.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, ...data },
        update: data,
        select: { tenantId: true },
      });
      await audit(tx, ctx, {
        action: 'agency.logo_updated',
        entityType: 'agency',
        entityId: ctx.tenantId,
        after: { sha256: logo.sha256, width: logo.width, height: logo.height },
      });
    });
    const rerendered = await this.rerender(ctx);
    return { logo: { sha256: logo.sha256, width: logo.width, height: logo.height }, rerendered };
  }

  async removeLogo(ctx: TenantRequestContext) {
    const removed = await this.run(ctx, async (tx) => {
      const deleted = await tx.agencyLogo.deleteMany({ where: { tenantId: ctx.tenantId } });
      if (deleted.count > 0) {
        await audit(tx, ctx, {
          action: 'agency.logo_removed',
          entityType: 'agency',
          entityId: ctx.tenantId,
        });
      }
      return deleted.count > 0;
    });
    return { rerendered: removed ? await this.rerender(ctx) : 0 };
  }

  /**
   * Re-renders the watermarked versions of every photo whose mark is out of date, one photo per
   * transaction so a long run never holds locks. Idempotent: a retry picks up where it stopped.
   * TODO(queue): move to a background job once BullMQ workers are deployed.
   */
  private async rerender(ctx: TenantRequestContext) {
    const { mark, markSha256 } = await this.run(ctx, (tx) => this.watermarkFor(tx, ctx));
    const stale = await this.run(ctx, (tx) =>
      tx.propertyPhoto.findMany({
        where: markSha256
          ? { OR: [{ markSha256: null }, { markSha256: { not: markSha256 } }] }
          : { markSha256: { not: null } },
        select: { id: true },
      }),
    );
    let done = 0;
    for (const { id } of stale) {
      const row = await this.run(ctx, (tx) =>
        tx.propertyPhoto.findUnique({ where: { id }, select: { original: true } }),
      );
      if (!row) continue;
      try {
        const { display, thumb } = await renderDisplayVariants(Buffer.from(row.original), mark);
        await this.run(ctx, (tx) =>
          tx.propertyPhoto.update({
            where: { id },
            data: {
              display: new Uint8Array(display.bytes),
              thumb: new Uint8Array(thumb.bytes),
              markSha256,
              version: { increment: 1 },
            },
          }),
        );
        done++;
      } catch (err) {
        this.log.warn({ err, photoId: id }, 'Could not re-render a listing photo watermark');
      }
    }
    return done;
  }
}
