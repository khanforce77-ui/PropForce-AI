'use client';

import { Flag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { captchaEnabled, Turnstile } from './turnstile';

const REASONS: [string, string][] = [
  ['not_available', 'Property is no longer available'],
  ['wrong_price', 'Price is wrong'],
  ['wrong_details', 'Details or location are wrong'],
  ['wrong_photos', 'Photos are not of this property'],
  ['fraud', 'Looks like a scam or fake listing'],
  ['other', 'Something else'],
];

/** "Report this listing": goes to the agency and PropForce for review. */
export function ReportListing({ listingId }: { listingId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (captchaEnabled && !captcha) {
      setError('Please confirm you are not a robot.');
      return;
    }
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`/api/reports/${listingId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: form.get('reason'),
          details: form.get('details') || undefined,
          email: form.get('email') || '',
          website: form.get('website') || '',
          ...(captcha ? { captchaToken: captcha } : {}),
        }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? 'Could not send your report. Please try again.');
    } catch {
      setError('Could not send your report. Please try again.');
    }
    setState('idle');
    setCaptchaReset((n) => n + 1);
  }

  if (state === 'sent') {
    return (
      <p className="rounded-xl bg-accent p-3 text-sm" role="status">
        Thank you. We will review this listing.
      </p>
    );
  }
  const input =
    'w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-2 focus:outline-primary';
  return (
    <details className="rounded-xl border border-border p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground">
        <Flag className="h-4 w-4" aria-hidden /> Report this listing
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <fieldset className="space-y-1">
          <legend className="font-medium">What is wrong?</legend>
          {REASONS.map(([value, label], i) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="reason" value={value} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="report-details" className="font-medium">
            Details <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="report-details"
            name="details"
            maxLength={1000}
            rows={3}
            className={`${input} py-2`}
          />
        </div>
        <div>
          <label htmlFor="report-email" className="font-medium">
            Your email{' '}
            <span className="font-normal text-muted-foreground">
              (optional, if we may follow up)
            </span>
          </label>
          <input
            id="report-email"
            name="email"
            type="email"
            autoComplete="email"
            className={`${input} h-10`}
          />
        </div>
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="report-website">Website</label>
          <input id="report-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <Turnstile onToken={setCaptcha} resetSignal={captchaReset} />
        {error ? (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={state === 'sending'}
          className="h-10 rounded-lg border border-border px-4 font-medium hover:border-primary disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
      </form>
    </details>
  );
}
