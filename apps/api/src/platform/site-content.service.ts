import { Inject, Injectable } from '@nestjs/common';
import { MediaError, normaliseBanner } from '@propforce/media';
import { Prisma, type PrismaClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { PlatformService } from './platform.service';
import {
  SITE_SCHEMAS,
  mergeWithDefaults,
  type BannerCreate,
  type BannerUpdate,
  type Placement,
  type PlatformSettings,
  type PortalContent,
  type SiteKey,
} from './site-content.schemas';

export type { SiteKey } from './site-content.schemas';

/** Everything about a banner except the image bytes. */
const bannerSelect = {
  id: true,
  placement: true,
  kind: true,
  title: true,
  subtitle: true,
  ctaLabel: true,
  linkUrl: true,
  advertiser: true,
  active: true,
  sortOrder: true,
  startsAt: true,
  endsAt: true,
  imageWidth: true,
  imageHeight: true,
  imageSha256: true,
  clicks: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SiteBannerSelect;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Banner not found.');

/** Banners the public can see right now: active, inside their schedule, with an image. */
function visibleNow(now = new Date()): Prisma.SiteBannerWhereInput {
  return {
    active: true,
    image: { not: null },
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

/**
 * Website content (text, banners, adverts) and platform settings, edited by platform admins and
 * read by the public portal. Global data, not tenant data.
 */
@Injectable()
export class SiteContentService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly platform: PlatformService,
  ) {}

  // ───── settings ─────

  async read(key: 'portal'): Promise<PortalContent>;
  async read(key: 'platform'): Promise<PlatformSettings>;
  async read(key: SiteKey): Promise<PortalContent | PlatformSettings> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key } });
    return mergeWithDefaults(key, row?.value) as PortalContent | PlatformSettings;
  }

  async write(adminUserId: string, key: SiteKey, value: unknown) {
    const parsed = SITE_SCHEMAS[key].safeParse(value);
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Some fields are not valid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const data = parsed.data as Prisma.InputJsonValue;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.siteSetting.findUnique({ where: { key } });
      await tx.siteSetting.upsert({
        where: { key },
        create: { key, value: data, updatedBy: adminUserId },
        update: { value: data, updatedBy: adminUserId },
      });
      await this.platform.platformAudit(
        tx,
        adminUserId,
        key === 'portal' ? 'platform.website_content_changed' : 'platform.settings_changed',
        'site_setting',
        key,
        { ...(before ? { before: before.value as Prisma.InputJsonValue } : {}), after: {} },
        key === 'portal' ? 'Website content' : 'Platform settings',
      );
      return parsed.data as PortalContent | PlatformSettings;
    });
  }

  // ───── banners (admin) ─────

  listBanners() {
    return this.prisma.siteBanner.findMany({
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: bannerSelect,
    });
  }

  createBanner(adminUserId: string, input: BannerCreate) {
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.siteBanner.create({
        data: {
          placement: input.placement,
          kind: input.kind,
          title: input.title,
          subtitle: input.subtitle ?? null,
          ctaLabel: input.ctaLabel ?? null,
          linkUrl: input.linkUrl ?? null,
          advertiser: input.advertiser ?? null,
          sortOrder: input.sortOrder,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          // A banner goes live only after it has an image and the admin switches it on.
          active: false,
          createdBy: adminUserId,
        },
        select: bannerSelect,
      });
      await this.platform.platformAudit(
        tx,
        adminUserId,
        'platform.banner_created',
        'site_banner',
        banner.id,
        { after: { placement: banner.placement, kind: banner.kind } },
        banner.title,
      );
      return banner;
    });
  }

  updateBanner(adminUserId: string, id: string, input: BannerUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.siteBanner.findUnique({ where: { id }, select: bannerSelect });
      if (!before) throw notFound();
      const data: Prisma.SiteBannerUpdateInput = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        (data as Record<string, unknown>)[k] =
          (k === 'startsAt' || k === 'endsAt') && typeof v === 'string' ? new Date(v) : v;
      }
      const startsAt = 'startsAt' in data ? (data.startsAt as Date | null) : before.startsAt;
      const endsAt = 'endsAt' in data ? (data.endsAt as Date | null) : before.endsAt;
      if (startsAt && endsAt && startsAt >= endsAt) {
        throw new AppError(400, 'VALIDATION_FAILED', 'The end must be after the start.', [
          { path: 'endsAt', message: 'The end must be after the start' },
        ]);
      }
      if (input.active === true && !before.imageSha256) {
        throw new AppError(
          409,
          'INVALID_STATUS_CHANGE',
          'Upload an image before switching this banner on.',
        );
      }
      const after = await tx.siteBanner.update({ where: { id }, data, select: bannerSelect });
      await this.platform.platformAudit(
        tx,
        adminUserId,
        'platform.banner_updated',
        'site_banner',
        id,
        { after: { changed: Object.keys(data) } },
        after.title,
      );
      return after;
    });
  }

  async setBannerImage(adminUserId: string, id: string, input: Buffer) {
    let image;
    try {
      image = await normaliseBanner(input);
    } catch (err) {
      if (err instanceof MediaError) {
        const status =
          err.code === 'IMAGE_TOO_LARGE' ? 413 : err.code === 'UNSUPPORTED_IMAGE' ? 415 : 422;
        throw new AppError(status, err.code, err.message);
      }
      throw err;
    }
    if (image.bytes.length > 3 * 1024 * 1024) {
      throw new AppError(413, 'IMAGE_TOO_LARGE', 'This image is too detailed; try a smaller one.');
    }
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.siteBanner.findUnique({ where: { id }, select: { title: true } });
      if (!exists) throw notFound();
      const banner = await tx.siteBanner.update({
        where: { id },
        data: {
          image: new Uint8Array(image.bytes),
          imageWidth: image.width,
          imageHeight: image.height,
          imageSha256: image.sha256,
        },
        select: bannerSelect,
      });
      await this.platform.platformAudit(
        tx,
        adminUserId,
        'platform.banner_image_changed',
        'site_banner',
        id,
        { after: { width: image.width, height: image.height } },
        exists.title,
      );
      return banner;
    });
  }

  deleteBanner(adminUserId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.siteBanner.findUnique({ where: { id }, select: bannerSelect });
      if (!banner) throw notFound();
      await tx.siteBanner.delete({ where: { id } });
      await this.platform.platformAudit(
        tx,
        adminUserId,
        'platform.banner_deleted',
        'site_banner',
        id,
        { before: { placement: banner.placement, clicks: banner.clicks } },
        banner.title,
      );
    });
  }

  /** The image of any banner, live or not, for the admin preview. */
  async adminImage(id: string) {
    const row = await this.prisma.siteBanner.findUnique({
      where: { id },
      select: { image: true, imageSha256: true },
    });
    if (!row?.image || !row.imageSha256) throw notFound();
    return { bytes: Buffer.from(row.image), etag: row.imageSha256 };
  }

  // ───── public ─────

  /** Website content plus the banners that are live right now, grouped by placement. */
  async publicSite() {
    const [content, banners] = await Promise.all([
      this.read('portal'),
      this.prisma.siteBanner.findMany({
        where: visibleNow(),
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: 60,
        select: {
          id: true,
          placement: true,
          kind: true,
          title: true,
          subtitle: true,
          ctaLabel: true,
          linkUrl: true,
          advertiser: true,
          imageWidth: true,
          imageHeight: true,
          imageSha256: true,
        },
      }),
    ]);
    const grouped: Record<Placement, PublicBanner[]> = {
      home_hero: [],
      home_strip: [],
      search_top: [],
      listing_sidebar: [],
    };
    for (const b of banners) {
      const list = grouped[b.placement as Placement];
      if (!list) continue;
      list.push({
        id: b.id,
        kind: b.kind as 'banner' | 'ad',
        title: b.title,
        subtitle: b.subtitle,
        ctaLabel: b.ctaLabel,
        hasLink: b.linkUrl !== null,
        advertiser: b.kind === 'ad' ? b.advertiser : null,
        image: {
          version: b.imageSha256!.slice(0, 16),
          width: b.imageWidth!,
          height: b.imageHeight!,
        },
      });
    }
    return { content, banners: grouped };
  }

  async publicImage(id: string) {
    const row = await this.prisma.siteBanner.findFirst({
      where: { id, ...visibleNow() },
      select: { image: true, imageSha256: true },
    });
    if (!row?.image || !row.imageSha256) throw notFound();
    return { bytes: Buffer.from(row.image), etag: row.imageSha256 };
  }

  /** Counts a click on a live banner and returns where it goes. */
  async click(id: string) {
    const rows = await this.prisma.siteBanner.updateManyAndReturn({
      where: { id, linkUrl: { not: null }, ...visibleNow() },
      data: { clicks: { increment: 1 } },
      select: { linkUrl: true },
    });
    const url = rows[0]?.linkUrl;
    if (!url) throw notFound();
    return { url };
  }

  /** The notice platform admins want every agency to see, or null. */
  async appNotice() {
    const { appNotice } = await this.read('platform');
    return appNotice.enabled && appNotice.text
      ? { text: appNotice.text, tone: appNotice.tone }
      : null;
  }
}

export interface PublicBanner {
  id: string;
  kind: 'banner' | 'ad';
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  hasLink: boolean;
  advertiser: string | null;
  image: { version: string; width: number; height: number };
}
