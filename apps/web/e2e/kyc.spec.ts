import { expect, test, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';
import { join } from 'node:path';
import { linkFromEmail } from './mailpit';

const OWNER_DB_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://propforce:propforce_dev_only@localhost:5432/propforce';
const run = Date.now().toString(36);
const fixtures = join(__dirname, 'fixtures');
/** Set SHOTS_DIR to save screenshots of the screens (for reviews). */
const shots = process.env.SHOTS_DIR;
const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;

async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: OWNER_DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}
const setFlag = (enabled: boolean) =>
  sql("UPDATE feature_flag SET enabled = $1 WHERE key = 'platform.require_agency_documents'", [
    enabled,
  ]);

async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
  agency: string,
) {
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(who.name);
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByLabel('Agency name').fill(agency);
  await page.getByLabel('Emirate').selectOption('Dubai');
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole('button', { name: 'Create agency' }).click();
  await expect(page.getByText('We sent a verification link')).toBeVisible();
  await page.goto(await linkFromEmail(who.email, /Verify your email/));
  await expect(page.getByText('Your email is verified')).toBeVisible();
}

async function signInWithNewMfa(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  await page.getByLabel('6-digit code from the app').fill(totp.generate());
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('button', { name: 'I saved them, continue' }).click();
}

const reading = (over: Record<string, unknown>) =>
  JSON.stringify({
    documentKind: 'other',
    legible: true,
    companyName: null,
    personNames: [],
    documentNumber: null,
    issueDate: null,
    expiryDate: nextYear,
    issuer: null,
    activities: [],
    concerns: '',
    ...over,
  });

