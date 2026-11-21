import type { INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import sharp from 'sharp';
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
const DAY = 86_400_000;
const PORTAL_KEY = 'k'.repeat(40);

beforeAll(async () => {
  t = await createTestApp({
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    PORTAL_PUBLIC_URL: 'https://portal.example.test',
    PORTAL_API_KEY: PORTAL_KEY,
  });
  app = t.app;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  await t.owner.$executeRawUnsafe('TRUNCATE "public_rate_hit"');
  resetRateLimits(app);
  t.emails.length = 0;
});

interface Agency {
  tenantId: string;
  membershipId: string;
  userId: string;
  h: Record<string, string>;
}

async function createAgency(email: string, name: string): Promise<Agency> {
  const body = registration({
    email,
    fullName: `${name} Agent`,
    agency: { name, emirate: 'Dubai' },
  });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const login = await http()
    .post('/v1/auth/login')
    .send({ email, password: body.password })
    .expect(200);
  const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };
  const setup = await http().post('/v1/me/mfa/totp/setup').set(auth).expect(200);
  const code = new TOTP({
    secret: Secret.fromBase32(setup.body.secret),
    digits: 6,
    period: 30,
  }).generate();
  await http().post('/v1/me/mfa/totp/confirm').set(auth).send({ code }).expect(200);
  const me = await http().get('/v1/me').set(auth).expect(200);
  const m = me.body.memberships[0];
  await t.owner.agency.update({ where: { id: m.agency.id }, data: { status: 'active' } });
  return {
    tenantId: m.agency.id,
    membershipId: m.id,
    userId: me.body.user.id,
    h: { ...auth, 'X-Tenant-Id': m.agency.id },
  };
}

async function publishedListing(
  a: Agency,
  overrides: Record<string, unknown> = {},
  opts: { permit?: boolean } = {},
) {
  const p = await t.owner.property.create({
    data: {
      tenantId: a.tenantId,
      reference: `REF-${Math.random().toString(36).slice(2, 8)}`,
      listingType: 'sale',
      propertyType: 'apartment',
      emirate: 'Dubai',
      community: 'Dubai Marina',
      building: 'Marina Gate 1',
      unitNo: '2304',
      floor: 23,
      title: '2BR with sea view',
      bedrooms: 2,
      bathrooms: 3,
      areaSqft: 1200,
      price: 2_400_000,
      status: 'active',
      listingExpiresAt: new Date(Date.now() + 14 * DAY),
      verifiedAt: new Date(),
      assignedMembershipId: a.membershipId,
      createdBy: a.userId,
      ...overrides,
    },
  });
  if (opts.permit !== false) {
    await t.owner.propertyPermit.create({
      data: {
        tenantId: a.tenantId,
        propertyId: p.id,
        authority: 'DLD',
        permitNumber: `7${Math.floor(Math.random() * 1e9)}`,
        validUntil: new Date(Date.now() + 60 * DAY),
      },
    });
  }
  return p;
}

/** A test photo: a soft gradient in a given colour, optionally with GPS data in its EXIF. */
async function photo(opts: { w?: number; h?: number; hue?: number; gps?: boolean } = {}) {
  const w = opts.w ?? 1200;
  const h = opts.h ?? 900;
  const hue = opts.hue ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g"><stop offset="0" stop-color="hsl(${hue},40%,35%)"/>
    <stop offset="1" stop-color="hsl(${hue},40%,65%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  let img = sharp(Buffer.from(svg)).jpeg({ quality: 90 });
  if (opts.gps) {
    img = img.withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 4/1 0/1' },
    });
  }
  return img.toBuffer();
}

const logoPng = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect x="10" y="10" width="280" height="100" rx="20" fill="#123"/></svg>',
    ),
  )
    .png()
    .toBuffer();

const upload = (a: Agency, propertyId: string, bytes: Buffer, type = 'image/jpeg') =>
  http().post(`/v1/properties/${propertyId}/photos`).set(a.h).set('Content-Type', type).send(bytes);

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const getImage = (url: string, headers: Record<string, string> = {}) =>
  http().get(url).set(headers).buffer(true).parse(binary);

