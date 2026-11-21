'use client';

import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/images';

interface Photo {
  id: string;
  position: number;
  width: number;
  height: number;
  version: number;
  thumbUrl: string;
}

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError || err instanceof Error ? err.message : fallback;

/** Upload, order and remove a listing's photos. What the portal shows carries the watermark. */
export function ListingPhotos({
  agencyId,
  propertyId,
  canEdit,
}: {
  agencyId: string;
  propertyId: string;
  canEdit: boolean;
}) {
  const { request } = useAuth();
  const inputId = useId();
  const path = `/properties/${propertyId}/photos`;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [max, setMax] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await request<{ data: Photo[]; max: number }>(path, { tenantId: agencyId });
      setPhotos(res.data);
      setMax(res.max);
    } catch (err) {
      setErrors([message(err, 'Could not load the photos.')]);
    }
  }, [agencyId, path, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, max - photos.length));
    e.target.value = '';
    if (files.length === 0) return;
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      try {
        const body = await prepareForUpload(file);
        await request(path, { tenantId: agencyId, method: 'POST', body });
      } catch (err) {
        failed.push(`${file.name}: ${message(err, 'could not be uploaded.')}`);
      }
    }
    setErrors(failed);
    setBusy(null);
    await load();
  }

  async function move(index: number, by: -1 | 1) {
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setPhotos(next);
    setBusy('Saving order…');
    try {
      await request(`${path}/order`, {
        tenantId: agencyId,
        method: 'PUT',
        body: { ids: next.map((p) => p.id) },
      });
      setErrors([]);
    } catch (err) {
      setErrors([message(err, 'Could not save the order.')]);
    }
    setBusy(null);
    await load();
  }

  async function remove(id: string) {
    setBusy('Removing…');
    try {
      await request(`${path}/${id}`, { tenantId: agencyId, method: 'DELETE' });
      setErrors([]);
    } catch (err) {
      setErrors([message(err, 'Could not remove the photo.')]);
    }
    setBusy(null);
    await load();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Photos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {photos.length} of {max}. The first photo is the cover. On the portal every photo
            carries your agency logo as a faint watermark; the clean originals stay private to your
            agency, with location data removed.
          </p>
        </div>
        {canEdit && photos.length < max ? (
          <>
            <label
              htmlFor={inputId}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <ImagePlus className="h-4 w-4" aria-hidden /> Add photos
            </label>
            <input
              id={inputId}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              onChange={(e) => void onFiles(e)}
              disabled={busy !== null}
            />
          </>
        ) : null}
      </div>

      {busy ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {busy}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-600" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {photos.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No photos yet. JPEG, PNG, WebP or HEIC, at least 400 pixels on each side.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-border">
              <div className="relative aspect-[4/3] bg-muted">
                <img
                  src={p.thumbUrl}
                  alt={`Photo ${i + 1}${i === 0 ? ' (cover)' : ''}`}
                  className="h-full w-full object-cover"
                />
                {i === 0 ? (
                  <span className="absolute top-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium">
                    Cover
                  </span>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex items-center justify-between px-1 py-1">
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move photo ${i + 1} earlier`}
                      disabled={i === 0 || busy !== null}
                      onClick={() => void move(i, -1)}
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move photo ${i + 1} later`}
                      disabled={i === photos.length - 1 || busy !== null}
                      onClick={() => void move(i, 1)}
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove photo ${i + 1}`}
                    disabled={busy !== null}
                    onClick={() => void remove(p.id)}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
