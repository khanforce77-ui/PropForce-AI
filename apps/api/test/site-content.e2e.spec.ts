import type { INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import sharp from 'sharp';
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

async function register(email: string, agencyName: string) {
  const body = registration({ email, agency: { name: agencyName, emirate: 'Dubai' } });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const res = await http()
    .post('/v1/auth/login')
    .send({ email, password: body.password })
    .expect(200);
  const auth: Headers = { Authorization: `Bearer ${res.body.accessToken as string}` };
  const me = await http().get('/v1/me').set(auth).expect(200);
  return { auth, userId: me.body.user.id as string, tenantId: me.body.memberships[0].agency.id };
}

/** A platform admin with two-factor on. */
async function admin(): Promise<Headers> {
  const a = await register('boss@platform.test', 'Platform Co');
  await t.owner.user.update({ where: { id: a.userId }, data: { isPlatformAdmin: true } });
  const setup = await http().post('/v1/me/mfa/totp/setup').set(a.auth).expect(200);
  const code = new TOTP({ secret: Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
  await http()
    .post('/v1/me/mfa/totp/confirm')
    .set(a.auth)
    .send({ code: code.generate() })
    .expect(200);
  return a.auth;
}

const banner = (w = 1600, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2b6cb0' } })
    .jpeg()
    .toBuffer();

describe('platform admin: agencies created by hand', () => {
  it('creates a live agency, invites its owner, edits details; others are refused', async () => {
    const boss = await admin();
    const other = await register('agent@x.test', 'Xray Realty');
    t.emails.length = 0;

    await http()
      .post('/v1/platform/agencies')
      .set(other.auth)
      .send({ name: 'Nope', emirate: 'Dubai' })
      .expect(403);
    await http()
      .post('/v1/platform/agencies')
      .set(boss)
      .send({ name: 'Somewhere', emirate: 'Atlantis' })
      .expect(400);

    const created = await http()
      .post('/v1/platform/agencies')
      .set(boss)
      .send({
        name: 'Gulf Star Properties',
        emirate: 'Dubai',
        orn: '12345',
        plan: 'pro',
        seatLimit: 10,
        ownerEmail: 'owner@gulfstar.test',
      })
      .expect(201);
    const agencyId = created.body.agencyId as string;
    expect(created.body.invitation).toMatchObject({
      email: 'owner@gulfstar.test',
      role: 'owner',
      emailed: true,
    });
    expect(created.body.invitation.inviteUrl).toMatch(/\/accept-invite\?token=[A-Za-z0-9_-]+$/);

    const agency = await t.owner.agency.findUniqueOrThrow({ where: { id: agencyId } });
    expect(agency).toMatchObject({
      status: 'active',
      approvalStatus: 'not_required',
      plan: 'pro',
      seatLimit: 10,
      orn: '12345',
    });

    // The invited owner accepts and becomes the agency's owner.
    const mail = t.emails.find((m) => m.to === 'owner@gulfstar.test');
    expect(mail?.subject).toContain('Gulf Star Properties');
    const accepted = await http()
      .post('/v1/invitations/accept')
      .send({ token: tokenFrom(mail), fullName: 'Sara Owner', password: 'a-long-Passw0rd!' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(accepted.body.tenantId ?? agencyId).toBe(agencyId);
    const membership = await t.owner.membership.findFirstOrThrow({
      where: { tenantId: agencyId, user: { email: 'owner@gulfstar.test' } },
    });
    expect(membership.role).toBe('owner');

    // Inviting someone already in the agency is refused.
    await http()
      .post(`/v1/platform/agencies/${agencyId}/invitations`)
      .set(boss)
      .send({ email: 'owner@gulfstar.test' })
      .expect(409);

    await http()
      .patch(`/v1/platform/agencies/${agencyId}/details`)
      .set(boss)
      .send({ name: 'Gulf Star Real Estate', orn: null })
      .expect(200);
    const edited = await t.owner.agency.findUniqueOrThrow({ where: { id: agencyId } });
    expect(edited).toMatchObject({ name: 'Gulf Star Real Estate', orn: null });

    const log = await t.owner.platformAuditLog.findMany({ select: { action: true } });
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'platform.agency_created',
        'platform.agency_invitation_sent',
        'platform.agency_details_changed',
      ]),
    );
  });
});

describe('website content and platform settings', () => {
  it('saves portal content, validates it and serves it publicly with defaults', async () => {
    const boss = await admin();
    const fresh = await http().get('/v1/public/site').expect(200);
    expect(fresh.body.content.hero.title).toBe('Find your next home in the UAE');
    expect(fresh.body.banners.home_hero).toEqual([]);

    const site = await http().get('/v1/platform/site').set(boss).expect(200);
    const portal = {
      ...site.body.portal,
      hero: { title: 'Dubai homes, verified', subtitle: 'Only permitted listings.' },
      announcement: {
        enabled: true,
        text: 'New: off-plan launches',
        linkUrl: '/new-projects',
        linkLabel: 'See them',
      },
      contact: { email: 'hello@propforce.io', whatsapp: '+971501234567' },
      social: { instagram: 'https://instagram.com/propforce' },
    };
    await http().put('/v1/platform/site/settings/portal').set(boss).send(portal).expect(200);

    // Bad links and unknown fields are refused.
    const bad = await http()
      .put('/v1/platform/site/settings/portal')
      .set(boss)
      .send({ ...portal, announcement: { ...portal.announcement, linkUrl: 'javascript:alert(1)' } })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await http()
      .put('/v1/platform/site/settings/portal')
      .set(boss)
      .send({ ...portal, extra: 1 })
      .expect(400);
    await http().put('/v1/platform/site/settings/nope').set(boss).send({}).expect(404);

    const pub = await http().get('/v1/public/site').expect(200);
    expect(pub.body.content.hero.title).toBe('Dubai homes, verified');
    expect(pub.body.content.announcement.linkUrl).toBe('/new-projects');
  });

  it('applies new-agency defaults at sign-up and shows the app notice to signed-in users', async () => {
    const boss = await admin();
    await http()
      .put('/v1/platform/site/settings/platform')
      .set(boss)
      .send({
        supportEmail: 'support@propforce.io',
        newAgencyDefaults: { plan: 'starter', seatLimit: 3, listingLimit: 25 },
        appNotice: { enabled: true, text: 'Maintenance tonight 2 AM', tone: 'warning' },
      })
      .expect(200);
    const a = await register('new@agency.test', 'New Agency');
    const agency = await t.owner.agency.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(agency).toMatchObject({ plan: 'starter', seatLimit: 3, listingLimit: 25 });

    const notice = await http().get('/v1/notice').set(a.auth).expect(200);
    expect(notice.body.notice).toEqual({ text: 'Maintenance tonight 2 AM', tone: 'warning' });
    await http().get('/v1/notice').expect(401);
  });
});

describe('banners and adverts', () => {
  it('goes live only with an image and when switched on, inside its schedule', async () => {
    const boss = await admin();
    const created = await http()
      .post('/v1/platform/site/banners')
      .set(boss)
      .send({
        placement: 'home_hero',
        kind: 'ad',
        title: 'Emaar Beachfront launch',
        advertiser: 'Emaar',
        linkUrl: 'https://example.com/launch',
        ctaLabel: 'Register interest',
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.active).toBe(false);

    // No image yet: cannot be switched on.
    await http()
      .patch(`/v1/platform/site/banners/${id}`)
      .set(boss)
      .send({ active: true })
      .expect(409);
    await http()
      .put(`/v1/platform/site/banners/${id}/image`)
      .set(boss)
      .set('Content-Type', 'image/jpeg')
      .send(await banner(500, 300))
      .expect(422);
    const withImage = await http()
      .put(`/v1/platform/site/banners/${id}/image`)
      .set(boss)
      .set('Content-Type', 'image/jpeg')
      .send(await banner())
      .expect(200);
    expect(withImage.body).toMatchObject({ imageWidth: 1600, imageHeight: 600 });
    expect(withImage.body.image).toBeUndefined();

    // Still off: not public, and its image is not public either.
    expect((await http().get('/v1/public/site').expect(200)).body.banners.home_hero).toEqual([]);
    await http().get(`/v1/public/site/banners/${id}/image`).expect(404);
    // The admin can preview it.
    const preview = await http().get(`/v1/platform/site/banners/${id}/image`).set(boss).expect(200);
    expect(preview.headers['content-type']).toBe('image/webp');

    await http()
      .patch(`/v1/platform/site/banners/${id}`)
      .set(boss)
      .send({ active: true })
      .expect(200);
    const live = (await http().get('/v1/public/site').expect(200)).body.banners.home_hero;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      id,
      kind: 'ad',
      advertiser: 'Emaar',
      hasLink: true,
      ctaLabel: 'Register interest',
    });
    expect(live[0].linkUrl).toBeUndefined();
    await http().get(`/v1/public/site/banners/${id}/image`).expect(200);

    // Clicks are counted and return the destination.
    const click = await http().post(`/v1/public/site/banners/${id}/click`).expect(200);
    expect(click.body.url).toBe('https://example.com/launch');
    expect((await t.owner.siteBanner.findUniqueOrThrow({ where: { id } })).clicks).toBe(1);

    // Scheduled to end in the past: gone from the public site.
    await http()
      .patch(`/v1/platform/site/banners/${id}`)
      .set(boss)
      .send({ startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z' })
      .expect(200);
    expect((await http().get('/v1/public/site').expect(200)).body.banners.home_hero).toEqual([]);
    await http().post(`/v1/public/site/banners/${id}/click`).expect(404);
    await http()
      .patch(`/v1/platform/site/banners/${id}`)
      .set(boss)
      .send({ endsAt: '2019-01-01T00:00:00Z' })
      .expect(400);

    // Unsafe links are refused.
    await http()
      .post('/v1/platform/site/banners')
      .set(boss)
      .send({ placement: 'home_strip', title: 'x', linkUrl: 'http://insecure.test' })
      .expect(400);
    await http()
      .post('/v1/platform/site/banners')
      .set(boss)
      .send({ placement: 'home_strip', title: 'x', linkUrl: '//evil.test' })
      .expect(400);

    const list = await http().get('/v1/platform/site').set(boss).expect(200);
    expect(list.body.banners).toHaveLength(1);
    await http().delete(`/v1/platform/site/banners/${id}`).set(boss).expect(204);
    await http().delete(`/v1/platform/site/banners/${id}`).set(boss).expect(404);
  });
});
