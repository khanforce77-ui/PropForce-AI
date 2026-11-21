'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type Invitation, type Member } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';

function Members() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const welcome = useSearchParams().get('welcome') === '1';
  const { me, request } = useAuth();
  const role = useAgencyMembership()?.role;
  const canManage = role === 'owner' || role === 'admin';

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    welcome ? 'Your agency is set up. Invite your team.' : null,
  );

  const load = useCallback(async () => {
    try {
      const m = await request<{ data: Member[] }>('/members', { tenantId: agencyId });
      setMembers(m.data);
      if (canManage)
        setInvites(
          (await request<{ data: Invitation[] }>('/invitations', { tenantId: agencyId })).data,
        );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load members.');
    }
  }, [agencyId, canManage, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, success: string) {
    setError(null);
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void act(
      () =>
        request('/invitations', {
          tenantId: agencyId,
          body: { email: f.get('email'), role: f.get('role') },
        }),
      `Invitation sent to ${String(f.get('email'))}.`,
    ).then(() => form.reset());
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Team members</h1>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      {canManage ? (
        <Card>
          <h2 className="font-medium">Invite someone</h2>
          <form
            onSubmit={onInvite}
            className="mt-4 grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
          >
            <Field id="invite-email" label="Email">
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <Field id="invite-role" label="Role">
              <Select id="invite-role" name="role" defaultValue="agent">
                <option value="agent">Agent</option>
                <option value="manager">Team manager</option>
                {role === 'owner' ? <option value="admin">Admin</option> : null}
              </Select>
            </Field>
            <Button type="submit">Send invite</Button>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {canManage ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{m.user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{m.user.email}</p>
                </td>
                <td className="px-4 py-3 capitalize">{m.role}</td>
                <td className="px-4 py-3 capitalize">{m.status}</td>
                {canManage ? (
                  <td className="px-4 py-3 text-right">
                    {m.user.id !== me?.user.id &&
                    (role === 'owner' || !['owner', 'admin'].includes(m.role)) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void act(
                            () =>
                              request(
                                `/members/${m.id}/${m.status === 'active' ? 'suspend' : 'reactivate'}`,
                                {
                                  method: 'POST',
                                  tenantId: agencyId,
                                },
                              ),
                            m.status === 'active'
                              ? `${m.user.fullName} was suspended.`
                              : `${m.user.fullName} was reactivated.`,
                          )
                        }
                      >
                        {m.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canManage && invites.length > 0 ? (
        <Card>
          <h2 className="font-medium">Pending invitations</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>
                  {i.email} <span className="text-muted-foreground capitalize">· {i.role}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void act(
                      () =>
                        request(`/invitations/${i.id}`, { method: 'DELETE', tenantId: agencyId }),
                      'Invitation revoked.',
                    )
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense>
      <Members />
    </Suspense>
  );
}
