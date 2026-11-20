import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/config';

export const metadata: Metadata = { title: 'Privacy notice' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-6">
      <h1 className="text-2xl font-bold">Privacy notice</h1>
      <p>
        {SITE_NAME} shows properties advertised by licensed real estate agencies. When you send an
        enquiry, or tap WhatsApp or Call on a listing, we share your request with the agency that
        published the listing and its assigned agent, so they can reply to you.
      </p>
      <h2 className="text-lg font-semibold">What we collect</h2>
      <ul className="list-disc pl-5">
        <li>
          For an enquiry: your name, phone number, optional email, your message and the consent
          choices you ticked, with the time you agreed.
        </li>
        <li>For WhatsApp or Call taps: which listing you contacted and when.</li>
        <li>
          For spam and abuse prevention: a one-way, keyed code derived from your IP address and your
          browser type. We do not store your IP address itself.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">How it is used</h2>
      <p>
        The agency uses your details only to answer your enquiry, unless you also agreed to receive
        similar offers. You can ask the agency or us to stop contacting you, or to delete your
        details, at any time.
      </p>
      <p className="text-muted-foreground">
        This notice is a working draft for the staging site and will be finalised with legal review
        before launch.
      </p>
    </div>
  );
}
