import type { INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  registration,
  resetDatabase,
  resetRateLimits,
  tokenFrom,
  type TestApp,
} from './helpers';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
  app = t.app;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  resetRateLimits(app);
  t.emails.length = 0;
});

type Headers = Record<string, string>;
interface Actor {
  userId: string;
  email: string;
  password: string;
  auth: Headers;
}
interface Owner extends Actor {
  tenantId: string;
  membershipId: string;
  /** Auth + tenant headers. */
  h: Headers;
}

async function loginAs(email: string, password: string): Promise<Headers> {
  const res = await http().post('/v1/auth/login').send({ email, password }).expect(200);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

async function enableMfa(auth: Headers): Promise<void> {
  const setup = await http().post('/v1/me/mfa/totp/setup').set(auth).expect(200);
  const code = new TOTP({
    secret: Secret.fromBase32(setup.body.secret),
    digits: 6,
    period: 30,
  }).generate();
  await http().post('/v1/me/mfa/totp/confirm').set(auth).send({ code }).expect(200);
}

/** Registers an agency owner with MFA enabled. */
async function createOwner(email: string, agencyName: string, withMfa = true): Promise<Owner> {
  const body = registration({ email, agency: { name: agencyName, emirate: 'Dubai' } });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const auth = await loginAs(email, body.password);
  if (withMfa) await enableMfa(auth);
  const me = await http().get('/v1/me').set(auth).expect(200);
  const m = me.body.memberships[0];
  return {
    userId: me.body.user.id,
    email,
    password: body.password,
    auth,
    tenantId: m.agency.id,
    membershipId: m.id,
    h: { ...auth, 'X-Tenant-Id': m.agency.id },
  };
}

/** Invites a new person and accepts as them; returns their headers for this agency. */
async function inviteNew(inviter: Owner, email: string, role: string, mfa = false) {
  await http().post('/v1/invitations').set(inviter.h).send({ email, role }).expect(201);
  const token = tokenFrom(t.emails.at(-1));
  const password = 'invited person passphrase';
  const accepted = await http()
    .post('/v1/invitations/accept')
    .send({ token, fullName: `Invited ${role}`, password })
    .expect(200);
  expect(accepted.body).toMatchObject({ tenantId: inviter.tenantId, newAccount: true });
  const auth = await loginAs(email, password);
  if (mfa) await enableMfa(auth);
  return {
    membershipId: accepted.body.membershipId as string,
    auth,
    h: { ...auth, 'X-Tenant-Id': inviter.tenantId },
  };
}

describe('agency context', () => {
  it('requires a valid X-Tenant-Id header', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    expect((await http().get('/v1/agency').set(o.auth).expect(400)).body.code).toBe(
      'TENANT_REQUIRED',
    );
    await http().get('/v1/agency').set(o.auth).set('X-Tenant-Id', 'nope').expect(400);
  });

  it('refuses agencies the user does not belong to', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const res = await http()
      .get('/v1/agency')
      .set(a.auth)
      .set('X-Tenant-Id', b.tenantId)
      .expect(403);
    expect(res.body.code).toBe('TENANT_FORBIDDEN');
  });

  it('requires MFA for owners before any agency route', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty', false);
    const res = await http().get('/v1/agency').set(o.h).expect(403);
    expect(res.body.code).toBe('AUTH_MFA_ENROLLMENT_REQUIRED');
    await enableMfa(o.auth);
    await http().get('/v1/agency').set(o.h).expect(200);
  });

  it('blocks every member of a suspended agency', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await t.owner.agency.update({ where: { id: o.tenantId }, data: { status: 'suspended' } });
    expect((await http().get('/v1/agency').set(o.h).expect(403)).body.code).toBe(
      'TENANT_SUSPENDED',
    );
  });
});

describe('agency profile and settings', () => {
  it('completes onboarding once: pending becomes active', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    expect((await http().get('/v1/agency').set(o.h).expect(200)).body.status).toBe('pending');
    const done = await http().post('/v1/agency/onboarding/complete').set(o.h).expect(200);
    expect(done.body.status).toBe('active');
    expect(done.body.onboardedAt).toBeTruthy();
    await http().post('/v1/agency/onboarding/complete').set(o.h).expect(200);
    const logs = await http()
      .get('/v1/audit-logs')
      .set(o.h)
      .query({ action: 'agency.onboarded' })
      .expect(200);
    expect(logs.body.data).toHaveLength(1);
  });

  it('lets the owner update the profile and records an audit entry', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const res = await http()
      .patch('/v1/agency')
      .set(o.h)
      .send({ name: 'Alpha Realty LLC', orn: '12345' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Alpha Realty LLC', orn: '12345' });

    const logs = await http()
      .get('/v1/audit-logs')
      .set(o.h)
      .query({ action: 'agency.updated' })
      .expect(200);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({
      actorUserId: o.userId,
      before: { name: 'Alpha Realty', orn: null },
      after: { name: 'Alpha Realty LLC', orn: '12345' },
    });
  });

  it('updates settings but never lets the agency switch on outbound voice itself', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await http()
      .patch('/v1/agency/settings')
      .set(o.h)
      .send({ listingFreshnessDays: 7 })
      .expect(200);
    await http()
      .patch('/v1/agency/settings')
      .set(o.h)
      .send({ outboundVoiceEnabled: true })
      .expect(400);
    const s = await http().get('/v1/agency/settings').set(o.h).expect(200);
    expect(s.body).toMatchObject({ listingFreshnessDays: 7, outboundVoiceEnabled: false });
  });
});

