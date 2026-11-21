import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, withPublicPortal, type PrismaClient, type TransactionClient } from '@propforce/db';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EmailSender } from '../email/email.sender';
import { PRISMA } from '../database/database.module';
import {
  CONSENT_CONTACT_TEXT,
  CONSENT_MARKETING_TEXT,
  type EnquiryInput,
  type PublicSearchQuery,
} from './portal.schemas';
import { convertEnquiryToLead } from './enquiry-to-lead';
import { notifyAgentOfEnquiry } from './enquiry-email';
import { whatsappLink } from './phone';
import { hitRateLimit, keyedHash } from './rate-limit';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Visitor {
  ip?: string;
  userAgent?: string;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'This listing is no longer available.');

/**
 * Only these columns ever leave the database for the public portal. Unit numbers, floor,
 * exact coordinates, internal ids of people, emails and audit fields are deliberately left out.
 */
const agentSelect = {
  id: true,
  brn: true,
  publicPhoneE164: true,
  whatsappE164: true,
  user: { select: { fullName: true } },
  photo: { select: { sha256: true } },
} as const;
const agencySelect = { name: true, slug: true, orn: true, emirate: true } as const;

const cardSelect = {
  id: true,
  reference: true,
  title: true,
  listingType: true,
  propertyType: true,
  completion: true,
  emirate: true,
  community: true,
  subCommunity: true,
  building: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  price: true,
  rentPeriod: true,
  furnishing: true,
  verifiedAt: true,
  createdAt: true,
  agency: { select: agencySelect },
  assigned: { select: agentSelect },
  permits: {
    select: { authority: true, permitNumber: true, validUntil: true },
    orderBy: { validUntil: 'desc' },
    take: 1,
  },
} as const satisfies Prisma.PropertySelect;

const detailSelect = {
  ...cardSelect,
  amenities: true,
  parking: true,
  view: true,
  developer: true,
  handoverDate: true,
  paymentPlan: true,
  serviceChargePerSqft: true,
  description: true,
  updatedAt: true,
  project: { select: { name: true } },
} as const satisfies Prisma.PropertySelect;

type CardRow = Prisma.PropertyGetPayload<{ select: typeof cardSelect }>;
type DetailRow = Prisma.PropertyGetPayload<{ select: typeof detailSelect }>;

const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function toAgent(row: CardRow) {
  const a = row.assigned;
  if (!a) return null;
  return {
    id: a.id,
    name: a.user.fullName,
    brn: a.brn,
    // The numbers themselves are only handed out through the contact endpoint, which records it.
    canCall: Boolean(a.publicPhoneE164 ?? a.whatsappE164),
    canWhatsapp: Boolean(a.whatsappE164 ?? a.publicPhoneE164),
    /** Changes whenever the photo changes; null when the agent has none. */
    photoVersion: a.photo ? a.photo.sha256.slice(0, 16) : null,
  };
}

function toCard(row: CardRow) {
  const permit = row.permits[0];
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    purpose: row.listingType,
    type: row.propertyType,
    completion: row.completion,
    emirate: row.emirate,
    community: row.community,
    subCommunity: row.subCommunity,
    building: row.building,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    areaSqft: num(row.areaSqft),
    price: num(row.price),
    rentPeriod: row.rentPeriod,
    furnishing: row.furnishing,
    verifiedAt: row.verifiedAt,
    listedAt: row.createdAt,
    permit: permit
      ? {
          authority: permit.authority,
          number: permit.permitNumber,
          validUntil: day(permit.validUntil),
        }
      : null,
    agent: toAgent(row),
    agency: row.agency,
  };
}