/** Mean absolute difference per channel between two images of the same size. */
async function difference(a: Buffer, b: Buffer) {
  const [ra, rb] = await Promise.all(
    [a, b].map((x) => sharp(x).removeAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  let sum = 0;
  for (let i = 0; i < ra!.data.length; i++) sum += Math.abs(ra!.data[i]! - rb!.data[i]!);
  return sum / ra!.data.length;
}

describe('listing photos', () => {
  it('stores a clean original and shows watermarked copies on the portal', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const res = await upload(a, p.id, await photo({ gps: true })).expect(201);
    expect(res.body).toMatchObject({ position: 0, width: 1200, height: 900, version: 1 });
    const id = res.body.id as string;

    const list = await http().get(`/v1/properties/${p.id}/photos`).set(a.h).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].thumbUrl).toMatch(/^data:image\/webp;base64,/);

    // The original has no location data and no watermark.
    const original = await getImage(`/v1/properties/${p.id}/photos/${id}/original`, a.h).expect(
      200,
    );
    expect(original.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(original.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();

    // The public copy is a watermarked WebP that caches for a year.
    const pub = await getImage(`/v1/public/listing-photos/${id}/display`).expect(200);
    expect(pub.headers['content-type']).toBe('image/webp');
    expect(pub.headers['cache-control']).toContain('immutable');
    expect(pub.headers['content-security-policy']).toBe("default-src 'none'");
    const plain = await sharp(original.body as Buffer)
      .webp({ quality: 82 })
      .toBuffer();
    expect(await difference(pub.body as Buffer, plain)).toBeGreaterThan(0.3);

    // The clean original is never public.
    await http().get(`/v1/public/listing-photos/${id}/original`).expect(404);

    const card = (await http().get('/v1/public/listings').expect(200)).body.data[0];
    expect(card.photos).toEqual([{ id, version: 1, width: 1200, height: 900 }]);
    expect(card.photoCount).toBe(1);
    const detail = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    expect(detail.body.photos).toHaveLength(1);
  });

  it('hides photos of listings the portal cannot show and keeps other agencies out', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    const draft = await publishedListing(a, { status: 'draft' });
    const id = (await upload(a, draft.id, await photo()).expect(201)).body.id as string;
    await http().get(`/v1/public/listing-photos/${id}/display`).expect(404);

    await upload(b, draft.id, await photo({ hue: 120 })).expect(404);
    await http().get(`/v1/properties/${draft.id}/photos`).set(b.h).expect(404);
    await http().get(`/v1/properties/${draft.id}/photos/${id}/original`).set(b.h).expect(404);
    await http().delete(`/v1/properties/${draft.id}/photos/${id}`).set(b.h).expect(404);
    expect(await t.owner.propertyPhoto.count()).toBe(1);
  });

  it('refuses files that are not photos, too small, or already on the listing', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    await http().post(`/v1/properties/${p.id}/photos`).set(a.h).send({ image: 'x' }).expect(415);
    await upload(a, p.id, Buffer.from('<svg onload=alert(1)></svg>'), 'image/svg+xml').expect(415);
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really a png'),
    ]);
    await upload(a, p.id, fakePng, 'image/png').expect(422);
    await upload(a, p.id, await photo({ w: 300, h: 200 })).expect(422);
    const img = await photo();
    await upload(a, p.id, img).expect(201);
    const dup = await upload(a, p.id, img).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_PHOTO');
  });

  it('reorders and deletes photos, keeping positions in sequence', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const ids: string[] = [];
    for (const hue of [0, 120, 240]) {
      ids.push((await upload(a, p.id, await photo({ hue })).expect(201)).body.id as string);
    }
    const order = [ids[2]!, ids[0]!, ids[1]!];
    await http()
      .put(`/v1/properties/${p.id}/photos/order`)
      .set(a.h)
      .send({ ids: order })
      .expect(200);
    await http()
      .put(`/v1/properties/${p.id}/photos/order`)
      .set(a.h)
      .send({ ids: [ids[0]] })
      .expect(400);
    await http().delete(`/v1/properties/${p.id}/photos/${ids[0]}`).set(a.h).expect(204);
    const list = await http().get(`/v1/properties/${p.id}/photos`).set(a.h).expect(200);
    expect(list.body.data.map((x: { id: string; position: number }) => [x.id, x.position])).toEqual(
      [
        [ids[2], 0],
        [ids[1], 1],
      ],
    );
  });

  it('uses the agency logo as the watermark and re-marks existing photos when it changes', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const id = (await upload(a, p.id, await photo()).expect(201)).body.id as string;
    const before = (await getImage(`/v1/public/listing-photos/${id}/display`).expect(200)).body;

    expect((await http().get('/v1/agency/logo').set(a.h).expect(200)).body.logo).toBeNull();
    const set = await http()
      .put('/v1/agency/logo')
      .set(a.h)
      .set('Content-Type', 'image/png')
      .send(await logoPng())
      .expect(200);
    expect(set.body.rerendered).toBe(1);
    const logo = (await http().get('/v1/agency/logo').set(a.h).expect(200)).body.logo;
    expect(logo.dataUrl).toMatch(/^data:image\/png;base64,/);

    const card = (await http().get('/v1/public/listings').expect(200)).body.data[0];
    expect(card.photos[0].version).toBe(2);
    const after = (await getImage(`/v1/public/listing-photos/${id}/display`).expect(200)).body;
    expect(Buffer.compare(before as Buffer, after as Buffer)).not.toBe(0);

    // A blank logo would leave photos unmarked, so it is refused.
    const blank = await sharp({
      create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await http()
      .put('/v1/agency/logo')
      .set(a.h)
      .set('Content-Type', 'image/png')
      .send(blank)
      .expect(422);

    const removed = await http().delete('/v1/agency/logo').set(a.h).expect(200);
    expect(removed.body.rerendered).toBe(1);
    const row = await t.owner.propertyPhoto.findUniqueOrThrow({ where: { id } });
    expect(row.version).toBe(3);
    expect(row.markSha256).toBeNull();
  });
});
