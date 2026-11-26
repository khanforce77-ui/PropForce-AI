'use client';

import { BellRing, LifeBuoy, PackagePlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PlatformSettingsDoc, type PlatformSite } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LucideIcon } from 'lucide-react';

function Block({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0 md:grid-cols-[16rem_1fr]">
      <div className="flex gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const toLimit = (v: string) => (v.trim() === '' ? null : Number(v));

/** Support details, defaults for new agencies and the notice shown inside every agency's app. */
export function PlatformSettingsCard({ onMfaRequired }: { onMfaRequired: () => void }) {
  const { request } = useAuth();
  const [s, setS] = useState<PlatformSettingsDoc | null>(null);
  const [seats, setSeats] = useState('');
  const [listings, setListings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const site = await request<PlatformSite>('/platform/site');
      setS(site.platform);
      setSeats(site.platform.newAgencyDefaults.seatLimit?.toString() ?? '');
      setListings(site.platform.newAgencyDefaults.listingLimit?.toString() ?? '');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') onMfaRequired();
      else setError(err instanceof ApiError ? err.message : 'Could not load settings.');
    }
  }, [request, onMfaRequired]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!s) {
    return (
      <Card>
        {error ? <Alert>{error}</Alert> : <p className="text-sm text-muted-foreground">Loading…</p>}
      </Card>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    setNotice(null);
    const body: PlatformSettingsDoc = {
      ...(s.supportEmail?.trim() ? { supportEmail: s.supportEmail.trim() } : {}),
      ...(s.supportPhone?.trim() ? { supportPhone: s.supportPhone.trim() } : {}),
      newAgencyDefaults: {
        plan: s.newAgencyDefaults.plan.trim() || 'trial',
        seatLimit: toLimit(seats),
        listingLimit: toLimit(listings),
      },
      appNotice: s.appNotice,
    };
    try {
      await request('/platform/site/settings/platform', { method: 'PUT', body });
      setNotice('Platform settings saved.');
      await load();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        <Block
          icon={BellRing}
          title="Notice to all agencies"
          description="A bar at the top of every agency's app, e.g. planned maintenance or a new feature."
        >
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              role="switch"
              className="h-5 w-5 accent-[var(--color-primary)]"
              checked={s.appNotice.enabled}
              onChange={(e) =>
                setS({ ...s, appNotice: { ...s.appNotice, enabled: e.target.checked } })
              }
            />
            Show the notice
          </label>
          <div className="sm:col-span-2">
            <Field id="ps-notice" label="Message" error={errors['appNotice.text']}>
              <Input
                id="ps-notice"
                value={s.appNotice.text}
                maxLength={240}
                onChange={(e) =>
                  setS({ ...s, appNotice: { ...s.appNotice, text: e.target.value } })
                }
              />
            </Field>
          </div>
          <Field id="ps-tone" label="Colour">
            <Select
              id="ps-tone"
              value={s.appNotice.tone}
              onChange={(e) =>
                setS({
                  ...s,
                  appNotice: {
                    ...s.appNotice,
                    tone: e.target.value as PlatformSettingsDoc['appNotice']['tone'],
                  },
                })
              }
            >
              <option value="info">Blue (information)</option>
              <option value="warning">Amber (warning)</option>
              <option value="success">Green (good news)</option>
            </Select>
          </Field>
        </Block>

        <Block
          icon={PackagePlus}
          title="New agency defaults"
          description="Plan and limits every newly registered agency starts with."
        >
          <Field id="ps-plan" label="Plan" error={errors['newAgencyDefaults.plan']}>
            <Input
              id="ps-plan"
              value={s.newAgencyDefaults.plan}
              maxLength={40}
              onChange={(e) =>
                setS({ ...s, newAgencyDefaults: { ...s.newAgencyDefaults, plan: e.target.value } })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="ps-seats" label="Seat limit">
              <Input
                id="ps-seats"
                type="number"
                min={1}
                placeholder="No limit"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
            </Field>
            <Field id="ps-listings" label="Listing limit">
              <Input
                id="ps-listings"
                type="number"
                min={0}
                placeholder="No limit"
                value={listings}
                onChange={(e) => setListings(e.target.value)}
              />
            </Field>
          </div>
        </Block>

        <Block
          icon={LifeBuoy}
          title="Support contact"
          description="Where agencies reach PropForce for help."
        >
          <Field id="ps-email" label="Support email" error={errors.supportEmail}>
            <Input
              id="ps-email"
              type="email"
              value={s.supportEmail ?? ''}
              onChange={(e) => setS({ ...s, supportEmail: e.target.value })}
            />
          </Field>
          <Field id="ps-phone" label="Support phone" hint="+971…" error={errors.supportPhone}>
            <Input
              id="ps-phone"
              value={s.supportPhone ?? ''}
              onChange={(e) => setS({ ...s, supportPhone: e.target.value })}
            />
          </Field>
        </Block>

        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save platform settings'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