describe('invitations', () => {
  it('creates an account for a new person, who then has agent permissions only', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');

    const user = await t.owner.user.findUniqueOrThrow({ where: { email: 'agent@a.test' } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const members = await http().get('/v1/members').set(agent.h).expect(200);
    expect(members.body.data.map((m: { role: string }) => m.role).sort()).toEqual([
      'agent',
      'owner',
    ]);
    await http().get('/v1/agency').set(agent.h).expect(200);

    for (const [method, path] of [
      ['patch', '/v1/agency'],
      ['get', '/v1/agency/settings'],
      ['get', '/v1/invitations'],
      ['post', '/v1/invitations'],
      ['get', '/v1/audit-logs'],
      ['post', '/v1/teams'],
      ['patch', `/v1/members/${o.membershipId}`],
      ['post', `/v1/members/${o.membershipId}/suspend`],
    ] as const) {
      const res = await http()[method](path).set(agent.h).send({});
      expect({ path, status: res.status, code: res.body.code }).toEqual({
        path,
        status: 403,
        code: 'PERMISSION_DENIED',
      });
    }
  });

  it('invitation links are single use and stop working when revoked or expired', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const accept = (token: string) =>
      http()
        .post('/v1/invitations/accept')
        .send({ token, fullName: 'New Person', password: 'long enough password' });

    await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'one@a.test', role: 'agent' })
      .expect(201);
    const one = tokenFrom(t.emails.at(-1));
    await accept(one).expect(200);
    expect((await accept(one).expect(400)).body.code).toBe('INVITATION_INVALID');

    const two = await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'two@a.test', role: 'agent' })
      .expect(201);
    const twoToken = tokenFrom(t.emails.at(-1));
    await http().delete(`/v1/invitations/${two.body.id}`).set(o.h).expect(204);
    await accept(twoToken).expect(400);

    await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'three@a.test', role: 'agent' })
      .expect(201);
    const threeToken = tokenFrom(t.emails.at(-1));
    await t.owner.invitation.updateMany({
      where: { email: 'three@a.test' },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await accept(threeToken).expect(400);
  });

  it('requires an existing account to be signed in as the invited email', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'owner@b.test', role: 'manager' })
      .expect(201);
    const token = tokenFrom(t.emails.at(-1));

    const anon = await http().post('/v1/invitations/accept').send({ token }).expect(401);
    expect(anon.body.code).toBe('INVITATION_SIGN_IN_REQUIRED');
    await http().post('/v1/invitations/accept').set(a.auth).send({ token }).expect(401);

    await http().post('/v1/invitations/accept').set(b.auth).send({ token }).expect(200);
    const me = await http().get('/v1/me').set(b.auth).expect(200);
    expect(me.body.memberships.map((m: { role: string }) => m.role).sort()).toEqual([
      'manager',
      'owner',
    ]);
  });

  it('rejects inviting existing members and inviting directly as owner', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'owner@a.test', role: 'agent' })
      .expect(409);
    await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'x@a.test', role: 'owner' })
      .expect(400);
  });
});

describe('roles and suspension', () => {
  it('admins manage agents but cannot touch owners or create admins', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const admin = await inviteNew(o, 'admin@a.test', 'admin', true);
    const agent = await inviteNew(o, 'agent@a.test', 'agent');

    await http()
      .post('/v1/invitations')
      .set(admin.h)
      .send({ email: 'adm2@a.test', role: 'admin' })
      .expect(403);
    await http()
      .patch(`/v1/members/${agent.membershipId}`)
      .set(admin.h)
      .send({ role: 'admin' })
      .expect(403);
    await http()
      .patch(`/v1/members/${o.membershipId}`)
      .set(admin.h)
      .send({ role: 'agent' })
      .expect(403);
    await http().post(`/v1/members/${o.membershipId}/suspend`).set(admin.h).expect(403);

    await http()
      .patch(`/v1/members/${agent.membershipId}`)
      .set(admin.h)
      .send({ role: 'manager' })
      .expect(200);
  });

  it('admins must use MFA too', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const admin = await inviteNew(o, 'admin@a.test', 'admin', false);
    expect((await http().get('/v1/members').set(admin.h).expect(403)).body.code).toBe(
      'AUTH_MFA_ENROLLMENT_REQUIRED',
    );
  });

  it('suspension blocks the member immediately and reactivation restores access', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    await http().post(`/v1/members/${agent.membershipId}/suspend`).set(o.h).expect(200);
    expect((await http().get('/v1/agency').set(agent.h).expect(403)).body.code).toBe(
      'MEMBERSHIP_SUSPENDED',
    );
    await http().post(`/v1/members/${agent.membershipId}/reactivate`).set(o.h).expect(200);
    await http().get('/v1/agency').set(agent.h).expect(200);

    const actions = (await http().get('/v1/audit-logs').set(o.h).expect(200)).body.data.map(
      (l: { action: string }) => l.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['member.suspended', 'member.reactivated']));
  });

  it('owners cannot change their own role or suspend themselves', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await http()
      .patch(`/v1/members/${o.membershipId}`)
      .set(o.h)
      .send({ role: 'agent' })
      .expect(403);
    await http().post(`/v1/members/${o.membershipId}/suspend`).set(o.h).expect(403);
  });
});