test('a Dubai agency uploads its registration documents and PropForce reviews them', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await setFlag(true);
  const owner = {
    name: 'Omar Rahman',
    email: `kyc-owner-${run}@e2e.test`,
    password: 'e2e kyc owner pass',
  };
  const agencyName = `Palm Keys Realty ${run}`;
  try {
    await signUp(page, owner, agencyName);
    await signInWithNewMfa(page, owner);

    // Onboarding asks for the documents instead of "Finish setup".
    await expect(page.getByRole('heading', { name: 'Set up your agency' })).toBeVisible();
    await expect(page.getByText(/0 of \d+ done/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send for review' })).toBeDisabled();

    await page.getByLabel('Trade licence number').fill('1234567');
    await page.getByLabel('ORN (office registration number)').fill('98765');
    await page.getByLabel('Website').fill('palmkeys.ae');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Company details saved.')).toBeVisible();

    await page
      .locator('input[type=file][accept^="image/png"]')
      .setInputFiles(join(fixtures, 'agency-logo.png'));
    await expect(page.getByAltText('Agency logo')).toBeVisible();

    await page.getByLabel('Trade licence file').setInputFiles(join(fixtures, 'permit.pdf'));
    await page.getByLabel('Trade licence expiry date').fill(nextYear);
    await page.getByRole('button', { name: 'Upload' }).first().click();
    await expect(page.getByText('Trade licence uploaded. PropForce will review it.')).toBeVisible();

    await page.getByLabel('Owner full name').fill('Omar Khalid Rahman');
    await page.getByLabel('Nationality').fill('UAE');
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.getByText('Owner added.', { exact: false })).toBeVisible();

    await page.getByLabel('Employee full name').fill('Sara Ahmed');
    await page.getByLabel('BRN').fill('55555');
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByText('Employee added.', { exact: false })).toBeVisible();
    if (shots) await page.screenshot({ path: join(shots, '1-agency-uploads.png'), fullPage: true });

    // The rest is seeded straight into the database, with AI read-outs, to keep the test short.
    const [agency] = await sql('SELECT id FROM agency WHERE name = $1', [agencyName]);
    const [user] = await sql('SELECT id FROM "user" WHERE email = $1', [owner.email]);
    const [o] = await sql('SELECT id FROM agency_owner WHERE tenant_id = $1', [agency.id]);
    const [e] = await sql('SELECT id FROM agency_employee WHERE tenant_id = $1', [agency.id]);
    const seed = async (type: string, r: string, ids: { owner?: string; employee?: string } = {}) =>
      sql(
        `INSERT INTO agency_document (id, tenant_id, type, owner_id, employee_id, expires_at, content_type, file_name, bytes, sha256, uploaded_by, ai_status, ai_result, ai_checked_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'application/pdf', $6, $7, 'x', $8, 'checked', $9::jsonb, now())`,
        [
          agency.id,
          type,
          ids.owner ?? null,
          ids.employee ?? null,
          type === 'moa' ? null : nextYear,
          `${type}.pdf`,
          Buffer.from('%PDF-1.4\n%%EOF'),
          user.id,
          r,
        ],
      );
    await sql(
      `UPDATE agency_document SET ai_status = 'checked', ai_checked_at = now(), ai_result = $2::jsonb WHERE tenant_id = $1 AND type = 'trade_license'`,
      [
        agency.id,
        reading({
          documentKind: 'trade_license',
          companyName: `Palm Keys Realty ${run} L.L.C`,
          documentNumber: '1234567',
          personNames: ['Omar Khalid Rahman', 'Fatima Noor'],
          activities: ['Real Estate Buying & Selling Brokerage'],
          issuer: 'Dubai Economy and Tourism',
        }),
      ],
    );
    await seed(
      'moa',
      reading({
        documentKind: 'moa',
        companyName: agencyName,
        personNames: ['Omar Khalid Rahman', 'Fatima Noor'],
        expiryDate: null,
      }),
    );
    await seed('ejari', reading({ documentKind: 'ejari', companyName: agencyName }));
    await seed(
      'orn_certificate',
      reading({
        documentKind: 'orn_certificate',
        companyName: agencyName,
        documentNumber: '98765',
      }),
    );
    await seed(
      'owner_passport',
      reading({ documentKind: 'passport', personNames: ['OMAR KHALID RAHMAN'] }),
      { owner: o.id },
    );
    await seed(
      'owner_emirates_id',
      reading({ documentKind: 'emirates_id', personNames: ['Ahmed Saleh'], legible: false }),
      { owner: o.id },
    );
    await seed(
      'employee_emirates_id',
      reading({ documentKind: 'emirates_id', personNames: ['Sara Ahmed'] }),
      { employee: e.id },
    );
    await seed(
      'employee_brn_card',
      reading({
        documentKind: 'broker_card',
        personNames: ['Sara Ahmed'],
        documentNumber: '55555',
      }),
      { employee: e.id },
    );

    await page.reload();
    await expect(page.getByText(/Everything is uploaded/)).toBeVisible();
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('waiting for PropForce approval')).toBeVisible();

    // PropForce reviews in another browser.
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    const adminUser = {
      name: 'Ali Admin',
      email: `kyc-admin-${run}@e2e.test`,
      password: 'e2e kyc admin pass',
    };
    await signUp(admin, adminUser, `KYC Admin HQ ${run}`);
    await sql('UPDATE "user" SET is_platform_admin = true WHERE email = $1', [adminUser.email]);
    await signInWithNewMfa(admin, adminUser);
    await expect(admin).toHaveURL(/\/app\/admin$/);
    await admin.getByRole('button', { name: 'Agency documents', exact: true }).click();
    await admin
      .getByText(agencyName, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")]')
      .getByRole('button', { name: 'Review' })
      .click();
    await expect(admin.getByRole('heading', { name: agencyName })).toBeVisible();
    await expect(
      admin.getByRole('listitem').filter({ hasText: /The name on the document is “Ahmed Saleh”/ }),
    ).toBeVisible();
    await expect(admin.getByText(/Fatima Noor/).first()).toBeVisible();
    await expect(admin.getByText('AI can make mistakes', { exact: false })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Approve agency (go live)' })).toBeDisabled();
    if (shots) await admin.screenshot({ path: join(shots, '2-admin-review.png'), fullPage: true });

    await admin.getByRole('button', { name: 'Approve all with no AI findings' }).click();
    await expect(admin.getByText(/Approved \d+ documents? with no AI findings/)).toBeVisible();

    await admin.getByRole('button', { name: 'Send to agency' }).click();
    await expect(admin.getByText(/Sent to the agency/)).toBeVisible();
    await adminCtx.close();

    // The agency sees what to fix on its documents page.
    await page.goto(page.url().replace(/\/app\/([^/]+).*/, '/app/$1/settings/documents'));
    await expect(page.getByText('PropForce asked you to fix:')).toBeVisible();
    await expect(page.getByText(/Ahmed Saleh/).first()).toBeVisible();
    if (shots)
      await page.screenshot({ path: join(shots, '3-agency-fix-list.png'), fullPage: true });
  } finally {
    await setFlag(false);
  }
});
