import { z } from 'zod';

/** A link on the public website: https anywhere, or a path on the portal itself ("/for-sale"). */
export const siteLink = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => {
      if (v.startsWith('/')) return !v.startsWith('//') && !v.includes('\\');
      try {
        return new URL(v).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Use an https:// link or a path on the website such as /for-sale' },
  );

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => {
      try {
        return new URL(v).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Use an https:// link' },
  );

const optionalText = (max: number) => z.string().trim().max(max).optional();
const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +971501234567');

export const PLACEMENTS = ['home_hero', 'home_strip', 'search_top', 'listing_sidebar'] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Public website content. Every field has a default, so a fresh install shows a complete site. */
export const portalContentSchema = z.strictObject({
  /** Overrides the website name; empty keeps the deployment's default. */
  siteName: optionalText(60),
  hero: z.strictObject({
    title: z.string().trim().min(3).max(90),
    subtitle: z.string().trim().max(240),
  }),
  announcement: z.strictObject({
    enabled: z.boolean(),
    text: z.string().trim().max(160),
    linkUrl: siteLink.optional(),
    linkLabel: optionalText(30),
  }),
  sections: z.strictObject({
    popularCommunities: z.boolean(),
    latestListings: z.boolean(),
  }),
  about: z.string().trim().max(600),
  contact: z.strictObject({
    email: z.email().max(120).optional(),
    phone: e164.optional(),
    whatsapp: e164.optional(),
    address: optionalText(200),
  }),
  social: z.strictObject({
    instagram: httpsUrl.optional(),
    facebook: httpsUrl.optional(),
    linkedin: httpsUrl.optional(),
    x: httpsUrl.optional(),
    youtube: httpsUrl.optional(),
    tiktok: httpsUrl.optional(),
  }),
  seo: z.strictObject({
    title: optionalText(70),
    description: optionalText(170),
  }),
});
export type PortalContent = z.infer<typeof portalContentSchema>;

export const PORTAL_DEFAULTS: PortalContent = {
  hero: {
    title: 'Find your next home in Dubai',
    subtitle:
      'Apartments, villas and new projects to buy or rent. Every listing has a valid permit, and you talk to the agent directly on WhatsApp or phone.',
  },
  announcement: { enabled: false, text: '' },
  sections: { popularCommunities: true, latestListings: true },
  about:
    "Search homes to buy or rent in Dubai. Every listing shows its advertising permit and the agent's licence, and you can call or WhatsApp the agent directly. Free for buyers and tenants.",
  contact: {},
  social: {},
  seo: {},
};

/** Platform-wide settings for the CRM side. */
export const platformSettingsSchema = z.strictObject({
  supportEmail: z.email().max(120).optional(),
  supportPhone: e164.optional(),
  /** Applied to every agency that registers itself from now on. */
  newAgencyDefaults: z.strictObject({
    plan: z.string().trim().min(1).max(40),
    seatLimit: z.number().int().min(1).max(10_000).nullable(),
    listingLimit: z.number().int().min(0).max(1_000_000).nullable(),
  }),
  /** A notice shown at the top of every agency's app, e.g. planned maintenance. */
  appNotice: z.strictObject({
    enabled: z.boolean(),
    text: z.string().trim().max(240),
    tone: z.enum(['info', 'warning', 'success']),
  }),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const PLATFORM_DEFAULTS: PlatformSettings = {
  newAgencyDefaults: { plan: 'trial', seatLimit: null, listingLimit: null },
  appNotice: { enabled: false, text: '', tone: 'info' },
};

const bannerFields = {
  placement: z.enum(PLACEMENTS),
  kind: z.enum(['banner', 'ad']),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(240).nullable(),
  ctaLabel: z.string().trim().max(30).nullable(),
  linkUrl: siteLink.nullable(),
  advertiser: z.string().trim().max(80).nullable(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
};

const scheduleOk = (v: { startsAt?: string | null; endsAt?: string | null }) =>
  !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt);
const scheduleMessage = { message: 'The end must be after the start', path: ['endsAt'] };

export const bannerCreateSchema = z
  .strictObject({
    placement: bannerFields.placement,
    kind: bannerFields.kind.default('banner'),
    title: bannerFields.title,
    subtitle: bannerFields.subtitle.optional(),
    ctaLabel: bannerFields.ctaLabel.optional(),
    linkUrl: bannerFields.linkUrl.optional(),
    advertiser: bannerFields.advertiser.optional(),
    sortOrder: bannerFields.sortOrder.default(0),
    startsAt: bannerFields.startsAt.optional(),
    endsAt: bannerFields.endsAt.optional(),
  })
  .refine(scheduleOk, scheduleMessage);
export type BannerCreate = z.infer<typeof bannerCreateSchema>;

export const bannerUpdateSchema = z
  .strictObject({
    placement: bannerFields.placement.optional(),
    kind: bannerFields.kind.optional(),
    title: bannerFields.title.optional(),
    subtitle: bannerFields.subtitle.optional(),
    ctaLabel: bannerFields.ctaLabel.optional(),
    linkUrl: bannerFields.linkUrl.optional(),
    advertiser: bannerFields.advertiser.optional(),
    active: bannerFields.active.optional(),
    sortOrder: bannerFields.sortOrder.optional(),
    startsAt: bannerFields.startsAt.optional(),
    endsAt: bannerFields.endsAt.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(scheduleOk, scheduleMessage);
export type BannerUpdate = z.infer<typeof bannerUpdateSchema>;

/** Agency created by a platform admin. */
export const agencyCreateSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  emirate: z.string().trim().min(2).max(40),
  orn: z.string().trim().max(40).optional(),
  tradeLicenseNo: z.string().trim().max(60).optional(),
  plan: z.string().trim().min(1).max(40).optional(),
  seatLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  listingLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  /** Gets an email invitation to become the agency's owner. */
  ownerEmail: z.email().max(254).optional(),
});
export type AgencyCreate = z.infer<typeof agencyCreateSchema>;

export const agencyInviteSchema = z.strictObject({
  email: z.email().max(254),
  role: z.enum(['owner', 'admin']).default('owner'),
});

/** Editable agency details (on top of plan and limits). */
export const agencyDetailsSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    emirate: z.string().trim().min(2).max(40).optional(),
    orn: z.string().trim().max(40).nullable().optional(),
    tradeLicenseNo: z.string().trim().max(60).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type SiteKey = 'portal' | 'platform';
export const SITE_SCHEMAS = { portal: portalContentSchema, platform: platformSettingsSchema };
const DEFAULTS = { portal: PORTAL_DEFAULTS, platform: PLATFORM_DEFAULTS };

/**
 * Stored settings over the defaults, one level deep, so fields added later get their default.
 * Anything that no longer validates falls back to the defaults rather than breaking the site.
 */
export function mergeWithDefaults(key: SiteKey, stored: unknown) {
  const defaults = DEFAULTS[key] as Record<string, unknown>;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return DEFAULTS[key];
  const merged: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const d = defaults[k];
    merged[k] =
      d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object'
        ? { ...d, ...(v as object) }
        : v;
  }
  const parsed = (SITE_SCHEMAS[key] as z.ZodType).safeParse(merged);
  return parsed.success ? (parsed.data as PortalContent | PlatformSettings) : DEFAULTS[key];
}
