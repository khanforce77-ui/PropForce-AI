'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { INTENT_LABEL, type LeadIntent } from '@/lib/crm';
import { PROPERTY_TYPES, titleCase } from '@/lib/listings';

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Creates a lead for a contact. Budgets in AED. */
export function LeadForm({
  agencyId,
  contactId,
  onCreated,
  onCancel,
}: {
  agencyId: string;
  contactId: string;
  onCreated: (leadId: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [f, setF] = useState({
    intent: 'buy' as LeadIntent,
    emirate: 'Dubai',
    community: '',
    propertyType: '',
    bedroomsMin: '',
    bedroomsMax: '',
    budgetMin: '',
    budgetMax: '',
    followUp: '',
    note: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const lead = await request<{ id: string }>('/leads', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          contactId,
          intent: f.intent,
          emirate: f.emirate || null,
          communities: f.community.trim() ? [f.community.trim()] : [],
          propertyTypes: f.propertyType ? [f.propertyType] : [],
          bedroomsMin: num(f.bedroomsMin),
          bedroomsMax: num(f.bedroomsMax),
          budgetMin: num(f.budgetMin),
          budgetMax: num(f.budgetMax),
          // Follow-up dates are entered as UAE local time (UTC+4).
          nextFollowUpAt: f.followUp ? `${f.followUp}:00+04:00` : null,
          note: f.note.trim() || null,
        },
      });
      onCreated(lead.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrors(err.fieldErrors);
      } else setError('Could not save the lead.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
      <Field id="l-intent" label="Looking to">
        <Select id="l-intent" value={f.intent} onChange={set('intent')}>
          {(Object.keys(INTENT_LABEL) as LeadIntent[]).map((i) => (
            <option key={i} value={i}>
              {INTENT_LABEL[i]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="l-emirate" label="Emirate">
        <Select id="l-emirate" value={f.emirate} onChange={set('emirate')}>
          <option value="Dubai">Dubai</option>
          <option value="Abu Dhabi">Abu Dhabi</option>
        </Select>
      </Field>
      <Field id="l-community" label="Community">
        <Input id="l-community" maxLength={120} value={f.community} onChange={set('community')} />
      </Field>
      <Field id="l-type" label="Property type">
        <Select id="l-type" value={f.propertyType} onChange={set('propertyType')}>
          <option value="">Any</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="l-bmin" label="Bedrooms from" hint="0 = studio">
        <Input
          id="l-bmin"
          type="number"
          min={0}
          max={50}
          value={f.bedroomsMin}
          onChange={set('bedroomsMin')}
        />
      </Field>
      <Field id="l-bmax" label="Bedrooms up to">
        <Input
          id="l-bmax"
          type="number"
          min={0}
          max={50}
          value={f.bedroomsMax}
          onChange={set('bedroomsMax')}
        />
      </Field>
      <Field id="l-pmin" label="Budget from (AED)" error={errors.budgetMin}>
        <Input id="l-pmin" type="number" min={0} value={f.budgetMin} onChange={set('budgetMin')} />
      </Field>
      <Field id="l-pmax" label="Budget up to (AED)">
        <Input id="l-pmax" type="number" min={0} value={f.budgetMax} onChange={set('budgetMax')} />
      </Field>
      <Field id="l-follow" label="Next follow-up">
        <Input id="l-follow" type="datetime-local" value={f.followUp} onChange={set('followUp')} />
      </Field>
      <Field id="l-note" label="Note">
        <Input id="l-note" maxLength={4000} value={f.note} onChange={set('note')} />
      </Field>
      {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          Create lead
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
