'use client';

import {
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Megaphone,
  MousePointerClick,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/input';
import {
  ApiError,
  type BannerPlacement,
  type PlatformSite,
  type PortalContent,
  type SiteBanner,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/images';
import { cn } from '@/lib/utils';

export const PLACEMENTS: { value: BannerPlacement; label: string; hint: string }[] = [
  {
    value: 'home_hero',
    label: 'Home page slider',
    hint: 'Big image behind the search box. Best 2400 × 900.',
  },
  {
    value: 'home_strip',
    label: 'Home page promo cards',
    hint: 'Cards under the search. Best 1200 × 600.',
  },
  {
    value: 'search_top',
    label: 'Top of search results',
    hint: 'Wide strip above the listings. Best 2000 × 400.',
  },
  {
    value: 'listing_sidebar',
    label: 'Property page sidebar',
    hint: 'Next to the agent box. Best 800 × 800.',
  },
];
const placementLabel = (p: BannerPlacement) => PLACEMENTS.find((x) => x.value === p)?.label ?? p;

/** datetime-local value in the browser's zone <-> ISO string. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0 sm:grid-cols-2">
      <legend className="sr-only">{title}</legend>
      <div className="sm:col-span-2">
        <h4 className="font-medium">{title}</h4>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="h-5 w-5 accent-[var(--color-primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Drops empty optional strings so the API sees them as "not set". */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => !(typeof v === 'string' && v.trim() === '')),
  ) as T;
}

