import {
  withTenant,
  type ConsentChannel,
  type ConsentPurpose,
  type LeadStage,
  type Prisma,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';

const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'viewing', 'negotiating'];

/**
 * Turns a stored portal enquiry into a CRM lead for the listing's agent, as a system action:
 * reuses the agency's contact with the same phone (or creates one), records the consent the
 * visitor gave on the form with the enquiry as evidence, and opens a lead for the listing (or
 * adds a note to the contact's open lead for that listing). Runs in the agency's own tenant
 * transaction, so it cannot touch any other agency.
 */
export async function convertEnquiryToLead(
  prisma: PrismaClient,
  tenantId: string,
  enquiryId: string,
): Promise<string> {
  return withTenant(prisma, { tenantId }, async (tx) => {
    const enquiry = await tx.portalEnquiry.findUniqueOrThrow({
      where: { id: enquiryId },
      include: {
        property: {
          select: {
            id: true,
            reference: true,
            listingType: true,
            propertyType: true,
            emirate: true,
            community: true,
            bedrooms: true,
          },
        },
        agent: { select: { id: true, userId: true, status: true } },
      },
    });
    if (enquiry.leadId) return enquiry.leadId;
    const agentUserId = enquiry.agent.userId;
    const ownerMembershipId = enquiry.agent.status === 'active' ? enquiry.agent.id : null;

    let contact = await tx.contact.findFirst({
      where: { tenantId, phoneE164: enquiry.phoneE164 },
      select: { id: true, email: true },
    });
    if (!contact) {
      contact = await tx.contact.create({
        data: {
          tenantId,
          fullName: enquiry.fullName,
          phoneE164: enquiry.phoneE164,
          email: enquiry.email,
          source: 'portal',
          ownerMembershipId,
          createdBy: agentUserId,
        },
        select: { id: true, email: true },
      });
      await systemAudit(tx, tenantId, 'contact.created', 'contact', contact.id, {
        source: 'portal',
      });
    } else if (!contact.email && enquiry.email) {
      await tx.contact.update({ where: { id: contact.id }, data: { email: enquiry.email } });
    }

    // Consent exactly as given on the form: replies about this enquiry, plus offers if ticked.
    const channels: ConsentChannel[] = [
      'whatsapp',
      'phone_call',
      ...(enquiry.email ? (['email'] as const) : []),
    ];
    const purposes: ConsentPurpose[] = [
      'service',
      ...(enquiry.consentMarketing ? (['marketing'] as const) : []),
    ];
    await tx.consentRecord.createMany({
      data: channels.flatMap((channel) =>
        purposes.map((purpose) => ({
          tenantId,
          contactId: contact.id,
          channel,
          purpose,
          status: 'granted' as const,
          method: 'portal enquiry form',
          evidence: `portal_enquiry:${enquiry.id}`,
          createdAt: enquiry.consentAt,
        })),
      ),
    });

    const p = enquiry.property;
    const note = `Portal enquiry about ${p.reference}: ${enquiry.message}`;
    const open = await tx.lead.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        propertyId: p.id,
        stage: { in: OPEN_STAGES },
      },
      select: { id: true },
    });
    let leadId: string;
    if (open) {
      leadId = open.id;
    } else {
      const lead = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          intent: p.listingType === 'rent' ? 'rent' : 'buy',
          source: 'portal',
          propertyId: p.id,
          assignedMembershipId: ownerMembershipId,
          emirate: p.emirate,
          communities: p.community ? [p.community] : [],
          propertyTypes: [p.propertyType],
          ...(p.bedrooms != null ? { bedroomsMin: p.bedrooms, bedroomsMax: p.bedrooms } : {}),
          createdBy: agentUserId,
        },
        select: { id: true },
      });
      leadId = lead.id;
      await tx.leadActivity.create({
        data: { tenantId, leadId, type: 'created', toValue: 'new' },
      });
      await systemAudit(tx, tenantId, 'lead.created', 'lead', leadId, {
        source: 'portal',
        assignedMembershipId: ownerMembershipId,
      });
    }
    await tx.leadActivity.create({ data: { tenantId, leadId, type: 'note', body: note } });
    await tx.portalEnquiry.update({ where: { id: enquiry.id }, data: { leadId } });
    return leadId;
  });
}

function systemAudit(
  tx: TransactionClient,
  tenantId: string,
  action: string,
  entityType: string,
  entityId: string,
  after: Prisma.InputJsonValue,
) {
  return tx.auditLog.create({
    data: { tenantId, actorType: 'system', action, entityType, entityId, after },
  });
}
