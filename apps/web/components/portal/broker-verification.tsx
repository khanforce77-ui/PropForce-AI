'use client';

import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface VerificationState {
  verified: boolean;
  verifiedUntil: string | null;
  brn: string | null;
  request: {
    brn: string;
    brnExpiresAt: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string | null;
    submittedAt: string;
  } | null;
}

const MAX_BYTES = 700 * 1024;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });

/** Photos are shrunk to a 1600 px JPEG in the browser; PDFs go as they are (max 700 KB). */
async function toDataUrl(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES)
      throw new Error('The PDF must be under 700 KB. Upload a photo instead.');
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the file.'));
      r.readAsDataURL(file);
    });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not an image we can read.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Your browser cannot resize images.');
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.55]) {
      const out = canvas.toDataURL('image/jpeg', q);
      if (out.length * 0.75 <= MAX_BYTES) return out;
    }
    throw new Error('The photo is too large. Take a closer photo of the card.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Verified agent" badge request: the agent sends their DLD broker card (BRN) and Emirates ID.
 * PropForce checks them; the badge then shows on the portal until the card expires.
 */
export function BrokerVerification({
  agencyId,
  membershipId,
}: {
  agencyId: string;
  membershipId: string;
}) {
  const { request } = useAuth();
  const path = `/portal/agents/${membershipId}/verification`;
  const [state, setState] = useState<VerificationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await request<VerificationState>(path, { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your verification.');
    }
  }, [agencyId, path, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const card = f.get('card');
    const eid = f.get('emiratesId');
    if (!(card instanceof File) || card.size === 0 || !(eid instanceof File) || eid.size === 0) {
      setError('Add both files: the broker card and the Emirates ID.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(path, {
        tenantId: agencyId,
        body: {
          brn: String(f.get('brn') ?? '').trim(),
          brnExpiresAt: f.get('brnExpiresAt'),
          card: await toDataUrl(card),
          emiratesId: await toDataUrl(eid),
        },
      });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  if (!state) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  const req = state.request;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck
            className={`h-4 w-4 ${state.verified ? 'text-emerald-600' : 'text-muted-foreground'}`}
            aria-hidden
          />
          Verified agent badge
        </h3>
        {state.verified && state.verifiedUntil ? (
          <span className="text-xs text-emerald-700">
            Verified · BRN {state.brn} · until {date(state.verifiedUntil)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Send your DLD broker card and Emirates ID. PropForce checks them and shows a “Verified
        agent” badge on your listings until the card expires. The Emirates ID copy is deleted once
        it is checked.
      </p>
      {req?.status === 'pending' ? (
        <p className="mt-2 text-sm">
          Sent on {date(req.submittedAt)} (BRN {req.brn}). PropForce is checking it.
        </p>
      ) : null}
      {req?.status === 'rejected' ? (
        <p className="mt-2 text-sm text-red-600">
          Not approved{req.reason ? `: ${req.reason}` : '.'} You can send it again.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="brn" label="BRN (from the broker card)">
            <Input id="brn" name="brn" defaultValue={state.brn ?? ''} required />
          </Field>
          <Field id="brnExpiresAt" label="Card expiry date">
            <Input id="brnExpiresAt" name="brnExpiresAt" type="date" required />
          </Field>
          <Field id="card" label="Broker card (photo or PDF)">
            <Input
              id="card"
              name="card"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              required
            />
          </Field>
          <Field id="emiratesId" label="Emirates ID (photo or PDF)">
            <Input
              id="emiratesId"
              name="emiratesId"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              required
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Sending…' : 'Send for verification'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : req?.status !== 'pending' ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => setOpen(true)}>
          {state.verified ? 'Send renewed card' : 'Get verified'}
        </Button>
      ) : null}
    </div>
  );
}
