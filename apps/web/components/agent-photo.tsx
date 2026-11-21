'use client';

import { Camera, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SIZE = 256;

/** Center-crops to a square and resizes to 256x256 so uploads stay small (~10-30 KB). */
async function toSquareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not an image we can read.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Your browser cannot resize images.');
    g.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
    const webp = canvas.toDataURL('image/webp', 0.85);
    // Older Safari cannot encode WebP and silently returns PNG; JPEG is smaller then.
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** An agent's profile photo with upload and remove, shown on their public listings. */
export function AgentPhoto({
  agencyId,
  membershipId,
  name,
}: {
  agencyId: string;
  membershipId: string;
  name: string;
}) {
  const { request } = useAuth();
  const inputId = useId();
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await request<{ photo: { dataUrl: string } | null }>(
        `/portal/agents/${membershipId}/photo`,
        { tenantId: agencyId },
      );
      setPhoto(res.photo?.dataUrl ?? null);
    } catch {
      setPhoto(null);
    }
  }, [agencyId, membershipId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await toSquareImage(file);
      await request(`/portal/agents/${membershipId}/photo`, {
        tenantId: agencyId,
        method: 'PUT',
        body: { image },
      });
      setPhoto(image);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not upload the photo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await request(`/portal/agents/${membershipId}/photo`, {
        tenantId: agencyId,
        method: 'DELETE',
      });
      setPhoto(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {photo ? (
        <img
          src={photo}
          alt={`Photo of ${name}`}
          className="h-16 w-16 rounded-full border border-border object-cover"
        />
      ) : (
        <span
          aria-label={`No photo for ${name}`}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground"
        >
          {initials(name)}
        </span>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden /> {photo ? 'Change photo' : 'Upload photo'}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void onFile(e)}
            disabled={busy}
          />
          {photo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {busy
            ? 'Saving…'
            : 'A clear, professional head-and-shoulders photo. Shown on your listings.'}
        </p>
        {error ? (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
