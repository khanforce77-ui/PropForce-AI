'use client';

import { MessageCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';

interface Account {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: 'active' | 'disconnected';
  createdAt: string;
}

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
  const { request } = useAuth();
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
                  </p>
                </div>
              </div>
              {a.status === 'active' && (
                <Button variant="outline" onClick={() => void disconnect(a.id)}>
                  Disconnect
                </Button>
              )}
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
    </div>
  );
}
