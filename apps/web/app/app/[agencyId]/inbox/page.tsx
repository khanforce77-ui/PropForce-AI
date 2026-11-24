'use client';

import { ArrowLeft, Bot, Check, CheckCheck, Send, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Mode = 'ai' | 'human';
type Author = 'client' | 'ai' | 'agent' | 'system';

interface ConversationSummary {
  id: string;
  mode: Mode;
  unreadCount: number;
  lastInboundAt: string | null;
  lastMessageAt: string;
  assignedMembershipId: string | null;
  contact: { id: string; fullName: string; phoneE164: string | null };
  lastMessage: {
    body: string | null;
    type: string;
    direction: 'inbound' | 'outbound';
    author: Author;
    createdAt: string;
  } | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  author: Author;
  type: string;
  body: string | null;
  mediaMimeType: string | null;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: number | null;
  createdAt: string;
}

type Filter = 'all' | 'human' | 'ai' | 'unread' | 'mine';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'human', label: 'Needs agent' },
  { key: 'ai', label: 'AI handling' },
  { key: 'unread', label: 'Unread' },
  { key: 'mine', label: 'Mine' },
];

const POLL_MS = 10_000;
const WINDOW_MS = 24 * 3600_000;

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const preview = (m: ConversationSummary['lastMessage']) => {
  if (!m) return 'No messages yet';
  const who = m.author === 'ai' ? 'AI: ' : m.author === 'agent' ? 'You: ' : '';
  return who + (m.body ?? `[${m.type}]`);
};

/** Explains why a reply could not be sent, in words an agent can act on. */
const sendError = (err: unknown) => {
  if (!(err instanceof ApiError)) return 'Could not send the message.';
  switch (err.code) {
    case 'WA_WINDOW_CLOSED':
      return 'More than 24 hours since the client last wrote. WhatsApp only allows an approved template now.';
    case 'CONSENT_MISSING':
      return 'This client has opted out of WhatsApp messages.';
    case 'INTEGRATION_EXPIRED':
    case 'INTEGRATION_DISCONNECTED':
      return `${err.message} An owner or admin can fix this in Settings → WhatsApp.`;
    default:
      return err.message;
  }
};

function ModeBadge({ mode }: { mode: Mode }) {
  return mode === 'ai' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
      <Bot className="h-3 w-3" aria-hidden /> AI
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <UserRound className="h-3 w-3" aria-hidden /> Agent
    </span>
  );
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'failed') return <span className="text-red-600">Not delivered</span>;
  if (status === 'read')
    return <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
  if (status === 'sent') return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return null;
}