function ContentForm({
  initial,
  onSaved,
}: {
  initial: PortalContent;
  onSaved: (msg: string) => void;
}) {
  const { request } = useAuth();
  const [c, setC] = useState<PortalContent>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setC(initial), [initial]);

  const set = <K extends keyof PortalContent>(k: K, v: PortalContent[K]) =>
    setC((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const body: PortalContent = {
      ...clean({ siteName: c.siteName }),
      hero: c.hero,
      announcement: clean(c.announcement),
      sections: c.sections,
      about: c.about,
      contact: clean(c.contact),
      social: clean(c.social),
      seo: clean(c.seo),
    };
    try {
      await request('/platform/site/settings/portal', { method: 'PUT', body });
      onSaved('Website content saved. The public site shows it within about a minute.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const err = (path: string) => errors[path];

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {error ? <Alert>{error}</Alert> : null}
      <Section title="Home page" description="The big heading visitors see first.">
        <Field id="wc-hero-title" label="Heading" error={err('hero.title')}>
          <Input
            id="wc-hero-title"
            value={c.hero.title}
            maxLength={90}
            required
            onChange={(e) => set('hero', { ...c.hero, title: e.target.value })}
          />
        </Field>
        <Field id="wc-site-name" label="Website name (optional)" error={err('siteName')}>
          <Input
            id="wc-site-name"
            value={c.siteName ?? ''}
            maxLength={60}
            placeholder="PropForce"
            onChange={(e) => set('siteName', e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="wc-hero-sub" label="Sub-heading" error={err('hero.subtitle')}>
            <textarea
              id="wc-hero-sub"
              rows={2}
              maxLength={240}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={c.hero.subtitle}
              onChange={(e) => set('hero', { ...c.hero, subtitle: e.target.value })}
            />
          </Field>
        </div>
        <Toggle
          id="wc-sec-pop"
          label="Show “Popular communities”"
          checked={c.sections.popularCommunities}
          onChange={(v) => set('sections', { ...c.sections, popularCommunities: v })}
        />
        <Toggle
          id="wc-sec-latest"
          label="Show “Latest properties”"
          checked={c.sections.latestListings}
          onChange={(v) => set('sections', { ...c.sections, latestListings: v })}
        />
      </Section>

      <Section
        title="Announcement bar"
        description="A thin strip at the very top of every page, for launches and offers."
      >
        <div className="sm:col-span-2">
          <Toggle
            id="wc-ann-on"
            label="Show the announcement bar"
            checked={c.announcement.enabled}
            onChange={(v) => set('announcement', { ...c.announcement, enabled: v })}
          />
        </div>
        <div className="sm:col-span-2">
          <Field id="wc-ann-text" label="Text" error={err('announcement.text')}>
            <Input
              id="wc-ann-text"
              value={c.announcement.text}
              maxLength={160}
              onChange={(e) => set('announcement', { ...c.announcement, text: e.target.value })}
            />
          </Field>
        </div>
        <Field
          id="wc-ann-link"
          label="Link (optional)"
          hint="https://… or a page like /new-projects"
          error={err('announcement.linkUrl')}
        >
          <Input
            id="wc-ann-link"
            value={c.announcement.linkUrl ?? ''}
            maxLength={500}
            onChange={(e) => set('announcement', { ...c.announcement, linkUrl: e.target.value })}
          />
        </Field>
        <Field id="wc-ann-label" label="Link text" error={err('announcement.linkLabel')}>
          <Input
            id="wc-ann-label"
            value={c.announcement.linkLabel ?? ''}
            maxLength={30}
            placeholder="Learn more"
            onChange={(e) => set('announcement', { ...c.announcement, linkLabel: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="Footer and contact" description="Shown in the footer of every page.">
        <div className="sm:col-span-2">
          <Field id="wc-about" label="About text" error={err('about')}>
            <textarea
              id="wc-about"
              rows={3}
              maxLength={600}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={c.about}
              onChange={(e) => set('about', e.target.value)}
            />
          </Field>
        </div>
        <Field id="wc-email" label="Email" error={err('contact.email')}>
          <Input
            id="wc-email"
            type="email"
            value={c.contact.email ?? ''}
            onChange={(e) => set('contact', { ...c.contact, email: e.target.value })}
          />
        </Field>
        <Field id="wc-phone" label="Phone" hint="+971…" error={err('contact.phone')}>
          <Input
            id="wc-phone"
            value={c.contact.phone ?? ''}
            onChange={(e) => set('contact', { ...c.contact, phone: e.target.value })}
          />
        </Field>
        <Field id="wc-wa" label="WhatsApp" hint="+971…" error={err('contact.whatsapp')}>
          <Input
            id="wc-wa"
            value={c.contact.whatsapp ?? ''}
            onChange={(e) => set('contact', { ...c.contact, whatsapp: e.target.value })}
          />
        </Field>
        <Field id="wc-addr" label="Office address" error={err('contact.address')}>
          <Input
            id="wc-addr"
            value={c.contact.address ?? ''}
            maxLength={200}
            onChange={(e) => set('contact', { ...c.contact, address: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="Social media" description="Full https:// links. Empty ones are hidden.">
        {(['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok'] as const).map((k) => (
          <Field
            key={k}
            id={`wc-so-${k}`}
            label={k === 'x' ? 'X (Twitter)' : k.charAt(0).toUpperCase() + k.slice(1)}
            error={err(`social.${k}`)}
          >
            <Input
              id={`wc-so-${k}`}
              value={c.social[k] ?? ''}
              placeholder="https://"
              onChange={(e) => set('social', { ...c.social, [k]: e.target.value })}
            />
          </Field>
        ))}
      </Section>

      <Section title="Search engines (SEO)" description="Title and description Google shows.">
        <Field id="wc-seo-title" label="Title" error={err('seo.title')}>
          <Input
            id="wc-seo-title"
            value={c.seo.title ?? ''}
            maxLength={70}
            onChange={(e) => set('seo', { ...c.seo, title: e.target.value })}
          />
        </Field>
        <Field id="wc-seo-desc" label="Description" error={err('seo.description')}>
          <Input
            id="wc-seo-desc"
            value={c.seo.description ?? ''}
            maxLength={170}
            onChange={(e) => set('seo', { ...c.seo, description: e.target.value })}
          />
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center gap-3 rounded-b-xl border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save website content'}
        </Button>
        {process.env.NEXT_PUBLIC_PORTAL_URL ? (
          <a
            href={process.env.NEXT_PUBLIC_PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </form>
  );
}

/** Admin-only preview of a banner image (loaded with the admin's session). */
function BannerThumb({ banner }: { banner: SiteBanner }) {
  const { request } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!banner.imageSha256) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    void request<Blob>(`/platform/site/banners/${banner.id}/image`, { responseType: 'blob' })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [banner.id, banner.imageSha256, request]);
  return (
    <div className="relative aspect-[16/7] w-full overflow-hidden rounded-lg bg-gradient-to-br from-muted to-border sm:w-56 sm:shrink-0">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ImagePlus className="h-4 w-4" aria-hidden /> No image yet
          </span>
        </div>
      )}
      {banner.kind === 'ad' ? (
        <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Sponsored
        </span>
      ) : null}
    </div>
  );
}

function liveState(b: SiteBanner): { label: string; tone: string } {
  const now = Date.now();
  if (!b.imageSha256) return { label: 'Needs image', tone: 'bg-amber-100 text-amber-800' };
  if (!b.active) return { label: 'Off', tone: 'bg-muted text-muted-foreground' };
  if (b.startsAt && new Date(b.startsAt).getTime() > now)
    return { label: 'Scheduled', tone: 'bg-sky-100 text-sky-800' };
  if (b.endsAt && new Date(b.endsAt).getTime() <= now)
    return { label: 'Ended', tone: 'bg-muted text-muted-foreground' };
  return { label: 'Live', tone: 'bg-emerald-100 text-emerald-800' };
}

function BannerForm({
  banner,
  defaultPlacement,
  onDone,
  onCancel,
}: {
  banner?: SiteBanner;
  defaultPlacement: BannerPlacement;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<'banner' | 'ad'>(banner?.kind ?? 'banner');
  const [file, setFile] = useState<File | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = {
      placement: s('placement'),
      kind,
      title: s('title'),
      subtitle: s('subtitle') || null,
      ctaLabel: s('ctaLabel') || null,
      linkUrl: s('linkUrl') || null,
      advertiser: kind === 'ad' ? s('advertiser') || null : null,
      sortOrder: Number(s('sortOrder') || 0),
      startsAt: fromLocalInput(s('startsAt')),
      endsAt: fromLocalInput(s('endsAt')),
    };
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const saved = banner
        ? await request<SiteBanner>(`/platform/site/banners/${banner.id}`, {
            method: 'PATCH',
            body,
          })
        : await request<SiteBanner>('/platform/site/banners', { method: 'POST', body });
      if (file) {
        await request(`/platform/site/banners/${saved.id}/image`, {
          method: 'PUT',
          body: await prepareForUpload(file),
        });
      }
      onDone(
        banner
          ? `“${body.title}” saved.`
          : `“${body.title}” added. Switch it on when you are ready to publish it.`,
      );
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  const id = banner ? `bf-${banner.id}` : 'bf-new';
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-4 rounded-xl border border-primary/30 bg-muted/40 p-4 sm:grid-cols-2"
    >
      {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
      <div className="flex gap-2 sm:col-span-2" role="radiogroup" aria-label="Type">
        {(
          [
            ['banner', 'Our own banner'],
            ['ad', 'Paid advert (shows “Sponsored”)'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={kind === v}
            onClick={() => setKind(v)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              kind === v
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Field id={`${id}-pl`} label="Where it shows">
        <Select
          id={`${id}-pl`}
          name="placement"
          defaultValue={banner?.placement ?? defaultPlacement}
        >
          {PLACEMENTS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-title`} label="Title" error={errors.title}>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={120}
          defaultValue={banner?.title ?? ''}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field id={`${id}-sub`} label="Sub-title (optional)" error={errors.subtitle}>
          <Input
            id={`${id}-sub`}
            name="subtitle"
            maxLength={240}
            defaultValue={banner?.subtitle ?? ''}
          />
        </Field>
      </div>
      <Field
        id={`${id}-link`}
        label="Link (optional)"
        hint="https://… or a page like /for-sale"
        error={errors.linkUrl}
      >
        <Input
          id={`${id}-link`}
          name="linkUrl"
          maxLength={500}
          defaultValue={banner?.linkUrl ?? ''}
        />
      </Field>
      <Field id={`${id}-cta`} label="Button text (optional)" error={errors.ctaLabel}>
        <Input
          id={`${id}-cta`}
          name="ctaLabel"
          maxLength={30}
          placeholder="View offer"
          defaultValue={banner?.ctaLabel ?? ''}
        />
      </Field>
      {kind === 'ad' ? (
        <Field id={`${id}-adv`} label="Advertiser" error={errors.advertiser}>
          <Input
            id={`${id}-adv`}
            name="advertiser"
            maxLength={80}
            placeholder="e.g. Emaar"
            defaultValue={banner?.advertiser ?? ''}
          />
        </Field>
      ) : null}
      <Field
        id={`${id}-order`}
        label="Order"
        hint="Lower numbers show first"
        error={errors.sortOrder}
      >
        <Input
          id={`${id}-order`}
          name="sortOrder"
          type="number"
          min={0}
          max={999}
          defaultValue={banner?.sortOrder ?? 0}
        />
      </Field>
      <Field id={`${id}-start`} label="Start showing (optional)" error={errors.startsAt}>
        <Input
          id={`${id}-start`}
          name="startsAt"
          type="datetime-local"
          defaultValue={toLocalInput(banner?.startsAt ?? null)}
        />
      </Field>
      <Field id={`${id}-end`} label="Stop showing (optional)" error={errors.endsAt}>
        <Input
          id={`${id}-end`}
          name="endsAt"
          type="datetime-local"
          defaultValue={toLocalInput(banner?.endsAt ?? null)}
        />
      </Field>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-img`}>
          {banner?.imageSha256 ? 'Replace image (optional)' : 'Image'}
        </Label>
        <input
          id={`${id}-img`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP or HEIC, at least 600 px wide. Location data is removed.
        </p>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : banner ? 'Save changes' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function BannersManager({
  banners,
  reload,
  notify,
  fail,
}: {
  banners: SiteBanner[];
  reload: () => Promise<void>;
  notify: (m: string) => void;
  fail: (m: string) => void;
}) {
  const { request } = useAuth();
  const [editing, setEditing] = useState<string | null>(null); // banner id or "new"
  const [filter, setFilter] = useState<BannerPlacement | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const shown = filter === 'all' ? banners : banners.filter((b) => b.placement === filter);
  const live = banners.filter((b) => liveState(b).label === 'Live').length;
  const clicks = banners.reduce((n, b) => n + b.clicks, 0);

  const done = async (msg: string) => {
    setEditing(null);
    notify(msg);
    await reload();
  };

  const toggle = async (b: SiteBanner) => {
    try {
      await request(`/platform/site/banners/${b.id}`, {
        method: 'PATCH',
        body: { active: !b.active },
      });
      await done(b.active ? `“${b.title}” switched off.` : `“${b.title}” is on.`);
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Could not change it.');
    }
  };

  const remove = async (b: SiteBanner) => {
    try {
      await request(`/platform/site/banners/${b.id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      await done(`“${b.title}” deleted.`);
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Could not delete it.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Banners & ads', banners.length],
          ['Live now', live],
          ['Total clicks', clicks],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{n}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by placement">
          {[{ value: 'all' as const, label: 'All' }, ...PLACEMENTS].map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={filter === p.value}
              onClick={() => setFilter(p.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                filter === p.value
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border hover:bg-muted',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button className="ml-auto" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden /> Add banner or ad
        </Button>
      </div>
      {filter !== 'all' ? (
        <p className="text-xs text-muted-foreground">
          {PLACEMENTS.find((p) => p.value === filter)?.hint}
        </p>
      ) : null}

      {editing === 'new' ? (
        <BannerForm
          defaultPlacement={filter === 'all' ? 'home_hero' : filter}
          onDone={(m) => void done(m)}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {shown.length === 0 && editing !== 'new' ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">No banners here yet</p>
          <p className="text-sm text-muted-foreground">
            Add a banner for your own offers, or an advert for a developer or partner.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {shown.map((b) => {
          const state = liveState(b);
          return (
            <li key={b.id} className="rounded-xl border border-border p-3">
              {editing === b.id ? (
                <BannerForm
                  banner={b}
                  defaultPlacement={b.placement}
                  onDone={(m) => void done(m)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <BannerThumb banner={b} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn('rounded-full px-2 py-0.5 text-xs font-medium', state.tone)}
                      >
                        {state.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {placementLabel(b.placement)} · order {b.sortOrder}
                      </span>
                    </div>
                    <p className="truncate font-medium">{b.title}</p>
                    {b.subtitle ? (
                      <p className="truncate text-sm text-muted-foreground">{b.subtitle}</p>
                    ) : null}
                    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      {b.kind === 'ad' && b.advertiser ? (
                        <span>Advertiser: {b.advertiser}</span>
                      ) : null}
                      {b.linkUrl ? <span className="truncate">→ {b.linkUrl}</span> : null}
                      <span className="inline-flex items-center gap-1">
                        <MousePointerClick className="h-3 w-3" aria-hidden /> {b.clicks} clicks
                      </span>
                      {b.startsAt || b.endsAt ? (
                        <span>
                          {b.startsAt ? new Date(b.startsAt).toLocaleString('en-AE') : 'now'} –{' '}
                          {b.endsAt ? new Date(b.endsAt).toLocaleString('en-AE') : 'no end'}
                        </span>
                      ) : null}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        variant={b.active ? 'outline' : 'default'}
                        disabled={!b.imageSha256}
                        onClick={() => void toggle(b)}
                      >
                        {b.active ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" aria-hidden /> Switch off
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" aria-hidden /> Switch on
                          </>
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(b.id)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                      </Button>
                      {confirmDelete === b.id ? (
                        <>
                          <Button size="sm" variant="destructive" onClick={() => void remove(b)}>
                            Confirm delete
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(b.id)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The "Website" admin tab: public website text, banners and adverts. */
export function WebsiteContent({ onMfaRequired }: { onMfaRequired: () => void }) {
  const { request } = useAuth();
  const [site, setSite] = useState<PlatformSite | null>(null);
  const [view, setView] = useState<'banners' | 'content'>('banners');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSite(await request<PlatformSite>('/platform/site'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') onMfaRequired();
      else setError(err instanceof ApiError ? err.message : 'Could not load website content.');
    }
  }, [request, onMfaRequired]);

  useEffect(() => {
    void load();
  }, [load]);

  const notify = (m: string) => {
    setError(null);
    setNotice(m);
  };
  const fail = (m: string) => {
    setNotice(null);
    setError(m);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit" role="tablist">
        {(
          [
            ['banners', 'Banners & ads'],
            ['content', 'Text, contact & SEO'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm',
              view === v ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Card>
        {!site ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : view === 'banners' ? (
          <BannersManager banners={site.banners} reload={load} notify={notify} fail={fail} />
        ) : (
          <ContentForm
            initial={site.portal}
            onSaved={(m) => {
              notify(m);
              void load();
            }}
          />
        )}
      </Card>
    </div>
  );
}
