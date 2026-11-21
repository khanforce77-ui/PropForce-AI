'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { captchaEnabled, Turnstile } from './turnstile';

type FieldErrors = Record<string, string>;

/** Must match the consent text the API stores (apps/api/src/portal/portal.schemas.ts). */
export const CONSENT_MARKETING_LABEL = 'Send me similar property offers from this agency.';
export const CONSENT_CONTACT_LABEL =
  'I agree that this agency may contact me by phone, WhatsApp or email about this enquiry, and that my details are shared with them for this purpose.';

export function EnquiryForm({
  listingId,
  defaultMessage,
}: {
  listingId: string;
  defaultMessage: string;
}) {
  const started = useRef<number>(0);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    started.current = Date.now();
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (captchaEnabled && !captcha) {
      setError('Please confirm you are not a robot.');
      return;
    }
    setState('sending');
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/enquiries/${listingId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: form.get('fullName'),
          phone: form.get('phone'),
          email: form.get('email') || undefined,
          message: form.get('message'),
          consentContact: form.get('consentContact') === 'on',
          consentMarketing: form.get('consentMarketing') === 'on',
          website: form.get('website') || '',
          elapsedMs: started.current ? Date.now() - started.current : undefined,
          ...(captcha ? { captchaToken: captcha } : {}),
        }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        errors?: { path: string; message: string }[];
      };
      setFieldErrors(Object.fromEntries((body.errors ?? []).map((x) => [x.path, x.message])));
      setError(body.message ?? 'Something went wrong. Please try again.');
      setState('idle');
      setCaptchaReset((n) => n + 1);
    } catch {
      setError('Something went wrong. Please try again.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-xl bg-accent p-4 text-sm" role="status">
        <p className="font-semibold">Enquiry sent</p>
        <p className="mt-1 text-muted-foreground">The agent will contact you shortly.</p>
      </div>
    );
  }

  const input =
    'h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-2 focus:outline-primary';
  const err = (k: string) =>
    fieldErrors[k] ? <span className="text-xs text-red-600">{fieldErrors[k]}</span> : null;

  return (
    <form id="enquiry" onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="fullName" className="text-sm font-medium">
          Name
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          className={input}
        />
        {err('fullName')}
      </div>
      <div>
        <label htmlFor="phone" className="text-sm font-medium">
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="050 123 4567"
          autoComplete="tel"
          className={input}
        />
        {err('phone')}
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">
          Email <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input id="email" name="email" type="email" autoComplete="email" className={input} />
        {err('email')}
      </div>
      <div>
        <label htmlFor="message" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          maxLength={2000}
          rows={4}
          defaultValue={defaultMessage}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm focus:outline-2 focus:outline-primary"
        />
        {err('message')}
      </div>
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="consentContact" required className="mt-0.5" />
        <span>
          {CONSENT_CONTACT_LABEL} See our{' '}
          <a href="/privacy" className="underline">
            privacy notice
          </a>
          .
        </span>
      </label>
      {err('consentContact')}
      <label className="flex gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="consentMarketing" className="mt-0.5" />
        <span>{CONSENT_MARKETING_LABEL} (optional)</span>
      </label>
      <Turnstile onToken={setCaptcha} resetSignal={captchaReset} />
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending…' : 'Send enquiry'}
      </button>
    </form>
  );
}
