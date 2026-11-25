import type { INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { expect } from 'vitest';
import { registration, tokenFrom, type TestApp } from './helpers';

export type Headers = Record<string, string>;
export interface Owner {
  userId: string;
  tenantId: string;
  membershipId: string;
  auth: Headers;
  /** Auth + tenant headers. */
  h: Headers;
}
export interface Invited {
  membershipId: string;
  auth: Headers;
  h: Headers;
}

/** Sign-up, invitation and listing helpers shared by the feature e2e suites. */
export function actors(t: () => TestApp) {
  const app = (): INestApplication => t().app;
  const http = () => request(app().getHttpServer());

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
  async function createOwner(email: string, agencyName: string): Promise<Owner> {
    const body = registration({ email, agency: { name: agencyName, emirate: 'Dubai' } });
    await http().post('/v1/auth/register').send(body).expect(202);
    await http()
      .post('/v1/auth/verify-email')
      .send({ token: tokenFrom(t().emails.at(-1)) })
      .expect(204);
    const auth = await loginAs(email, body.password);
    await enableMfa(auth);
    const me = await http().get('/v1/me').set(auth).expect(200);
    const m = me.body.memberships[0];
    return {
      userId: me.body.user.id,
      tenantId: m.agency.id,
      membershipId: m.id,
      auth,
      h: { ...auth, 'X-Tenant-Id': m.agency.id },
    };
  }

  /** Invites a new person and accepts as them; returns their headers for this agency. */
  async function inviteNew(inviter: Owner, email: string, role: string): Promise<Invited> {
    await http().post('/v1/invitations').set(inviter.h).send({ email, role }).expect(201);
    const token = tokenFrom(t().emails.at(-1));
    const password = 'invited person passphrase';
    const accepted = await http()
      .post('/v1/invitations/accept')
      .send({ token, fullName: `Invited ${role}`, password })
      .expect(200);
    expect(accepted.body).toMatchObject({ tenantId: inviter.tenantId });
    const auth = await loginAs(email, password);
    if (role === 'admin') await enableMfa(auth);
    return {
      membershipId: accepted.body.membershipId as string,
      auth,
      h: { ...auth, 'X-Tenant-Id': inviter.tenantId },
    };
  }

  let permitSeq = 7100000000;
  /** Creates a listing and, unless `draft`, publishes it with a valid permit. */
  async function listing(
    h: Headers,
    overrides: Record<string, unknown> = {},
    opts: { draft?: boolean } = {},
  ): Promise<{ id: string; reference: string }> {
    const res = await http()
      .post('/v1/properties')
      .set(h)
      .send({
        listingType: 'sale',
        propertyType: 'apartment',
        emirate: 'Dubai',
        community: 'Dubai Marina',
        bedrooms: 2,
        bathrooms: 2,
        areaSqft: 1250,
        price: 2_000_000,
        ...overrides,
      })
      .expect(201);
    if (!opts.draft) {
      permitSeq += 1;
      await http()
        .post(`/v1/properties/${res.body.id}/permits`)
        .set(h)
        .send({ authority: 'DLD', permitNumber: String(permitSeq), validUntil: '2099-12-31' })
        .expect(201);
      await http()
        .post(`/v1/properties/${res.body.id}/status`)
        .set(h)
        .send({ status: 'active' })
        .expect(200);
    }
    return { id: res.body.id, reference: res.body.reference };
  }

  let phoneSeq = 1000000;
  /** Creates a contact and a lead on it. */
  async function lead(h: Headers, body: Record<string, unknown> = {}) {
    phoneSeq += 1;
    const c = await http()
      .post('/v1/contacts')
      .set(h)
      .send({ fullName: `Client ${phoneSeq}`, phone: `+97150${phoneSeq}`, source: 'referral' })
      .expect(201);
    const res = await http()
      .post('/v1/leads')
      .set(h)
      .send({ contactId: c.body.id, intent: 'buy', ...body })
      .expect(201);
    return { id: res.body.id as string, contactId: c.body.id as string };
  }

  return { http, loginAs, enableMfa, createOwner, inviteNew, listing, lead };
}
