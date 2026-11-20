'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PropertyDetail } from '@/lib/api';
import { getSupportedEmirates } from '@/lib/env';
import { PROPERTY_TYPES, titleCase } from '@/lib/listings';

const EMIRATES = getSupportedEmirates();

/** Reads the form into the API's shape: empty fields become null, numbers become numbers. */
function readForm(form: HTMLFormElement, isNew: boolean): Record<string, unknown> {
  const f = new FormData(form);
  const text = (k: string) => {
    const v = String(f.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  const num = (k: string) => {
    const v = text(k);
    return v === null ? null : Number(v.replace(/,/g, ''));
  };
  const body: Record<string, unknown> = {
    title: text('title'),
    listingType: text('listingType'),
    propertyType: text('propertyType'),
    completion: text('completion'),
    emirate: text('emirate'),
    community: text('community'),
    building: text('building'),
    unitNo: text('unitNo'),
    bedrooms: num('bedrooms'),
    bathrooms: num('bathrooms'),
    areaSqft: num('areaSqft'),
    price: num('price'),
    furnishing: text('furnishing'),
    description: text('description'),
  };
  if (body.listingType === 'rent') body.rentPeriod = text('rentPeriod') ?? 'yearly';
  else body.rentPeriod = null;
  const reference = text('reference');
  if (isNew) {
    if (reference) body.reference = reference;
  } else if (reference) body.reference = reference;
  return body;
}

export function ListingForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: PropertyDetail;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [listingType, setListingType] = useState(initial?.listingType ?? 'sale');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await onSubmit(readForm(e.currentTarget, !initial));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else setError('Could not save the listing.');
    } finally {
      setBusy(false);
    }
  }

  const v = (k: keyof PropertyDetail) => {
    const value = initial?.[k];
    return value === null || value === undefined ? '' : String(value);
  };

  return (
    <form onSubmit={(e) => void handle(e)} className="flex flex-col gap-6" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="listingType" label="For">
          <Select
            id="listingType"
            name="listingType"
            value={listingType}
            onChange={(e) => setListingType(e.target.value as 'sale' | 'rent')}
          >
            <option value="sale">Sale</option>
            <option value="rent">Rent</option>
          </Select>
        </Field>
        <Field id="propertyType" label="Property type" error={fieldErrors.propertyType}>
          <Select
            id="propertyType"
            name="propertyType"
            defaultValue={v('propertyType') || 'apartment'}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="completion" label="Completion">
          <Select id="completion" name="completion" defaultValue={v('completion') || 'ready'}>
            <option value="ready">Ready</option>
            <option value="off_plan">Off-plan</option>
          </Select>
        </Field>
      </div>

      <Field id="title" label="Title (optional)" error={fieldErrors.title}>
        <Input
          id="title"
          name="title"
          defaultValue={v('title')}
          placeholder="Sea-view 2 bed in Marina Gate"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="emirate" label="Emirate" error={fieldErrors.emirate}>
          <Select id="emirate" name="emirate" defaultValue={v('emirate') || EMIRATES[0]}>
            {EMIRATES.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        </Field>
        <Field id="community" label="Community" error={fieldErrors.community}>
          <Input
            id="community"
            name="community"
            defaultValue={v('community')}
            placeholder="Dubai Marina"
          />
        </Field>
        <Field id="building" label="Building" error={fieldErrors.building}>
          <Input id="building" name="building" defaultValue={v('building')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field id="bedrooms" label="Bedrooms" hint="0 = studio" error={fieldErrors.bedrooms}>
          <Input
            id="bedrooms"
            name="bedrooms"
            type="number"
            min={0}
            max={50}
            defaultValue={v('bedrooms')}
          />
        </Field>
        <Field id="bathrooms" label="Bathrooms" error={fieldErrors.bathrooms}>
          <Input
            id="bathrooms"
            name="bathrooms"
            type="number"
            min={0}
            max={50}
            defaultValue={v('bathrooms')}
          />
        </Field>
        <Field id="areaSqft" label="Area (sq ft)" error={fieldErrors.areaSqft}>
          <Input id="areaSqft" name="areaSqft" inputMode="decimal" defaultValue={v('areaSqft')} />
        </Field>
        <Field id="unitNo" label="Unit no." error={fieldErrors.unitNo}>
          <Input id="unitNo" name="unitNo" defaultValue={v('unitNo')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="price" label="Price (AED)" error={fieldErrors.price}>
          <Input id="price" name="price" inputMode="numeric" defaultValue={v('price')} />
        </Field>
        {listingType === 'rent' ? (
          <Field id="rentPeriod" label="Rent per">
            <Select id="rentPeriod" name="rentPeriod" defaultValue={v('rentPeriod') || 'yearly'}>
              <option value="yearly">Year</option>
              <option value="monthly">Month</option>
            </Select>
          </Field>
        ) : null}
        <Field id="furnishing" label="Furnishing">
          <Select id="furnishing" name="furnishing" defaultValue={v('furnishing')}>
            <option value="">Not set</option>
            <option value="unfurnished">Unfurnished</option>
            <option value="semi_furnished">Semi-furnished</option>
            <option value="furnished">Furnished</option>
          </Select>
        </Field>
      </div>

      <Field id="description" label="Description" error={fieldErrors.description}>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={v('description')}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
        />
      </Field>

      <Field
        id="reference"
        label="Reference (optional)"
        hint="Leave empty and we generate one, like PF-7KQ2MX."
        error={fieldErrors.reference}
      >
        <Input id="reference" name="reference" defaultValue={v('reference')} />
      </Field>

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
