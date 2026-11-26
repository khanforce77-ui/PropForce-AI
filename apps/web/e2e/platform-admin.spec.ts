import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';
import { join } from 'node:path';
import { linkFromEmail } from './mailpit';

const OWNER_DB_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://propforce:propforce_dev_only@localhost:5432/propforce';
const run = Date.now().toString(36);
const admin = { name: 'Ali Admin', email: `admin-${run}@e2e.test`, password: 'e2e platform admin' };

/** The platform-admin flag is only ever set directly in the database, never through the API. */
async function makePlatformAdmin(email: string) {
  const client = new pg.Client({ connectionString: OWNER_DB_URL });
  await client.connect();
  try {
    await client.query('UPDATE "user" SET is_platform_admin = true WHERE email = $1', [email]);
  } finally {
    await client.end();
  }
}

async function setFlag(key: string, enabled: boolean) {
  const client = new pg.Client({ connectionString: OWNER_DB_URL });
  await client.connect();
  try {
    await client.query('UPDATE feature_flag SET enabled = $2 WHERE key = $1', [key, enabled]);
  } finally {
    await client.end();
  }
}

test('a platform admin sees all agencies, runs the approval queue and suspends an agency', async ({
  page,
  browser,
}) => {
  // Start from the default (approval off), even if an earlier run was interrupted.
  await setFlag('platform.require_agency_approval', false);
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(admin.name);
  await page.getByLabel('Work email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByLabel('Agency name').fill(`Admin Realty ${run}`);
  await page.getByLabel('Emirate').selectOption('Dubai');
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole('button', { name: 'Create agency' }).click();
  await expect(page.getByText('We sent a verification link')).toBeVisible();
  await page.goto(await linkFromEmail(admin.email, /Verify your email/));
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await makePlatformAdmin(admin.email);

  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  await page.getByLabel('6-digit code from the app').fill(totp.generate());
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('button', { name: 'I saved them, continue' }).click();

  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole('heading', { name: 'PropForce Control' })).toBeVisible();
  await page.getByRole('button', { name: 'Agencies', exact: true }).click();
  await expect(page.getByText(`Admin Realty ${run}`)).toBeVisible();
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(page.getByText(admin.email).first()).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();

  // Turn on "new agencies need approval" from Settings.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const approvalSwitch = page.getByRole('switch', { name: /need my approval/ });
  await expect(approvalSwitch).not.toBeChecked();
  await approvalSwitch.check();
  await expect(page.getByText(/Setting saved: .* is on\./)).toBeVisible();

  try {
    // A new agency signs up and finishes setup in another browser; it waits for approval.
    const owner = { email: `queue-${run}@e2e.test`, password: 'e2e queue owner pass' };
    const agencyName = `Queue Realty ${run}`;
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/register');
    await ownerPage.getByLabel('Your full name').fill('Noor Owner');
    await ownerPage.getByLabel('Work email').fill(owner.email);
    await ownerPage.getByLabel('Password').fill(owner.password);
    await ownerPage.getByLabel('Agency name').fill(agencyName);
    await ownerPage.getByLabel('Emirate').selectOption('Abu Dhabi');
    await ownerPage.getByLabel(/I accept the terms/).check();
    await ownerPage.getByRole('button', { name: 'Create agency' }).click();
    await expect(ownerPage.getByText('We sent a verification link')).toBeVisible();
    await ownerPage.goto(await linkFromEmail(owner.email, /Verify your email/));
    await expect(ownerPage.getByText('Your email is verified')).toBeVisible();
    await ownerPage.goto('/login');
    await ownerPage.getByLabel('Email').fill(owner.email);
    await ownerPage.getByLabel('Password').fill(owner.password);
    await ownerPage.getByRole('button', { name: 'Sign in' }).click();
    await ownerPage.getByRole('button', { name: 'Set up authenticator app' }).click();
    const ownerSecret = (await ownerPage.getByTestId('totp-secret').textContent())!.trim();
    const ownerTotp = new TOTP({ secret: Secret.fromBase32(ownerSecret), digits: 6, period: 30 });
    await ownerPage.getByLabel('6-digit code from the app').fill(ownerTotp.generate());
    await ownerPage.getByRole('button', { name: 'Turn on' }).click();
    await ownerPage.getByRole('button', { name: 'I saved them, continue' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Set up your agency' })).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Finish setup' }).click();
    await expect(ownerPage.getByText(/waiting for PropForce approval/)).toBeVisible();

    // The admin approves it from the queue.
    await page.reload();
    const queued = page
      .getByRole('region', { name: 'Approval queue' })
      .getByRole('listitem')
      .filter({ hasText: agencyName });
    await expect(queued).toBeVisible();
    await queued.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(`${agencyName} approved.`)).toBeVisible();
    await expect(queued).toHaveCount(0);
    await ownerPage.reload();
    await expect(ownerPage.getByText(/waiting for PropForce approval/)).toHaveCount(0);

    // The admin suspends it with a reason; the owner sees the notice.
    await page.getByRole('button', { name: 'Agencies', exact: true }).click();
    const row = page.getByRole('listitem').filter({ hasText: agencyName });
    await row.getByRole('button', { name: 'Suspend' }).click();
    await row.getByLabel(/Reason/).fill('Trade licence expired');
    await row.getByRole('button', { name: 'Confirm suspension' }).click();
    await expect(page.getByText(`${agencyName} suspended.`)).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole('heading', { name: 'Your agency is suspended' }),
    ).toBeVisible();
    await expect(ownerPage.getByText('Reason: Trade licence expired')).toBeVisible();

    // The admin can open any agency (even a suspended one) and work in it.
    await row.getByRole('link', { name: /Open agency/ }).click();
    await expect(page.getByText(`You are viewing ${agencyName} as platform admin.`)).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Contacts' })
      .click();
    await page.getByRole('button', { name: 'Add contact' }).click();
    await page.getByLabel('Full name').fill('Admin Added');
    await page.getByLabel('Phone', { exact: true }).fill('050 111 2233');
    await page.getByRole('button', { name: 'Save contact' }).click();
    await expect(page.getByRole('heading', { name: 'Admin Added' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to platform admin' }).click();

    // Every action shows up in the activity log.
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByText('platform.agency_suspended').first()).toBeVisible();
    await expect(page.getByText('platform.agency_approved').first()).toBeVisible();
    await expect(page.getByText('platform.setting_changed').first()).toBeVisible();
    await expect(page.getByText('agency_data.contact.created').first()).toBeVisible();
    await ownerContext.close();
  } finally {
    await setFlag('platform.require_agency_approval', false);
  }

  // The admin lists a property directly, under PropForce Direct.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add listing' }).first().click();
  await expect(page.getByLabel('Property type')).toBeVisible();
  await page.getByLabel('Property type').selectOption('villa');
  await page.getByLabel('Community').fill('Arabian Ranches');
  await page.getByLabel('Building').fill(`Direct Villa ${run}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page.getByText('You are in PropForce Direct.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to platform admin' }).click();
  await page.getByRole('button', { name: 'All listings', exact: true }).click();
  const directRow = page.getByRole('row').filter({ hasText: `Direct Villa ${run}` });
  await expect(directRow).toContainText('PropForce Direct');

  // The overview shows trends and the roadmap; there is no agency link for the admin.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Most active agencies' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'New listings' })).toBeVisible();
  await expect(page.getByText('Lead booster')).toBeVisible();
  await expect(page.getByRole('link', { name: 'My agency dashboard' })).toHaveCount(0);

  // The admin adds an agency by hand and invites its owner.
  await page.getByRole('button', { name: 'Agencies', exact: true }).click();
  await page.getByRole('button', { name: 'Add agency' }).click();
  await page.getByLabel('Agency name').fill(`Manual Realty ${run}`);
  await page.getByLabel('ORN (RERA office number)').fill('98765');
  await page.getByLabel("Owner's email (optional)").fill(`manual-${run}@e2e.test`);
  await page.getByRole('button', { name: 'Create agency' }).click();
  await expect(
    page.getByText(`Manual Realty ${run} created. Invitation emailed to manual-${run}@e2e.test.`),
  ).toBeVisible();
  const manualRow = page.getByRole('listitem').filter({ hasText: `Manual Realty ${run}` });
  await expect(manualRow).toContainText('ORN 98765');
  expect(await linkFromEmail(`manual-${run}@e2e.test`, /invited to own/)).toContain(
    '/accept-invite?token=',
  );
  await expect(manualRow).toContainText('No owner yet');

  // An empty agency can be deleted for good, after typing its name.
  await manualRow.getByRole('button', { name: 'Delete' }).click();
  await expect(manualRow.getByText(`Delete Manual Realty ${run} for good?`)).toBeVisible();
  const confirmDelete = manualRow.getByRole('button', { name: 'Delete agency' });
  await expect(confirmDelete).toBeDisabled();
  await manualRow.getByLabel(/Type the agency name/).fill(`Manual Realty ${run}`);
  await confirmDelete.click();
  await expect(page.getByText(`Manual Realty ${run} was deleted.`)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: `Manual Realty ${run}` })).toHaveCount(
    0,
  );

  // Website: change the home page heading, then add a banner with an image and switch it on.
  await page.getByRole('button', { name: 'Website', exact: true }).click();
  await page.getByRole('tab', { name: 'Text, contact & SEO' }).click();
  await page.getByLabel('Heading', { exact: true }).fill(`Dubai homes ${run}`);
  await page.getByRole('button', { name: 'Save website content' }).click();
  await expect(page.getByText(/Website content saved/)).toBeVisible();
  await page.getByRole('tab', { name: 'Banners & ads' }).click();
  await page.getByRole('button', { name: 'Add banner or ad' }).click();
  await page.getByRole('radio', { name: /Paid advert/ }).click();
  await page.getByLabel('Title', { exact: true }).fill(`Launch ${run}`);
  await page.getByLabel('Advertiser').fill('Partner Developer');
  await page.getByLabel('Link (optional)').fill('/new-projects');
  await page
    .getByLabel('Image', { exact: true })
    .setInputFiles(join(__dirname, 'fixtures', 'living-room.jpg'));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`“Launch ${run}” added.`, { exact: false })).toBeVisible();
  const bannerRow = page.getByRole('listitem').filter({ hasText: `Launch ${run}` });
  await expect(bannerRow.getByText('Off', { exact: true })).toBeVisible();
  await bannerRow.getByRole('button', { name: 'Switch on' }).click();
  await expect(bannerRow.getByText('Live', { exact: true })).toBeVisible();
  await expect(bannerRow.getByRole('img')).toBeVisible();

  // Settings: a notice to every agency shows inside the agency app.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Show the notice' }).check();
  await page.getByLabel('Message').fill(`Maintenance ${run}`);
  await page.getByRole('button', { name: 'Save platform settings' }).click();
  await expect(page.getByText('Platform settings saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Open PropForce Direct' }).click();
  await expect(page.getByText(`Maintenance ${run}`)).toBeVisible();
});