function Thread({
  agencyId,
  conversation,
  onChanged,
  onBack,
}: {
  agencyId: string;
  conversation: ConversationSummary;
  onChanged: () => void;
  onBack: () => void;
}) {
  const { request } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);
  const id = conversation.id;

  const load = useCallback(async () => {
    try {
      const res = await request<{ data: Message[] }>(`/conversations/${id}/messages`, {
        tenantId: agencyId,
        query: { limit: 50 },
      });
      setMessages((prev) => {
        // Keep older pages already loaded; replace the latest page.
        const latest = new Set(res.data.map((m) => m.id));
        const older = prev.filter(
          (m) => !latest.has(m.id) && res.data[0] && m.createdAt < res.data[0].createdAt,
        );
        return [...older, ...res.data];
      });
      setHasOlder((h) => h || res.data.length === 50);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load messages.');
    }
  }, [agencyId, id, request]);

  useEffect(() => {
    setMessages([]);
    setHasOlder(false);
    setError(null);
    lastId.current = null;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Scroll to the newest message when one arrives.
  useEffect(() => {
    const newest = messages.at(-1)?.id ?? null;
    if (newest && newest !== lastId.current) {
      lastId.current = newest;
      bottom.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    try {
      const res = await request<{ data: Message[] }>(`/conversations/${id}/messages`, {
        tenantId: agencyId,
        query: { limit: 50, before: first.id },
      });
      setMessages((prev) => [...res.data, ...prev]);
      setHasOlder(res.data.length === 50);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load older messages.');
    }
  }

  async function setMode(mode: Mode) {
    setError(null);
    setBusy(true);
    try {
      await request(`/conversations/${id}/${mode === 'human' ? 'takeover' : 'release-to-ai'}`, {
        tenantId: agencyId,
        method: 'POST',
      });
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONSENT_MISSING'
          ? 'This client has opted out of WhatsApp, so the AI cannot reply to them.'
          : err instanceof ApiError
            ? err.message
            : 'Could not change who is replying.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setBusy(true);
    try {
      await request(`/conversations/${id}/messages`, {
        tenantId: agencyId,
        method: 'POST',
        body: { body },
      });
      setDraft('');
      await load();
      onChanged();
    } catch (err) {
      setError(sendError(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const windowOpen =
    conversation.lastInboundAt !== null &&
    Date.now() - Date.parse(conversation.lastInboundAt) < WINDOW_MS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0">
            <Link
              href={`/app/${agencyId}/contacts/${conversation.contact.id}`}
              className="block truncate font-medium hover:underline"
            >
              {conversation.contact.fullName}
            </Link>
            <p className="text-xs text-muted-foreground">{conversation.contact.phoneE164}</p>
          </div>
          <ModeBadge mode={conversation.mode} />
        </div>
        {conversation.mode === 'ai' ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void setMode('human')}>
            Take over from AI
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void setMode('ai')}>
            Hand back to AI
          </Button>
        )}
      </header>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 px-4 py-4"
        aria-live="polite"
      >
        {hasOlder && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>
              Load older messages
            </Button>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.direction === 'outbound';
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm',
                  mine
                    ? m.author === 'ai'
                      ? 'bg-primary/10'
                      : 'bg-emerald-100 dark:bg-emerald-950'
                    : 'bg-background',
                  m.status === 'failed' && 'border border-red-400',
                )}
              >
                {mine && (
                  <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                    {m.author === 'ai' ? 'AI assistant' : m.author === 'agent' ? 'Agent' : 'System'}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">
                  {m.body ?? (
                    <span className="italic text-muted-foreground">
                      [{m.type}
                      {m.mediaMimeType ? `, ${m.mediaMimeType}` : ''}]
                    </span>
                  )}
                </p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                  {time(m.createdAt)}
                  {mine && <StatusIcon status={m.status} />}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border px-4 py-3">
        {error && (
          <Alert tone="error" className="mb-2">
            {error}
          </Alert>
        )}
        {!windowOpen ? (
          <p className="text-sm text-muted-foreground">
            The client last wrote more than 24 hours ago. WhatsApp only allows free replies within
            24 hours of their last message.
          </p>
        ) : (
          <form onSubmit={(e) => void send(e)} className="flex items-end gap-2">
            <label htmlFor="reply" className="sr-only">
              Reply
            </label>
            <textarea
              id="reply"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={4096}
              placeholder={
                conversation.mode === 'ai'
                  ? 'Type a reply. Sending takes the chat over from the AI.'
                  : 'Type a reply'
              }
              className="min-h-10 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              <Send className="h-4 w-4" aria-hidden /> Send
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Inbox() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const selectedId = search.get('c');
  const { request } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (cursor?: string) => ({
      limit: 30,
      cursor,
      // The API reads any value as true, so send these only when they apply.
      mode: filter === 'human' || filter === 'ai' ? filter : undefined,
      unread: filter === 'unread' ? 'true' : undefined,
      mine: filter === 'mine' ? 'true' : undefined,
    }),
    [filter],
  );

  const load = useCallback(async () => {
    try {
      const res = await request<{ data: ConversationSummary[]; nextCursor: string | null }>(
        '/conversations',
        { tenantId: agencyId, query: query() },
      );
      setItems(res.data);
      setNextCursor(res.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load conversations.');
    }
  }, [agencyId, query, request]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const res = await request<{ data: ConversationSummary[]; nextCursor: string | null }>(
        '/conversations',
        { tenantId: agencyId, query: query(nextCursor) },
      );
      setItems((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load conversations.');
    }
  }

  const open = (id: string | null) =>
    router.replace(id ? `/app/${agencyId}/inbox?c=${id}` : `/app/${agencyId}/inbox`);
  const selected = items?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          WhatsApp conversations with clients. The AI answers chats marked AI; take over any chat to
          reply yourself.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Card className="grid h-[calc(100vh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden p-0 md:grid-cols-[20rem_1fr]">
        <section
          aria-label="Conversations"
          className={cn(
            'flex min-h-0 flex-col border-border md:border-r',
            selected && 'hidden md:flex',
          )}
        >
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs whitespace-nowrap',
                  filter === f.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {items === null ? (
              <li className="p-4 text-sm text-muted-foreground">Loading…</li>
            ) : items.length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground">
                No conversations yet. When a client messages your WhatsApp number, it appears here.
              </li>
            ) : (
              items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    aria-current={c.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted',
                      c.id === selectedId && 'bg-muted',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn('truncate text-sm', c.unreadCount > 0 && 'font-semibold')}
                      >
                        {c.contact.fullName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {time(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {preview(c.lastMessage)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <ModeBadge mode={c.mode} />
                        {c.unreadCount > 0 && (
                          <span
                            className="rounded-full bg-emerald-600 px-1.5 text-xs text-white"
                            aria-label={`${c.unreadCount} unread`}
                          >
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
            {nextCursor && (
              <li className="p-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                  Load more
                </Button>
              </li>
            )}
          </ul>
        </section>
        <section
          aria-label="Conversation"
          className={cn('min-h-0', selected ? 'flex flex-col' : 'hidden md:flex md:flex-col')}
        >
          {selected ? (
            <Thread
              key={selected.id}
              agencyId={agencyId}
              conversation={selected}
              onChanged={() => void load()}
              onBack={() => open(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Select a conversation to read and reply.
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}
