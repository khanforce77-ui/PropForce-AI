import { withTenant, type PrismaClient } from '@propforce/db';
import type { AppConfig } from '../config/env';
import type { EmailSender } from '../email/email.sender';

/** Keeps visitor text on one line in a subject and strips anything that could fold headers. */
const oneLine = (s: string, max: number) =>
  s
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Emails a portal enquiry to the listing's agent. The agent's address is read inside the
 * agency's own tenant transaction and never leaves the API; the visitor's email (if given)
 * becomes Reply-To, so the agent can answer straight from their inbox.
 */
export async function notifyAgentOfEnquiry(
  prisma: PrismaClient,
  email: EmailSender,
  config: AppConfig,
  tenantId: string,
  enquiryId: string,
  leadId: string | null,
): Promise<void> {
  const data = await withTenant(prisma, { tenantId }, async (tx) =>
    tx.portalEnquiry.findUniqueOrThrow({
      where: { id: enquiryId },
      select: {
        fullName: true,
        phoneE164: true,
        email: true,
        message: true,
        property: { select: { reference: true, title: true } },
        agent: { select: { status: true, user: { select: { email: true, fullName: true } } } },
      },
    }),
  );
  if (data.agent.status !== 'active' || !data.agent.user.email) return;

  const listing = data.property.title
    ? `${oneLine(data.property.title, 80)} (Ref ${data.property.reference})`
    : `Ref ${data.property.reference}`;
  const link = leadId
    ? `${config.webUrl}/app/${tenantId}/leads/${leadId}`
    : `${config.webUrl}/app/${tenantId}/portal`;
  const text = [
    `Hi ${data.agent.user.fullName},`,
    '',
    `You have a new enquiry from the PropForce website about ${listing}.`,
    '',
    `Name: ${oneLine(data.fullName, 120)}`,
    `Phone: ${data.phoneE164}`,
    ...(data.email ? [`Email: ${data.email}`] : []),
    '',
    'Message:',
    data.message,
    '',
    `It has been added to your CRM as a lead: ${link}`,
    ...(data.email ? ['', 'Reply to this email to answer the client directly.'] : []),
  ].join('\n');

  await email.send({
    to: data.agent.user.email,
    subject: `New enquiry: ${oneLine(data.fullName, 60)} about ${listing}`,
    text,
    ...(data.email ? { replyTo: data.email } : {}),
  });
}
