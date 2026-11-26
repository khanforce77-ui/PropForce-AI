import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KYC_READER, type KycReading, type ScriptedKycReader } from '../src/kyc/kyc-reader';
import { actors, type Headers, type Owner } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const { createOwner, inviteNew } = actors(() => t);
const reader = () => app.get<ScriptedKycReader>(KYC_READER);

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', AI_PROVIDER: 'fake' });
  app = t.app;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  resetRateLimits(app);
  reader().reset();
  t.emails.length = 0;
  await t.owner.featureFlag.update({
    where: { key: 'platform.require_agency_documents' },
    data: { enabled: true },
  });
});

const pdf = Buffer.from('%PDF-1.4\n% test document\n%%EOF');
const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;
const logoPng = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#123"/></svg>',
    ),
  )
    .png()
    .toBuffer();

const reading = (over: Partial<KycReading>): KycReading => ({
  documentKind: 'other',
  legible: true,
  companyName: null,
  personNames: [],
  documentNumber: null,
  issueDate: null,
  expiryDate: null,
  issuer: null,
  activities: [],
  concerns: '',
  ...over,
});

function upload(h: Headers, query: Record<string, string>, body: Buffer = pdf) {
  return http()
    .put('/v1/agency/kyc/documents')
    .query({ fileName: 'scan.pdf', ...query })
    .set(h)
    .set('Content-Type', 'application/pdf')
    .send(body);
}

async function platformAdmin(): Promise<Owner> {
  const admin = await createOwner('root@platform.test', 'Platform HQ');
  await t.owner.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
  return admin;
}

/** Fills in every required item for a one-owner, one-broker agency. */
async function completeKyc(a: Owner) {
  await http()
    .patch('/v1/agency')
    .set(a.h)
    .send({ tradeLicenseNo: '1234567', orn: '98765', website: 'alpharealty.ae' })
    .expect(200);
  await http()
    .put('/v1/agency/logo')
    .set(a.h)
    .set('Content-Type', 'image/png')
    .send(await logoPng())
    .expect(200);
  for (const type of ['trade_license', 'ejari', 'orn_certificate']) {
    await upload(a.h, { type, expiresAt: nextYear }).expect(200);
  }
  await upload(a.h, { type: 'moa' }).expect(200);
  const owner = await http()
    .post('/v1/agency/kyc/owners')
    .set(a.h)
    .send({ fullName: 'Omar Khalid Rahman', nationality: 'UAE', sharePercent: 100 })
    .expect(201);
  await upload(a.h, { type: 'owner_passport', ownerId: owner.body.id, expiresAt: nextYear }).expect(
    200,
  );
  await upload(a.h, {
    type: 'owner_emirates_id',
    ownerId: owner.body.id,
    expiresAt: nextYear,
  }).expect(200);
  const emp = await http()
    .post('/v1/agency/kyc/employees')
    .set(a.h)
    .send({ fullName: 'Sara Ahmed', designation: 'Broker', isBroker: true, brn: '55555' })
    .expect(201);
  await upload(a.h, {
    type: 'employee_emirates_id',
    employeeId: emp.body.id,
    expiresAt: nextYear,
  }).expect(200);
  await upload(a.h, {
    type: 'employee_brn_card',
    employeeId: emp.body.id,
    expiresAt: nextYear,
  }).expect(200);
  return { ownerId: owner.body.id as string, employeeId: emp.body.id as string };
}

