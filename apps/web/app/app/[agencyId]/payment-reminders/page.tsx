'use client';

import {
  BellRing,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  CHANNEL_LABEL,
  dateText,
  describeOffset,
  DISPATCH_LABEL,
  STAGE_LABEL,
  type Dispatch,
  type ReminderChannel,
  type ReminderConfig,
  type ReminderRule,
  type ReminderStage,
  type RunSummary,
  type TemplateList,
} from '@/lib/payments';
import { cn } from '@/lib/utils';

const CHANNELS: ReminderChannel[] = ['email', 'sms', 'ai_call'];
const STAGES: ReminderStage[] = ['before', 'due', 'overdue'];
const ICON = { email: Mail, sms: MessageSquare, ai_call: PhoneCall } as const;
const textarea =
  'w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

type DraftRule = Omit<ReminderRule, 'id'> & { id?: string; key: string };

type Preview =
  | { channel: 'email'; subject: string; html: string; unknown: string[] }
  | { channel: 'sms'; text: string; length: number; segments: number; unknown: string[] }
  | { channel: 'ai_call'; firstMessage: string; instructions: string; unknown: string[] };

function HowItWorks() {
  return (
    <Card>
      <h2 className="mb-3 font-semibold">How payment reminders work</h2>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Add each buyer&apos;s payment plan with its installments and the channels the buyer agreed
          to.
        </li>
        <li>
          Every morning PropForce checks unpaid installments against your schedule below (Dubai
          time).
        </li>
        <li>
          Each reminder goes out once per installment and channel. Mark an installment paid and its
          reminders stop.
        </li>
        <li>Everything is logged: sent, skipped (no consent or no email/phone) or failed.</li>
      </ol>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <Mail className="h-4 w-4" /> Email
          </p>
          A branded email with the amount, due date and your payment instructions, from
          noreply@propforce.io. Replies go to your reply-to address.
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <MessageSquare className="h-4 w-4" /> SMS
          </p>
          A short text to the buyer&apos;s mobile with the amount and due date. Keep it under 160
          characters for one message.
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <PhoneCall className="h-4 w-4" /> AI call
          </p>
          Our AI voice assistant calls the buyer between 9 AM and 6 PM, says it is an AI calling for
          you, reminds them politely and answers simple questions from your script. It never takes
          card details.
        </div>
      </div>
    </Card>
  );
}