function toDetail(row: DetailRow) {
  return {
    ...toCard(row),
    amenities: row.amenities,
    parking: row.parking,
    view: row.view,
    developer: row.developer,
    project: row.project?.name ?? null,
    handoverDate: day(row.handoverDate),
    paymentPlan: row.paymentPlan,
    serviceChargePerSqft: num(row.serviceChargePerSqft),
    description: row.description,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PublicPortalService {
  private readonly log = new Logger(PublicPortalService.name);
  private readonly hashKey: Buffer;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly email: EmailSender,
  ) {
    // Derived, purpose-bound key; development falls back to a fixed non-secret value.
    this.hashKey = createHash('sha256')
      .update('propforce-portal-hash:')
      .update(config.dataEncryptionKey ?? Buffer.from('development-only'))
      .digest();
  }

  private run<T>(fn: (tx: TransactionClient) => Promise<T>) {
    return withPublicPortal(this.prisma, fn);
  }

  search(q: PublicSearchQuery) {
    const where: Prisma.PropertyWhereInput = {
      ...(q.purpose ? { listingType: q.purpose } : {}),
      ...(q.emirate ? { emirate: q.emirate } : {}),
      ...(q.community ? { community: { equals: q.community, mode: 'insensitive' } } : {}),
      ...(q.type ? { propertyType: q.type } : {}),
      ...(q.completion ? { completion: q.completion } : {}),
      ...(q.furnished ? { furnishing: q.furnished } : {}),
      ...(q.beds !== undefined ? { bedrooms: q.beds >= 7 ? { gte: 7 } : q.beds } : {}),
      ...(q.minPrice !== undefined || q.maxPrice !== undefined
        ? {
            price: {
              ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}),
              ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}),
            },
          }
        : {}),
      ...(q.minArea !== undefined || q.maxArea !== undefined
        ? {
            areaSqft: {
              ...(q.minArea !== undefined ? { gte: q.minArea } : {}),
              ...(q.maxArea !== undefined ? { lte: q.maxArea } : {}),
            },
          }
        : {}),
      ...(q.agency ? { agency: { slug: q.agency } } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { community: { contains: q.q, mode: 'insensitive' } },
              { subCommunity: { contains: q.q, mode: 'insensitive' } },
              { building: { contains: q.q, mode: 'insensitive' } },
              { reference: { equals: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
      q.sort === 'price_asc'
        ? [{ price: 'asc' }, { id: 'desc' }]
        : q.sort === 'price_desc'
          ? [{ price: 'desc' }, { id: 'desc' }]
          : [{ verifiedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    return this.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.property.findMany({
          where,
          select: cardSelect,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.property.count({ where }),
      ]);
      return { data: rows.map(toCard), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(id: string) {
    return this.run(async (tx) => {
      const row = await tx.property.findUnique({ where: { id }, select: detailSelect });
      if (!row) throw notFound();
      return toDetail(row);
    });
  }

  /** Values for the search filters, with how many live listings each has. */
  facets() {
    return this.run(async (tx) => {
      const [communities, types] = await Promise.all([
        tx.property.groupBy({
          by: ['emirate', 'community'],
          _count: { _all: true },
          orderBy: [{ emirate: 'asc' }, { community: 'asc' }],
        }),
        tx.property.groupBy({ by: ['propertyType'], _count: { _all: true } }),
      ]);
      return {
        emirates: this.config.supportedEmirates,
        communities: communities
          .filter((c) => c.community)
          .map((c) => ({ emirate: c.emirate, community: c.community, count: c._count._all })),
        types: types.map((t) => ({ type: t.propertyType, count: t._count._all })),
      };
    });
  }

  /** Every live listing, for the sitemap. */
  sitemap() {
    return this.run(async (tx) => {
      const rows = await tx.property.findMany({
        select: {
          id: true,
          title: true,
          listingType: true,
          bedrooms: true,
          propertyType: true,
          emirate: true,
          community: true,
          updatedAt: true,
        },
        orderBy: { id: 'asc' },
        take: 50_000,
      });
      return { data: rows };
    });
  }

  /**
   * Records a WhatsApp or call click and returns where to send the visitor. Repeat clicks from
   * the same visitor within ten minutes are not counted again, but still get the link.
   */
  contact(id: string, channel: 'whatsapp' | 'call', visitor: Visitor) {
    return this.run(async (tx) => {
      const row = await tx.property.findUnique({
        where: { id },
        select: {
          id: true,
          tenantId: true,
          reference: true,
          title: true,
          community: true,
          assigned: { select: { id: true, publicPhoneE164: true, whatsappE164: true } },
        },
      });
      if (!row?.assigned) throw notFound();
      const { publicPhoneE164, whatsappE164 } = row.assigned;
      const number =
        channel === 'whatsapp'
          ? (whatsappE164 ?? publicPhoneE164)
          : (publicPhoneE164 ?? whatsappE164);
      if (!number) {
        throw new AppError(
          409,
          'AGENT_NOT_REACHABLE',
          'This agent has no phone number on file. Please send an enquiry instead.',
        );
      }

      const ipHash = visitor.ip ? keyedHash(this.hashKey, 'ip', visitor.ip) : null;
      const fresh = await hitRateLimit(
        tx,
        `contact:${ipHash ?? 'anon'}:${row.id}:${channel}`,
        1,
        10 * 60_000,
      );
      const underCap =
        fresh && (await hitRateLimit(tx, `contact-ip:${ipHash ?? 'anon'}`, 60, HOUR));
      if (underCap) {
        await tx.portalContactEvent.createMany({
          data: [
            {
              tenantId: row.tenantId,
              propertyId: row.id,
              membershipId: row.assigned.id,
              channel,
              ipHash,
              userAgent: visitor.userAgent?.slice(0, 300) ?? null,
            },
          ],
        });
      }

      const url = `${this.config.portal.publicUrl}/property/${row.id}`;
      const what = row.title ?? `property in ${row.community ?? 'the UAE'}`;
      const href =
        channel === 'whatsapp'
          ? whatsappLink(
              number,
              `Hi, I'm interested in "${what}" (Ref ${row.reference}) that I saw on PropForce: ${url}`,
            )
          : `tel:${number}`;
      return { channel, href, phone: number };
    });
  }

  /**
   * Stores an enquiry for the listing's agent. Bots that fill the hidden field or submit
   * instantly get the same response as people, but nothing is stored.
   */
  async enquire(id: string, input: EnquiryInput, visitor: Visitor) {
    const accepted = { status: 'received' as const };
    if (input.website || (input.elapsedMs !== undefined && input.elapsedMs < 2500)) {
      this.log.warn({ msg: 'Portal enquiry dropped as likely spam', listingId: id });
      return accepted;
    }
    if ((input.message.match(/https?:\/\//gi) ?? []).length > 2) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Please remove the links from your message.', [
        { path: 'message', message: 'Too many links' },
      ]);
    }
    const enquiryId = randomUUID();
    const tenantId = await this.run(async (tx) => {
      const row = await tx.property.findUnique({
        where: { id },
        select: { id: true, tenantId: true, assignedMembershipId: true },
      });
      if (!row?.assignedMembershipId) throw notFound();

      const ipHash = visitor.ip ? keyedHash(this.hashKey, 'ip', visitor.ip) : null;
      const phoneHash = keyedHash(this.hashKey, 'phone', input.phone);
      const limits: [string, number, number][] = [
        [`enquiry-dup:${phoneHash}:${row.id}`, 1, 10 * 60_000],
        [`enquiry-phone:${phoneHash}`, 10, DAY],
        ...(ipHash ? ([[`enquiry-ip:${ipHash}`, 8, HOUR]] as [string, number, number][]) : []),
      ];
      for (const [bucket, limit, windowMs] of limits) {
        if (!(await hitRateLimit(tx, bucket, limit, windowMs))) {
          throw new AppError(
            429,
            'RATE_LIMITED',
            bucket.startsWith('enquiry-dup')
              ? 'You already sent an enquiry about this property. The agent will be in touch soon.'
              : 'Too many enquiries. Please try again later.',
          );
        }
      }

      const now = new Date();
      await tx.portalEnquiry.createMany({
        data: [
          {
            id: enquiryId,
            tenantId: row.tenantId,
            propertyId: row.id,
            membershipId: row.assignedMembershipId,
            fullName: input.fullName,
            phoneE164: input.phone,
            email: input.email ?? null,
            message: input.message,
            consentContact: true,
            consentMarketing: input.consentMarketing,
            consentText: input.consentMarketing
              ? `${CONSENT_CONTACT_TEXT} ${CONSENT_MARKETING_TEXT}`
              : CONSENT_CONTACT_TEXT,
            consentAt: now,
            ipHash,
            userAgent: visitor.userAgent?.slice(0, 300) ?? null,
          },
        ],
      });
      return row.tenantId;
    });
    // The enquiry is safely stored; turning it into a CRM lead is a separate step in the
    // agency's own transaction. If it fails, the enquiry stays in the portal inbox (lead_id null).
    let leadId: string | null = null;
    try {
      leadId = await convertEnquiryToLead(this.prisma, tenantId, enquiryId);
    } catch (err) {
      this.log.error({ msg: 'Portal enquiry could not become a lead', enquiryId, err });
    }
    // The visitor never sees the agent's email address: the API emails the agent directly.
    try {
      await notifyAgentOfEnquiry(this.prisma, this.email, this.config, tenantId, enquiryId, leadId);
    } catch (err) {
      this.log.error({ msg: 'Portal enquiry email to agent failed', enquiryId, err });
    }
    return accepted;
  }
}
