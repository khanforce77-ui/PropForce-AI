'use client';

import { Mail, MessageCircle, Phone } from 'lucide-react';
import { useState } from 'react';

/**
 * WhatsApp and Call buttons. The agent's number is fetched only on click, through the portal's
 * server, so every contact is recorded for the agent and numbers are not left in the page for
 * scrapers. WhatsApp is a plain link to /go/:id/whatsapp, which records and redirects.
 */
export function ContactActions({
  listingId,
  canCall,
  canWhatsapp,
}: {
  listingId: string;
  canCall: boolean;
  canWhatsapp: boolean;
}) {
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contact/${listingId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'call' }),
      });
      const body = (await res.json()) as { href?: string; phone?: string; message?: string };
      if (!res.ok || !body.href) throw new Error(body.message ?? 'Could not reach the agent.');
      setPhone(body.phone ?? null);
      // On phones, start the call straight away; on desktop, show the number.
      if (window.matchMedia('(pointer: coarse)').matches) window.location.href = body.href;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the agent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {canWhatsapp ? (
          <a
            href={`/go/${listingId}/whatsapp`}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-whatsapp text-sm font-semibold text-white hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-whatsapp text-sm font-semibold text-white opacity-40"
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
          </button>
        )}
        <button
          type="button"
          onClick={call}
          disabled={!canCall || busy}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Phone className="h-4 w-4" aria-hidden /> Call
        </button>
        <a
          href="#enquiry"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-semibold hover:border-primary"
        >
          <Mail className="h-4 w-4" aria-hidden /> Email
        </a>
      </div>
      {phone ? (
        <p className="rounded-lg bg-accent p-3 text-center text-sm" role="status">
          Call the agent on{' '}
          <a href={`tel:${phone}`} className="font-semibold text-primary">
            {phone}
          </a>
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {!canCall && !canWhatsapp ? (
        <p className="text-xs text-muted-foreground">Send the agent an enquiry below.</p>
      ) : null}
    </div>
  );
}