export default function PaymentRemindersPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const t = { tenantId: agencyId };
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [contact, setContact] = useState({
    replyToEmail: '',
    contactPhone: '',
    paymentInstructions: '',
  });
  const [templates, setTemplates] = useState<TemplateList | null>(null);
  const [sel, setSel] = useState<{ channel: ReminderChannel; stage: ReminderStage }>({
    channel: 'email',
    stage: 'before',
  });
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [log, setLog] = useState<Dispatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyConfig = (c: ReminderConfig) => {
    setConfig(c);
    setRules(c.rules.map((r) => ({ ...r, key: r.id })));
    setContact({
      replyToEmail: c.replyToEmail ?? '',
      contactPhone: c.contactPhone ?? '',
      paymentInstructions: c.paymentInstructions ?? '',
    });
  };

  const load = useCallback(async () => {
    try {
      const [c, tl, l] = await Promise.all([
        request<ReminderConfig>('/payment-reminders/config', { tenantId: agencyId }),
        request<TemplateList>('/payment-reminders/templates', { tenantId: agencyId }),
        request<{ data: Dispatch[] }>('/payment-reminders/log', {
          tenantId: agencyId,
          query: { limit: 50 },
        }),
      ]);
      applyConfig(c);
      setTemplates(tl);
      setLog(l.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payment reminders.');
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = templates?.data.find((x) => x.channel === sel.channel && x.stage === sel.stage);
  useEffect(() => {
    if (current) setDraft({ subject: current.subject, body: current.body });
    setPreview(null);
  }, [current]);

  async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (ok) setNotice(ok);
      return r;
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = Object.values(err.fieldErrors);
        setError(fields.length ? `${err.message} ${fields.join(' ')}` : err.message);
      } else setError('Something went wrong.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const saveSettings = () =>
    act(async () => {
      const c = await request<ReminderConfig>('/payment-reminders/config', {
        ...t,
        method: 'PUT',
        body: {
          rules: rules.map(({ id, offsetDays, channels, active }) => ({
            ...(id ? { id } : {}),
            offsetDays,
            channels,
            active,
          })),
          replyToEmail: contact.replyToEmail || null,
          contactPhone: contact.contactPhone || null,
          paymentInstructions: contact.paymentInstructions || null,
        },
      });
      applyConfig(c);
    }, 'Schedule saved.');

  const reloadTemplates = async () =>
    setTemplates(await request<TemplateList>('/payment-reminders/templates', t));

  const toggleChannel = (i: number, ch: ReminderChannel) =>
    setRules(
      rules.map((r, idx) =>
        idx === i
          ? {
              ...r,
              channels: r.channels.includes(ch)
                ? r.channels.filter((c) => c !== ch)
                : [...r.channels, ch],
            }
          : r,
      ),
    );

  if (!config || !templates) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BellRing className="h-6 w-6" aria-hidden /> Payment reminders
          </h1>
          <p className="text-sm text-muted-foreground">
            Automatic reminders for your buyers&apos; installments by email, SMS and AI call.{' '}
            <Link href={`/app/${agencyId}/payment-plans`} className="text-primary underline">
              Payment plans
            </Link>
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const s = await request<RunSummary>('/payment-reminders/run', {
                ...t,
                method: 'POST',
              });
              setNotice(
                `Checked ${s.considered} reminders: ${s.sent} sent, ${s.skippedNoConsent} without consent, ${s.skippedNoAddress} without email/phone, ${s.providerPending} on channels not connected yet, ${s.failed} failed${s.deferredCalls ? `, ${s.deferredCalls} calls wait for calling hours` : ''}.`,
              );
              setLog(
                (
                  await request<{ data: Dispatch[] }>('/payment-reminders/log', {
                    ...t,
                    query: { limit: 50 },
                  })
                ).data,
              );
            })
          }
        >
          <Send className="h-4 w-4" /> Run reminders now
        </Button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-3 md:grid-cols-3">
        {CHANNELS.map((ch) => {
          const Icon = ICON[ch];
          const s = config.channels[ch];
          return (
            <Card key={ch} className="p-4">
              <p className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4" /> {CHANNEL_LABEL[ch]}
                <span
                  className={cn('ml-auto text-xs', s.ready ? 'text-emerald-600' : 'text-amber-600')}
                >
                  {s.ready ? 'Ready' : 'Not connected yet'}
                </span>
              </p>
              {s.note ? <p className="mt-1 text-xs text-muted-foreground">{s.note}</p> : null}
            </Card>
          );
        })}
      </div>

      <HowItWorks />

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Schedule</h2>
        <p className="text-sm text-muted-foreground">
          When to remind, and on which channels. Use a negative number for days before the due date,
          0 for the due date and a positive number for days overdue.
        </p>
        <ul className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <li
              key={r.key}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <Input
                aria-label="Day"
                className="w-20"
                inputMode="numeric"
                value={String(r.offsetDays)}
                onChange={(e) =>
                  setRules(
                    rules.map((x, idx) =>
                      idx === i ? { ...x, offsetDays: Number(e.target.value) || 0 } : x,
                    ),
                  )
                }
              />
              <span className="w-44 text-muted-foreground">{describeOffset(r.offsetDays)}</span>
              {CHANNELS.map((ch) => (
                <label key={ch} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={r.channels.includes(ch)}
                    onChange={() => toggleChannel(i, ch)}
                  />
                  {CHANNEL_LABEL[ch]}
                </label>
              ))}
              <label className="ml-auto flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={(e) =>
                    setRules(
                      rules.map((x, idx) => (idx === i ? { ...x, active: e.target.checked } : x)),
                    )
                  }
                />
                On
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove"
                onClick={() => setRules(rules.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRules([
                ...rules,
                { key: crypto.randomUUID(), offsetDays: -3, channels: ['email'], active: true },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add reminder
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            id="replyTo"
            label="Reply-to email"
            hint="Buyers' replies to reminder emails go here."
          >
            <Input
              id="replyTo"
              type="email"
              value={contact.replyToEmail}
              onChange={(e) => setContact({ ...contact, replyToEmail: e.target.value })}
            />
          </Field>
          <Field
            id="phone"
            label="Contact phone"
            hint="Shown in reminders and used by the AI for call-backs."
          >
            <Input
              id="phone"
              value={contact.contactPhone}
              onChange={(e) => setContact({ ...contact, contactPhone: e.target.value })}
            />
          </Field>
        </div>
        <Field
          id="instructions"
          label="Payment instructions"
          hint="For example the escrow account name, bank and IBAN. Never ask buyers for card details."
        >
          <textarea
            id="instructions"
            rows={3}
            className={textarea}
            value={contact.paymentInstructions}
            onChange={(e) => setContact({ ...contact, paymentInstructions: e.target.value })}
          />
        </Field>
        <div>
          <Button onClick={() => void saveSettings()} disabled={busy}>
            Save schedule
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Templates</h2>
        <p className="text-sm text-muted-foreground">
          Ready-made for each channel and stage. Edit any of them; placeholders like{' '}
          <code>{'{{buyer_name}}'}</code> are filled in for each buyer.
        </p>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) =>
            STAGES.map((st) => {
              const tpl = templates.data.find((x) => x.channel === ch && x.stage === st);
              const on = sel.channel === ch && sel.stage === st;
              return (
                <button
                  key={`${ch}.${st}`}
                  type="button"
                  onClick={() => setSel({ channel: ch, stage: st })}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-xs',
                    on ? 'border-primary bg-primary/10' : 'border-border',
                  )}
                >
                  {CHANNEL_LABEL[ch]} · {STAGE_LABEL[st]}
                  {tpl?.edited ? ' · edited' : ''}
                </button>
              );
            }),
          )}
        </div>
        {sel.channel !== 'sms' ? (
          <Field
            id="subject"
            label={
              sel.channel === 'email' ? 'Subject' : 'Opening line (must say it is an AI assistant)'
            }
          >
            <Input
              id="subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </Field>
        ) : null}
        <Field
          id="body"
          label={
            sel.channel === 'email'
              ? 'Email (HTML)'
              : sel.channel === 'sms'
                ? `SMS text (${draft.body.length}/${templates.smsMaxLength})`
                : 'Call script'
          }
        >
          <textarea
            id="body"
            rows={sel.channel === 'sms' ? 3 : 14}
            className={textarea}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </Field>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Placeholders</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {Object.entries(templates.placeholders).map(([k, v]) => (
              <li key={k}>
                <code>{`{{${k}}}`}</code> {v}
              </li>
            ))}
          </ul>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await request(`/payment-reminders/templates/${sel.channel}/${sel.stage}`, {
                  ...t,
                  method: 'PUT',
                  body: draft,
                });
                await reloadTemplates();
              }, 'Template saved.')
            }
          >
            Save template
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setPreview(
                  await request<Preview>('/payment-reminders/preview', {
                    ...t,
                    method: 'POST',
                    body: { ...sel, ...draft },
                  }),
                ),
              )
            }
          >
            Preview
          </Button>
          {sel.channel === 'email' ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await request<{ sentTo: string }>('/payment-reminders/test-email', {
                    ...t,
                    method: 'POST',
                    body: { stage: sel.stage },
                  });
                  setNotice(`Test email (saved template) sent to ${r.sentTo}.`);
                })
              }
            >
              <Send className="h-4 w-4" /> Send me a test
            </Button>
          ) : null}
          {current?.edited ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request(`/payment-reminders/templates/${sel.channel}/${sel.stage}`, {
                    ...t,
                    method: 'DELETE',
                  });
                  await reloadTemplates();
                }, 'Template reset to the ready-made version.')
              }
            >
              <RotateCcw className="h-4 w-4" /> Reset to ready-made
            </Button>
          ) : null}
        </div>
        {preview ? (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Preview with a sample buyer
            </p>
            {preview.unknown.length ? (
              <Alert className="mb-2">
                Unknown placeholders: {preview.unknown.map((u) => `{{${u}}}`).join(', ')}
              </Alert>
            ) : null}
            {preview.channel === 'email' ? (
              <>
                <p className="mb-2 text-sm">
                  <strong>Subject:</strong> {preview.subject}
                </p>
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-96 w-full rounded border border-border bg-white"
                />
              </>
            ) : preview.channel === 'sms' ? (
              <p className="text-sm">
                {preview.text}
                <span className="block text-xs text-muted-foreground">
                  {preview.length} characters · about {preview.segments} SMS
                </span>
              </p>
            ) : (
              <div className="text-sm">
                <p className="mb-2">
                  <strong>AI says first:</strong> {preview.firstMessage}
                </p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {preview.instructions}
                </pre>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Recent reminders</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {log.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-b-0"
              >
                <span>
                  <Link
                    href={`/app/${agencyId}/payment-plans/${d.installment.plan.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {d.installment.plan.contact.fullName}
                  </Link>{' '}
                  · {CHANNEL_LABEL[d.channel]} · {d.installment.label} (due{' '}
                  {dateText(d.installment.dueDate)}) · {describeOffset(d.offsetDays)}
                </span>
                <span
                  className={cn(
                    d.status === 'sent'
                      ? 'text-emerald-600'
                      : d.status === 'failed'
                        ? 'text-red-600'
                        : 'text-muted-foreground',
                  )}
                >
                  {DISPATCH_LABEL[d.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
