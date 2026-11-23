import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/config';

export const metadata: Metadata = { title: 'Terms of service' };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-6">
      <h1 className="text-2xl font-bold">Terms of service</h1>
      <p>
        {SITE_NAME} and the PropForce AI platform are operated by Khan Force Development. By using
        this website or the PropForce AI agency app you agree to these terms.
      </p>
      <h2 className="text-lg font-semibold">Listings</h2>
      <p>
        Properties are advertised by licensed real estate agencies, which are responsible for the
        accuracy of their listings, permits and prices. We may hide or remove a listing that is
        reported, expired or missing a valid permit.
      </p>
      <h2 className="text-lg font-semibold">Agencies using PropForce AI</h2>
      <ul className="list-disc pl-5">
        <li>
          Agencies must hold the licences required in the emirate where they operate and keep their
          agent and permit details up to date.
        </li>
        <li>
          When an agency connects its own WhatsApp Business number, it remains responsible for its
          messages, follows the WhatsApp Business and Commerce policies, and contacts people only
          with their consent. Opt-outs such as STOP are honoured automatically.
        </li>
        <li>
          AI-generated replies answer only from the agency&apos;s verified listings. Agencies stay
          responsible for reviewing what is sent on their behalf.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Acceptable use</h2>
      <p>
        Do not post false listings, send spam, scrape the site, or try to access data that is not
        yours. We may suspend accounts that break these rules.
      </p>
      <h2 className="text-lg font-semibold">Privacy</h2>
      <p>
        How we handle personal data is described in our{' '}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        . You can ask us to delete your data as described on the{' '}
        <Link href="/data-deletion" className="underline">
          data deletion page
        </Link>
        .
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p className="text-muted-foreground">
        These terms are a working draft for the staging site and will be finalised with legal review
        before launch.
      </p>
    </div>
  );
}