describe('teams', () => {
  it('creates, assigns, renames and deletes teams', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const team = await http().post('/v1/teams').set(o.h).send({ name: 'Marina' }).expect(201);
    await http().post('/v1/teams').set(o.h).send({ name: 'Marina' }).expect(409);
    await http()
      .patch(`/v1/members/${agent.membershipId}`)
      .set(o.h)
      .send({ teamId: team.body.id })
      .expect(200);
    await http()
      .patch(`/v1/teams/${team.body.id}`)
      .set(o.h)
      .send({ name: 'Marina & JBR' })
      .expect(200);
    const list = await http().get('/v1/teams').set(agent.h).expect(200);
    expect(list.body.data[0]).toMatchObject({ name: 'Marina & JBR', _count: { memberships: 1 } });
    await http().delete(`/v1/teams/${team.body.id}`).set(o.h).expect(204);
    const members = await http().get('/v1/members').set(o.h).expect(200);
    expect(members.body.data.every((m: { teamId: string | null }) => m.teamId === null)).toBe(true);
  });
});

describe('cross-agency isolation through the API', () => {
  it('cannot read or change another agency’s members, teams, invitations or audit log', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const bTeam = await http().post('/v1/teams').set(b.h).send({ name: 'Bravo Team' }).expect(201);
    const bInvite = await http()
      .post('/v1/invitations')
      .set(b.h)
      .send({ email: 'x@b.test', role: 'agent' })
      .expect(201);

    await http().patch(`/v1/members/${b.membershipId}`).set(a.h).send({ teamId: null }).expect(404);
    await http().post(`/v1/members/${b.membershipId}/suspend`).set(a.h).expect(404);
    await http()
      .patch(`/v1/teams/${bTeam.body.id}`)
      .set(a.h)
      .send({ name: 'Hijacked' })
      .expect(404);
    await http().delete(`/v1/teams/${bTeam.body.id}`).set(a.h).expect(404);
    await http().delete(`/v1/invitations/${bInvite.body.id}`).set(a.h).expect(404);
    await http()
      .patch(`/v1/members/${a.membershipId}`)
      .set(a.h)
      .send({ teamId: bTeam.body.id })
      .expect(404);

    const members = await http().get('/v1/members').set(a.h).expect(200);
    expect(members.body.data.map((m: { id: string }) => m.id)).toEqual([a.membershipId]);
    expect((await http().get('/v1/teams').set(a.h).expect(200)).body.data).toEqual([]);
    expect((await http().get('/v1/invitations').set(a.h).expect(200)).body.data).toEqual([]);
    const logs = await http().get('/v1/audit-logs').set(a.h).query({ limit: 100 }).expect(200);
    expect(logs.body.data.every((l: { tenantId: string }) => l.tenantId === a.tenantId)).toBe(true);
    expect((await t.owner.team.findUniqueOrThrow({ where: { id: bTeam.body.id } })).name).toBe(
      'Bravo Team',
    );
  });
});

describe('audit log', () => {
  it('pages newest first with a cursor', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    for (const name of ['T1', 'T2', 'T3'])
      await http().post('/v1/teams').set(o.h).send({ name }).expect(201);
    const p1 = await http()
      .get('/v1/audit-logs')
      .set(o.h)
      .query({ limit: 2, action: 'team.created' })
      .expect(200);
    expect(p1.body.data.map((l: { after: { name: string } }) => l.after.name)).toEqual([
      'T3',
      'T2',
    ]);
    const p2 = await http()
      .get('/v1/audit-logs')
      .set(o.h)
      .query({ limit: 2, action: 'team.created', cursor: p1.body.nextCursor })
      .expect(200);
    expect(p2.body.data.map((l: { after: { name: string } }) => l.after.name)).toEqual(['T1']);
    expect(p2.body.nextCursor).toBeNull();
  });
});
