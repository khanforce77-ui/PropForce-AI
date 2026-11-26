export type CaptionPlatform = 'instagram' | 'facebook' | 'linkedin' | 'whatsapp_status';
export type CaptionStatus = 'draft' | 'approved' | 'discarded';

export const PLATFORM_LABEL: Record<CaptionPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  whatsapp_status: 'WhatsApp status',
};

export interface Caption {
  id: string;
  propertyId: string;
  platform: CaptionPlatform;
  language: 'en' | 'ar';
  text: string;
  status: CaptionStatus;
  reviewedAt: string | null;
  createdAt: string;
  property: { reference: string; title: string | null };
}

export interface AttributionRow {
  leads: number;
  engaged: number;
  won: number;
}
export interface Attribution {
  days: number;
  campaigns: (AttributionRow & {
    source: string | null;
    medium: string | null;
    campaign: string | null;
  })[];
  sources: (AttributionRow & { source: string })[];
}

export interface Brochure {
  listing: {
    id: string;
    reference: string;
    title: string | null;
    listingType: 'sale' | 'rent';
    propertyType: string;
    completion: 'ready' | 'off_plan';
    status: string;
    emirate: string;
    community: string | null;
    subCommunity: string | null;
    building: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    areaSqft: number | null;
    price: number | null;
    rentPeriod: string | null;
    furnishing: string | null;
    parking: number | null;
    view: string | null;
    developer: string | null;
    handoverDate: string | null;
    amenities: string[];
    description: string | null;
  };
  permits: {
    authority: string;
    permitNumber: string | null;
    validUntil: string;
    verificationUrl: string | null;
  }[];
  agency: {
    name: string;
    orn: string | null;
    tradeLicenseNo: string | null;
    primaryColor: string | null;
    logo: string | null;
  };
  agent: { name: string; brn: string | null; phone: string | null } | null;
  photos: { id: string; width: number; height: number; url: string }[];
}

/** A portal link carrying campaign tags; the portal keeps them through to the enquiry. */
export function campaignLink(
  portalUrl: string,
  propertyId: string,
  tags: { source: string; medium: string; campaign: string },
): string {
  const q = new URLSearchParams();
  const clean = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100);
  if (tags.source.trim()) q.set('utm_source', clean(tags.source));
  if (tags.medium.trim()) q.set('utm_medium', clean(tags.medium));
  if (tags.campaign.trim()) q.set('utm_campaign', clean(tags.campaign));
  const s = q.toString();
  return `${portalUrl.replace(/\/$/, '')}/property/${propertyId}${s ? `?${s}` : ''}`;
}
