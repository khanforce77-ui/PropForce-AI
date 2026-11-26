'use client';

import { PhoneOutgoing, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  notReadyReason,
  type AiCallingStatus,
  type CallScript,
  type TranscriptPolicy,
} from '@/lib/voice';

const TEXTAREA =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none';

type Draft = Pick<
  CallScript,
  | 'name'
  | 'purpose'
  | 'language'
  | 'firstMessage'
  | 'instructions'
  | 'questions'
  | 'transcriptPolicy'
>;

const COMMON_RULES =
  'Speak like a friendly, experienced Dubai property consultant from {{agency_name}}. Keep every answer to one or two short sentences, then ask one question. If they ask general questions about buying, renting, off-plan, payment plans, DLD fees, mortgages or the Golden Visa, answer briefly from your Dubai knowledge and say {{agent_name}} will confirm details. Never mention a specific property price or availability on the call: offer to send matching options on WhatsApp.';

/** PropForce starter scripts. Written in English: the AI speaks the caller's language. */
const STARTERS: Draft[] = [
  {
    name: 'Enquiry follow-up',
    purpose: 'service',
    language: 'en',
    firstMessage:
      'Hi {{contact_name}}, this is the AI assistant from {{agency_name}}. You recently enquired about a property in Dubai. Is now a good time for a quick two-minute chat?',
    instructions: `You are following up on a property enquiry. ${COMMON_RULES} Confirm what they are looking for, answer their questions, and finish by booking a viewing time or a call back from {{agent_name}}.`,
    questions: [
      'Are you looking to buy, rent or invest?',
      'Which areas of Dubai do you prefer?',
      'What type of property and how many bedrooms?',
      'What is your budget?',
      'Will you pay cash or use a mortgage?',
      'When would you like to move in or buy?',
      'When is a good time for a viewing or a call from the agent?',
    ],
    transcriptPolicy: 'summary_only',
  },
  {
    name: 'Off-plan investor',
    purpose: 'service',
    language: 'en',
    firstMessage:
      'Hi {{contact_name}}, this is the AI assistant from {{agency_name}}. You showed interest in off-plan property in Dubai. Do you have a couple of minutes?',
    instructions: `You are speaking with a possible off-plan buyer or investor. ${COMMON_RULES} Explain in simple words how off-plan works in Dubai if they ask (Oqood registration, escrow, payment plans, handover). Never promise returns or price growth. Learn their goal (rental income, capital growth, Golden Visa or own use) and offer that {{agent_name}} sends matching projects with their payment plans.`,
    questions: [
      'Is this for investment, your own home, or the Golden Visa?',
      'Which areas or developers interest you?',
      'What budget range are you considering?',
      'What payment plan suits you (during construction, post-handover)?',
      'When would you like to buy?',
      'Should the agent send options on WhatsApp?',
    ],
    transcriptPolicy: 'summary_only',
  },
  {
    name: 'Rental enquiry',
    purpose: 'service',
    language: 'en',
    firstMessage:
      'Hi {{contact_name}}, this is the AI assistant from {{agency_name}}. You asked about renting a home in Dubai. Is now a good time for a few quick questions?',
    instructions: `You are helping a tenant find a rental. ${COMMON_RULES} If they ask, explain the usual costs (security deposit, agency fee, Ejari, DEWA deposit) and the number of cheques in general terms. Finish with a viewing time or a call back.`,
    questions: [
      'Which areas do you want to live in?',
      'Apartment, townhouse or villa, and how many bedrooms?',
      'What is your yearly rent budget?',
      'How many cheques would you like to pay in?',
      'Furnished or unfurnished?',
      'When do you need to move in?',
    ],
    transcriptPolicy: 'summary_only',
  },
  {
    name: 'Seller or landlord',
    purpose: 'service',
    language: 'en',
    firstMessage:
      'Hi {{contact_name}}, this is the AI assistant from {{agency_name}}. You mentioned you might sell or rent out your property in Dubai. Do you have two minutes?',
    instructions: `You are speaking with a property owner. ${COMMON_RULES} Never give a valuation yourself: say {{agent_name}} will share a price based on recent DLD transactions. Learn about the property and their plans, and book a valuation visit or call back.`,
    questions: [
      'Do you want to sell or rent out the property?',
      'Where is it and which building or community?',
      'What type of property, bedrooms and size?',
      'Is it vacant, tenanted or owner-occupied?',
      'Is there a mortgage on it?',
      'When would you like to sell or rent it?',
    ],
    transcriptPolicy: 'summary_only',
  },
];

const EXAMPLE: Draft = STARTERS[0]!;

function ScriptForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  starters,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<void>;
  onCancel?: () => void;
  starters?: Draft[];
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Send only the script fields (the initial value may be a full saved script).
      await onSubmit({
        name: d.name,
        purpose: d.purpose,
        language: d.language,
        firstMessage: d.firstMessage,
        instructions: d.instructions,
        transcriptPolicy: d.transcriptPolicy,
        questions: d.questions.map((q) => q.trim()).filter(Boolean),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
      {starters ? (
        <div className="sm:col-span-2">
          <Field
            id="s-starter"
            label="Start from a PropForce script"
            hint="Ready-made Dubai scripts. Change anything you like before saving."
          >
            <Select
              id="s-starter"
              defaultValue="0"
              onChange={(e) => {
                const s = starters[Number(e.target.value)];
                if (s) setD({ ...s, questions: [...s.questions] });
              }}
            >
              {starters.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <Field id="s-name" label="Script name">
        <Input
          id="s-name"
          required
          maxLength={80}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </Field>
      <Field id="s-purpose" label="Who it calls">
        <Select
          id="s-purpose"
          value={d.purpose}
          onChange={(e) => setD({ ...d, purpose: e.target.value as Draft['purpose'] })}
        >
          <option value="service">Leads about their enquiry (service consent)</option>
          <option value="marketing">Contacts about offers (marketing consent)</option>
        </Select>
      </Field>
      <Field
        id="s-lang"
        label="Opening language"
        hint="The AI switches to the caller's language by itself (Urdu, Hindi, Arabic, French, Russian, Chinese, Spanish and 20+ more)."
      >
        <Select
          id="s-lang"
          value={d.language}
          onChange={(e) => setD({ ...d, language: e.target.value as Draft['language'] })}
        >
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </Select>
      </Field>
      <Field id="s-keep" label="Keep after the call">
        <Select
          id="s-keep"
          value={d.transcriptPolicy}
          onChange={(e) => setD({ ...d, transcriptPolicy: e.target.value as TranscriptPolicy })}
        >
          <option value="summary_only">Summary and answers only</option>
          <option value="full_transcript">Summary, answers and full transcript</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field
          id="s-first"
          label="First message"
          hint="The first thing the AI says. It must say it is an AI assistant."
        >
          <textarea
            id="s-first"
            required
            rows={2}
            maxLength={500}
            className={TEXTAREA}
            value={d.firstMessage}
            onChange={(e) => setD({ ...d, firstMessage: e.target.value })}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field
          id="s-instr"
          label="Instructions for the AI"
          hint="Tone, what to offer, what to avoid. You can use {{contact_name}}, {{agent_name}} and {{agency_name}}."
        >
          <textarea
            id="s-instr"
            required
            rows={6}
            maxLength={8000}
            className={TEXTAREA}
            value={d.instructions}
            onChange={(e) => setD({ ...d, instructions: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className="text-sm font-medium">Questions to ask (up to 10)</span>
        {d.questions.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Question ${i + 1}`}
              maxLength={200}
              value={q}
              onChange={(e) =>
                setD({
                  ...d,
                  questions: d.questions.map((x, j) => (j === i ? e.target.value : x)),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove question ${i + 1}`}
              onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        {d.questions.length < 10 ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setD({ ...d, questions: [...d.questions, ''] })}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add question
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        PropForce always adds its calling rules after your instructions: the AI says it is an AI,
        ends the call if the person does not want calls (and records that), never invents prices or
        gives legal or visa advice, and never asks for card or ID numbers.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export default function AiCallingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role ?? '');
  const [status, setStatus] = useState<AiCallingStatus | null>(null);
  const [scripts, setScripts] = useState<CallScript[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        request<AiCallingStatus>('/ai-calling/status', { tenantId: agencyId }),
        request<{ data: CallScript[] }>('/ai-calling/scripts', { tenantId: agencyId }),
      ]);
      setStatus(s);
      setScripts(list.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load AI calling.');
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(id: string | null, body: Partial<Draft> & { active?: boolean }) {
    setError(null);
    setNotice(null);
    try {
      await request(id ? `/ai-calling/scripts/${id}` : '/ai-calling/scripts', {
        tenantId: agencyId,
        method: id ? 'PATCH' : 'POST',
        body,
      });
      setNotice('Script saved.');
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the script.');
    }
  }

  const blocked = notReadyReason(status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <PhoneOutgoing className="h-6 w-6" aria-hidden /> AI Calling
        </h1>
        <p className="text-sm text-muted-foreground">
          Write your own call scripts. Then open a contact and choose <em>Call with AI</em>: the AI
          calls them, asks your questions, and saves the summary, answers and outcome in the{' '}
          <Link href={`/app/${agencyId}/calls`} className="text-primary underline">
            call log
          </Link>
          .
        </p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {blocked ? <Alert tone="info">{blocked} You can write scripts now.</Alert> : null}
      {status ? (
        <p className="text-xs text-muted-foreground">
          Only contacts with phone call consent are called, {status.callingHours.from}:00 to{' '}
          {status.callingHours.to}:00 Dubai time, at most {status.limits.perDay} call a day and{' '}
          {status.limits.perWeek} a week per person. Contacts marked “do not contact” are never
          called.
        </p>
      ) : null}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Call scripts</h2>
          {canEdit && editing !== 'new' ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden /> New script
            </Button>
          ) : null}
        </div>
        {editing === 'new' ? (
          <ScriptForm
            initial={EXAMPLE}
            starters={STARTERS}
            submitLabel="Create script"
            onSubmit={(d) => save(null, d)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {!scripts ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : scripts.length === 0 && editing !== 'new' ? (
          <p className="text-sm text-muted-foreground">
            No scripts yet.{canEdit ? ' Start with New script: an example is filled in.' : ''}
          </p>
        ) : (
          <ul>
            {scripts.map((s) => (
              <li key={s.id} className="border-b border-border py-3 last:border-b-0">
                {editing === s.id ? (
                  <ScriptForm
                    initial={s}
                    submitLabel="Save"
                    onSubmit={(d) => save(s.id, d)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {s.name}
                        {!s.active ? (
                          <span className="ml-2 text-xs text-muted-foreground">(off)</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.purpose === 'marketing' ? 'Marketing' : 'Enquiry follow-up'} ·{' '}
                        {s.language === 'ar' ? 'Arabic' : 'English'} · {s.questions.length} question
                        {s.questions.length === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        “{s.firstMessage}”
                      </p>
                    </div>
                    {canEdit ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(s.id)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void save(s.id, { active: !s.active })}
                        >
                          {s.active ? 'Switch off' : 'Switch on'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