describe('agency registration documents', () => {
  it('blocks submitting until every required document is on file, then waits for approval', async () => {
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const empty = await http().get('/v1/agency/kyc').set(a.h).expect(200);
    expect(empty.body.required).toBe(true);
    expect(empty.body.checklist.complete).toBe(false);
    expect(empty.body.checklist.missing).toContain('Trade licence');

    const blocked = await http().post('/v1/agency/onboarding/complete').set(a.h).expect(409);
    expect(blocked.body.code).toBe('KYC_INCOMPLETE');
    expect(blocked.body.detail).toMatch(/Trade licence/);

    // Expiry is required, and an expired document is refused.
    const noExpiry = await upload(a.h, { type: 'trade_license' }).expect(400);
    expect(noExpiry.body.code).toBe('VALIDATION_FAILED');
    await upload(a.h, { type: 'trade_license', expiresAt: '2020-01-01' }).expect(400);
    // Owner documents need an owner.
    await upload(a.h, { type: 'owner_passport', expiresAt: nextYear }).expect(400);

    await completeKyc(a);
    const full = await http().get('/v1/agency/kyc').set(a.h).expect(200);
    expect(full.body.checklist).toMatchObject({ complete: true, approved: false, missing: [] });
    // The agency never sees the AI read-out.
    expect(full.body.documents[0].aiResult).toBeUndefined();

    const done = await http().post('/v1/agency/onboarding/complete').set(a.h).expect(200);
    expect(done.body).toMatchObject({ status: 'pending', approvalStatus: 'pending' });
  });

  it('replaces a single-copy document on re-upload and keeps files private to owners/admins', async () => {
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const first = await upload(a.h, { type: 'moa' }).expect(200);
    const second = await upload(a.h, { type: 'moa' }).expect(200);
    const kyc = await http().get('/v1/agency/kyc').set(a.h).expect(200);
    expect(kyc.body.documents.map((d: { id: string }) => d.id)).toEqual([second.body.id]);
    await http().get(`/v1/agency/kyc/documents/${first.body.id}/file`).set(a.h).expect(404);
    const file = await http()
      .get(`/v1/agency/kyc/documents/${second.body.id}/file`)
      .set(a.h)
      .expect(200);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-type']).toMatch(/application\/pdf/);

    // An agent of the same agency cannot see the documents.
    const agent = await inviteNew(a, 'agent@alpha.test', 'agent');
    await http().get('/v1/agency/kyc').set(agent.h).expect(403);
    await http().get(`/v1/agency/kyc/documents/${second.body.id}/file`).set(agent.h).expect(403);

    // Another agency cannot read it either.
    const b = await createOwner('owner@bravo.test', 'Bravo Homes');
    await http().get(`/v1/agency/kyc/documents/${second.body.id}/file`).set(b.h).expect(404);
    // Nor a non-admin through the platform route.
    await http()
      .get(`/v1/platform/agency-documents/${second.body.id}/file`)
      .set(b.auth)
      .expect(403);
  });

  it('AI reads each file, the reviewer sees findings, sends a fix list and approves', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const { ownerId } = await completeKyc(a);
    await http().post('/v1/agency/onboarding/complete').set(a.h).expect(200);

    // The agency cannot be approved while documents wait for review.
    const early = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/approve`)
      .set(admin.auth)
      .expect(409);
    expect(early.body.code).toBe('KYC_NOT_APPROVED');

    const queue = await http().get('/v1/platform/agency-documents').set(admin.auth).expect(200);
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(a.tenantId);

    // Documents are read oldest first: trade licence, ejari, orn, moa, passport, EID, ...
    reader().script(
      reading({
        documentKind: 'trade_license',
        companyName: 'Alpha Realty L.L.C',
        documentNumber: '1234567',
        expiryDate: nextYear,
        activities: ['Real Estate Buying & Selling Brokerage'],
        personNames: ['Omar Khalid Rahman'],
      }),
      reading({ documentKind: 'ejari', companyName: 'Alpha Realty', expiryDate: nextYear }),
      reading({
        documentKind: 'orn_certificate',
        companyName: 'Alpha Realty',
        documentNumber: '98765',
        expiryDate: nextYear,
      }),
      reading({
        documentKind: 'moa',
        companyName: 'Alpha Realty',
        personNames: ['Omar Khalid Rahman'],
      }),
      // Wrong person on the passport.
      reading({ documentKind: 'passport', personNames: ['Ahmed Saleh'], expiryDate: nextYear }),
      reading({
        documentKind: 'emirates_id',
        personNames: ['Omar Khalid Rahman'],
        expiryDate: nextYear,
      }),
    );
    const run = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/kyc/check`)
      .set(admin.auth)
      .send({})
      .expect(200);
    expect(run.body).toMatchObject({ checked: 6, remaining: 2 });
    expect(reader().inputs[0]).toMatchObject({
      expected: 'Trade licence',
      contentType: 'application/pdf',
    });

    const review = await http()
      .get(`/v1/platform/agencies/${a.tenantId}/kyc`)
      .set(admin.auth)
      .expect(200);
    const problems = review.body.findings.filter(
      (f: { severity: string }) => f.severity === 'problem',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/Ahmed Saleh/);
    expect(review.body.suggestedInstructions).toMatch(/Ahmed Saleh/);
    const trade = review.body.documents.find((d: { type: string }) => d.type === 'trade_license');
    expect(trade.aiReading.documentNumber).toBe('1234567');

    // Approve the clean ones in one go: everything AI read without issues (5 of 6).
    const bulk = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/kyc/approve-clean`)
      .set(admin.auth)
      .expect(200);
    expect(bulk.body.approved).toBe(5);

    // Reject the passport and tell the agency what to fix.
    const passport = review.body.documents.find(
      (d: { type: string }) => d.type === 'owner_passport',
    );
    await http()
      .post(`/v1/platform/agency-documents/${passport.id}/decision`)
      .set(admin.auth)
      .send({ decision: 'reject' })
      .expect(400);
    await http()
      .post(`/v1/platform/agency-documents/${passport.id}/decision`)
      .set(admin.auth)
      .send({ decision: 'reject', reason: 'Passport belongs to someone else' })
      .expect(200);
    const sent = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/kyc/instructions`)
      .set(admin.auth)
      .send({ text: 'Upload the passport of Omar Khalid Rahman.' })
      .expect(200);
    expect(sent.body.emailed).toBe(1);
    expect(t.emails.at(-1)?.text).toMatch(/passport of Omar/);

    const agencyView = await http().get('/v1/agency/kyc').set(a.h).expect(200);
    expect(agencyView.body.instructions).toBe('Upload the passport of Omar Khalid Rahman.');
    expect(agencyView.body.checklist.complete).toBe(false);

    // The agency uploads the right passport; it waits for review again.
    const fixed = await upload(a.h, {
      type: 'owner_passport',
      ownerId,
      expiresAt: nextYear,
    }).expect(200);
    reader().script(
      reading({
        documentKind: 'passport',
        personNames: ['OMAR KHALID RAHMAN'],
        expiryDate: nextYear,
      }),
    );
    await http().post(`/v1/agency/kyc/documents/${fixed.body.id}/check`).set(a.h).expect(200);

    // Approve the rest by hand, then the agency.
    const rest = (
      await http().get(`/v1/platform/agencies/${a.tenantId}/kyc`).set(admin.auth).expect(200)
    ).body.documents.filter((d: { status: string }) => d.status === 'pending');
    expect(rest).toHaveLength(3);
    for (const d of rest) {
      await http()
        .post(`/v1/platform/agency-documents/${d.id}/decision`)
        .set(admin.auth)
        .send({ decision: 'approve' })
        .expect(200);
    }
    const approved = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/approve`)
      .set(admin.auth)
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'active', approvalStatus: 'approved' });

    // An approved document cannot be deleted by the agency.
    await http().delete(`/v1/agency/kyc/documents/${fixed.body.id}`).set(a.h).expect(409);

    const actions = (
      await t.owner.auditLog.findMany({ where: { tenantId: a.tenantId }, select: { action: true } })
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'agency.kyc_document_uploaded',
        'agency.kyc_document_ai_checked',
        'agency.kyc_documents_bulk_approved',
        'agency.kyc_document_rejected',
        'agency.kyc_instructions_sent',
        'platform.agency_approved',
      ]),
    );
  });

  it('with the flag off, onboarding works as before', async () => {
    await t.owner.featureFlag.update({
      where: { key: 'platform.require_agency_documents' },
      data: { enabled: false },
    });
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const done = await http().post('/v1/agency/onboarding/complete').set(a.h).expect(200);
    expect(done.body).toMatchObject({ status: 'active' });
    expect((await http().get('/v1/agency/kyc').set(a.h).expect(200)).body.required).toBe(false);
  });

  it('a non-resident owner needs no Emirates ID', async () => {
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    await http()
      .post('/v1/agency/kyc/owners')
      .set(a.h)
      .send({ fullName: 'John Smith', uaeResident: false })
      .expect(201);
    const kyc = await http().get('/v1/agency/kyc').set(a.h).expect(200);
    const keys = kyc.body.checklist.items.map((i: { type?: string }) => i.type);
    expect(keys).toContain('owner_passport');
    expect(keys).not.toContain('owner_emirates_id');
  });
});
