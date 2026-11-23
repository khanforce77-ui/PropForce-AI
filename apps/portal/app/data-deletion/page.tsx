import type { Metadata } from 'next';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/config';

export const metadata: Metadata = { title: 'Data deletion' };

export default function DataDeletionPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-6">
      <h1 className="text-2xl font-bold">How to delete your data</h1>
      <p>
        You can ask {SITE_NAME} and PropForce AI to delete the personal data we hold about you at
        any time. We complete requests within 30 days and confirm by email or WhatsApp.
      </p>
      <h2 className="text-lg font-semibold">If you contacted an agency</h2>
      <ul className="list-disc pl-5">
        <li>
          Reply <strong>STOP</strong> on WhatsApp to stop all further messages from that agency.
        </li>
        <li>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the phone number or
          email you used and the subject &quot;Delete my data&quot;. We delete your enquiries, chat
          history and consent records, and tell the agency to delete their copy.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">If you are an agency or agent</h2>
      <ul className="list-disc pl-5">
        <li>
          To remove PropForce&apos;s access to your WhatsApp Business account, disconnect it in the
          agency app under Settings, WhatsApp, or remove the PropForce AI app in Meta Business
          Settings. We then delete the stored access token.
        </li>
        <li>
          To close your account and delete your agency data, the agency owner emails{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the account email address.
        </li>
      </ul>
      <p className="text-muted-foreground">
        Some records may be kept longer where UAE law requires it, for example transaction records.
      </p>
    </div>
  );
}
