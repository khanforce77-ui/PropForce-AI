import type { ConsentChannel, ConsentPurpose, TransactionClient } from '@propforce/db';

export interface ConsentState {
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: 'granted' | 'withdrawn' | 'unknown';
  method: string | null;
  at: Date | null;
}

const CHANNELS: ConsentChannel[] = ['whatsapp', 'sms', 'email', 'phone_call'];
const PURPOSES: ConsentPurpose[] = ['service', 'marketing'];

/** Current consent per channel and purpose: the latest record wins; no record means unknown. */
export function currentConsent(
  records: {
    channel: ConsentChannel;
    purpose: ConsentPurpose;
    status: 'granted' | 'withdrawn';
    method: string;
    createdAt: Date;
  }[],
): ConsentState[] {
  return CHANNELS.flatMap((channel) =>
    PURPOSES.map((purpose) => {
      const latest = records
        .filter((r) => r.channel === channel && r.purpose === purpose)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return latest
        ? { channel, purpose, status: latest.status, method: latest.method, at: latest.createdAt }
        : { channel, purpose, status: 'unknown' as const, method: null, at: null };
    }),
  );
}

/**
 * The single check every outbound message must pass. Fails closed: a contact marked
 * "do not contact", a missing record or a withdrawal all mean no.
 * Run inside the agency's tenant transaction.
 */
export async function mayContact(
  tx: TransactionClient,
  contactId: string,
  channel: ConsentChannel,
  purpose: ConsentPurpose,
): Promise<boolean> {
  const contact = await tx.contact.findUnique({
    where: { id: contactId },
    select: { doNotContact: true },
  });
  if (!contact || contact.doNotContact) return false;
  const latest = await tx.consentRecord.findFirst({
    where: { contactId, channel, purpose },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true },
  });
  return latest?.status === 'granted';
}
