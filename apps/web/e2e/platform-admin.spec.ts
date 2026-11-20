import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';
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

test('a platform admin lands on the platform dashboard and sees all agencies', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Platform admin' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(`Admin Realty ${run}`) })).toBeVisible();
  await expect(page.getByText(admin.email).first()).toBeVisible();

  // The agency dashboard is still one click away.
  await page.getByRole('link', { name: 'My agency dashboard' }).click();
  await expect(page.getByRole('link', { name: 'Platform admin dashboard' })).toBeVisible();
});
