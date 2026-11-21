'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/images';

/** The agency logo, which is the watermark on every listing photo the portal shows. */
export function AgencyLogo({ agencyId, canEdit }: { agencyId: string; canEdit: boolean }) {
  const { request } = useAuth();
  const inputId = useId();
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await request<{ logo: { dataUrl: string } | null }>('/agency/logo', {
        tenantId: agencyId,
      });
      setLogo(res.logo?.dataUrl ?? null);
    } catch {
      setLogo(null);
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (n: number, what: string) =>
    setNotice(`${what}${n > 0 ? ` ${n} photo${n === 1 ? '' : 's'} re-marked.` : ''}`);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = await prepareForUpload(file);
      const res = await request<{ rerendered: number }>('/agency/logo', {
        tenantId: agencyId,
        method: 'PUT',
        body,
      });
      done(res.rerendered, 'Logo saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await request<{ rerendered: number }>('/agency/logo', {
        tenantId: agencyId,
        method: 'DELETE',
      });
      done(res.rerendered, 'Logo removed; photos now carry the PropForce mark.');
      setLogo(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the logo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-medium">Agency logo and photo watermark</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your logo is placed faintly in the middle of every listing photo shown on the portal, so
        others cannot reuse your photos. Without a logo, the PropForce mark is used. A logo with a
        transparent background works best.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-40 items-center justify-center rounded-lg border border-border bg-muted p-2">
          {logo ? (
            <img src={logo} alt="Agency logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo yet</span>
          )}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <ImageUp className="h-4 w-4" aria-hidden /> {logo ? 'Change logo' : 'Upload logo'}
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => void onFile(e)}
              disabled={busy}
            />
            {logo ? (
              <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only owners and admins can change it.</p>
        )}
      </div>
      {busy ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Saving and re-marking photos…
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-green-700" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
