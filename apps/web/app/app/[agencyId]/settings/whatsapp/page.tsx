'use client';

import { MessageCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';

interface Account {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: 'active' | 'disconnected';
  /** When Meta stops accepting the connection; null = never. */
  tokenExpiresAt: string | null;
  createdAt: string;
}

const DAY_MS = 86_400_000;
/** Days until the connection expires, or null when it does not expire. */
const daysLeft = (a: Account, now: number) =>
  a.tokenExpiresAt ? Math.ceil((Date.parse(a.tokenExpiresAt) - now) / DAY_MS) : null;

/** Public Meta app values (not secrets). Read by name so Next.js inlines them. */
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const ES_CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
const GRAPH_VERSION = 'v21.0';

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
}
interface FbSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** Loads Meta's JavaScript SDK once. */
function loadFacebookSdk(appId: string): Promise<FbSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Could not load Meta sign-in.'));
    document.body.appendChild(s);
  });
}

/** Session info Meta posts from the signup popup: the chosen WhatsApp account and number. */
interface SignupInfo {
  wabaId: string;
  phoneNumberId: string;
}
const isMetaOrigin = (origin: string) => {
  try {
    const host = new URL(origin).hostname;
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch {
    return false;
  }
};

export default function WhatsAppSettings() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { me, request } = useAuth();
  const isPlatformAdmin = me?.user.isPlatformAdmin === true;
  const [direct, setDirect] = useState({ wabaId: '', phoneNumberId: '' });
  const role = useAgencyMembership()?.role;
  const canManage = role === 'owner' || role === 'admin';
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signupInfo = useRef<SignupInfo | null>(null);
  const configured = Boolean(META_APP_ID && ES_CONFIG_ID);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      setAccounts(await request<Account[]>('/whatsapp/accounts', { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load WhatsApp numbers.');
    }
  }, [agencyId, canManage, request]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isMetaOrigin(event.origin)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
          const { waba_id: wabaId, phone_number_id: phoneNumberId } = data.data ?? {};
          if (typeof wabaId === 'string' && typeof phoneNumberId === 'string') {
            signupInfo.current = { wabaId, phoneNumberId };
          }
        } else if (data.event === 'CANCEL') {
          setNotice('WhatsApp connection was cancelled.');
        }
      } catch {
        // Not a signup message.
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function connect() {
    if (!META_APP_ID || !ES_CONFIG_ID) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    signupInfo.current = null;
    try {
      const fb = await loadFacebookSdk(META_APP_ID);
      const code = await new Promise<string | null>((resolve) =>
        fb.login((r) => resolve(r.authResponse?.code ?? null), {
          config_id: ES_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        }),
      );
      // The session message can arrive just after the login callback.
      for (let i = 0; i < 20 && !signupInfo.current; i++) {
        await new Promise((r) => setTimeout(r, 150));
      }
      const info = signupInfo.current as SignupInfo | null;
      if (!code || !info) {
        setNotice('WhatsApp was not connected. Finish all steps in the Meta window to connect.');
        return;
      }
      await request('/whatsapp/accounts', { tenantId: agencyId, body: { code, ...info } });
      setNotice('WhatsApp number connected. Client messages will now appear in your inbox.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Platform admins: attach a number of PropForce's own business with its system token. */
  async function connectDirect(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await request('/whatsapp/accounts/direct', {
        tenantId: agencyId,
        body: { wabaId: direct.wabaId.trim(), phoneNumberId: direct.phoneNumberId.trim() },
      });
      setNotice('WhatsApp number attached. Client messages will now appear in your inbox.');
      setDirect({ wabaId: '', phoneNumberId: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    setError(null);
    try {
      await request(`/whatsapp/accounts/${id}/disconnect`, { tenantId: agencyId, method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    }
  }

  if (!canManage) {
    return (
      <Card className="p-6">
        <p className="text-sm">Only agency owners and admins can manage WhatsApp numbers.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="text-muted-foreground text-sm">
          Connect your agency’s own WhatsApp Business number. Client messages arrive in your inbox
          and only your agency can see them.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      {accounts
        .filter((a) => a.status === 'active')
        .map((a) => ({ a, left: daysLeft(a, Date.now()) }))
        .filter(({ left }) => left !== null && left <= 7)
        .map(({ a, left }) => (
          <Alert key={a.id} tone="error">
            {left! <= 0
              ? `The WhatsApp connection for ${a.displayPhoneNumber} has expired. Messages cannot be sent until you reconnect it.`
              : `The WhatsApp connection for ${a.displayPhoneNumber} expires in ${left} day${left === 1 ? '' : 's'}. Reconnect it to keep sending messages.`}{' '}
            Use “Reconnect” and choose the same number in the Meta window.
          </Alert>
        ))}
      <Card className="space-y-4 p-6">
        {accounts.filter((a) => a.status === 'active').length === 0 && (
          <p className="text-sm">No WhatsApp number connected yet.</p>
        )}
        <ul className="divide-y">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3">
                <MessageCircle className="size-5" aria-hidden />
                <div>
                  <p className="font-medium">{a.displayPhoneNumber}</p>
                  <p className="text-muted-foreground text-xs">
                    {a.status === 'active' ? 'Connected' : 'Disconnected'} ·{' '}
                    {new Date(a.createdAt).toLocaleDateString()}
                    {a.status === 'active' && a.tokenExpiresAt
                      ? ` · Reconnect by ${new Date(a.tokenExpiresAt).toLocaleDateString()}`
                      : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {configured && (a.status !== 'active' || (daysLeft(a, Date.now()) ?? 99) <= 7) && (
                  <Button onClick={() => void connect()} disabled={busy}>
                    Reconnect
                  </Button>
                )}
                {a.status === 'active' && (
                  <Button variant="outline" onClick={() => void disconnect(a.id)}>
                    Disconnect
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {configured ? (
          <Button onClick={() => void connect()} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect WhatsApp number'}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            WhatsApp connection is not set up on this server yet.
          </p>
        )}
      </Card>
      {isPlatformAdmin && (
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Attach a PropForce number (platform admin)</h2>
            <p className="text-muted-foreground text-sm">
              For numbers in the business that owns the PropForce Meta app, which the Meta window
              cannot connect. Copy both ids from WhatsApp Manager or the app’s API setup page.
            </p>
          </div>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void connectDirect(e)}>
            <Field id="direct-waba" label="WhatsApp Business Account id">
              <Input
                id="direct-waba"
                inputMode="numeric"
                pattern="\d{1,32}"
                required
                value={direct.wabaId}
                onChange={(e) => setDirect((d) => ({ ...d, wabaId: e.target.value }))}
              />
            </Field>
            <Field id="direct-phone" label="Phone number id">
              <Input
                id="direct-phone"
                inputMode="numeric"
                pattern="\d{1,32}"
                required
                value={direct.phoneNumberId}
                onChange={(e) => setDirect((d) => ({ ...d, phoneNumberId: e.target.value }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Attaching…' : 'Attach number'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
