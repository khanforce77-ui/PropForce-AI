'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface BulkContact {
  id: string | null;
  phone: string;
  name: string;
  status: 'created' | 'existing' | 'other_agent';
}
export interface BulkResult {
  contacts: BulkContact[];
  invalid: string[];
  consentRecorded: number;
}

const TEXTAREA =
  'w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-primary focus:outline-none';

/** Lines typed or pasted in the box (Excel columns paste as tab-separated, which also works). */
export const countLines = (text: string) => text.split('\n').filter((l) => l.trim()).length;

/**
 * Paste many numbers at once ("number" or "name, number" per line). Saves them as contacts and,
 * when the agency confirms it, records that these people agreed to be contacted.
 */
export function BulkNumbersForm({
  agencyId,
  channels,
  purpose = 'service',
  consentLabel,
  submitLabel,
  extra,
  canSubmit = true,
  onAdded,
  onCancel,
}: {
  agencyId: string;
  /** Consent the tick box records. */
  channels: ('phone_call' | 'whatsapp')[];
  purpose?: 'service' | 'marketing';
  consentLabel: string;
  submitLabel: string;
  /** More fields shown above the submit button (e.g. script and time for AI calls). */
  extra?: ReactNode;
  canSubmit?: boolean;
  /** Runs after the numbers are saved; may throw to show an error. Returns a message. */
  onAdded: (r: BulkResult, consented: boolean) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const { request } = useAuth();
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [consented, setConsented] = useState(false);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lines = countLines(text);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (consented && !method.trim()) {
      setError('Say how these people agreed, e.g. "enquired on our website".');
      return;
    }
    setBusy(true);
    try {
      const r = await request<BulkResult>('/contacts/bulk', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          lines: text.split('\n').filter((l) => l.trim()),
          ...(tag.trim() ? { tag: tag.trim() } : {}),
          ...(consented ? { consent: { channels, purpose, method: method.trim() } } : {}),
        },
      });
      const created = r.contacts.filter((c) => c.status === 'created').length;
      const existing = r.contacts.filter((c) => c.status === 'existing').length;
      const other = r.contacts.filter((c) => c.status === 'other_agent').length;
      const parts = [
        `${created} new contact${created === 1 ? '' : 's'} added`,
        existing ? `${existing} already in your contacts` : null,
        other ? `${other} belong to another agent and were left alone` : null,
        r.invalid.length ? `${r.invalid.length} line(s) had no valid number` : null,
      ].filter(Boolean);
      const more = await onAdded(r, consented);
      setNotice([parts.join(', ') + '.', more].filter(Boolean).join(' '));
      if (r.invalid.length) setText(r.invalid.join('\n'));
      else setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the numbers.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <Field
        id="bulk-lines"
        label={`Numbers (${lines} of 500)`}
        hint='One per line: "0501234567" or "Sara Khan, +971 50 123 4567". You can paste a column from Excel.'
      >
        <textarea
          id="bulk-lines"
          required
          rows={8}
          className={TEXTAREA}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'0501234567\nSara Khan, +971 55 765 4321'}
        />
      </Field>
      <Field id="bulk-tag" label="Tag (optional)" hint="Helps you find this list later.">
        <Input
          id="bulk-tag"
          maxLength={40}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="e.g. JVC open house"
        />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
        />
        <span>{consentLabel}</span>
      </label>
      {consented ? (
        <Field
          id="bulk-method"
          label="How did they agree?"
          hint="Saved on every contact with your name. People who said no before, or are marked do not contact, are never changed."
        >
          <Input
            id="bulk-method"
            maxLength={120}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="e.g. enquired on Bayut and asked us to call"
          />
        </Field>
      ) : null}
      {extra}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || lines === 0 || lines > 500 || !canSubmit}>
          {busy ? 'Working…' : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
