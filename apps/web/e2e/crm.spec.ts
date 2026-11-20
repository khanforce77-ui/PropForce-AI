import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { linkFromEmail } from './mailpit';

const run = Date.now().toString(36);
const owner = {
  name: 'Hamad Saeed',
  email: `crm-${run}@e2e.test`,
  password: 'e2e crm passphrase',
};

test('owner adds a contact with consent, creates a lead and moves it through the pipeline', async ({
  page,
}) => {
  // A fresh, onboarded agency.
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByLabel('Agency name').fill(`Creek Realty ${run}`);
  await page.getByLabel('Emirate').selectOption('Dubai');
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole('button', { name: 'Create agency' }).click();
  await expect(page.getByText('We sent a verification link')).toBeVisible();
  await page.goto(await linkFromEmail(owner.email, /Verify your email/));
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  await page.getByLabel('6-digit code from the app').fill(totp.generate());
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('button', { name: 'I saved them, continue' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText('Your agency is set up. Invite your team.')).toBeVisible();

  // Add a contact with WhatsApp consent.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Contacts' }).click();
  await expect(page.getByText('No contacts yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Full name').fill('Aisha Buyer');
  await page.getByLabel('Phone', { exact: true }).fill('050 765 4321');
  await page.getByLabel('Source').selectOption('referral');
  await page.getByLabel('WhatsApp: replies & updates').check();
  await page.getByLabel('How did they agree?').fill('asked on the phone');
  await page.getByRole('button', { name: 'Save contact' }).click();

  await expect(page.getByRole('heading', { name: 'Aisha Buyer' })).toBeVisible();
  await expect(page.getByText('+971507654321')).toBeVisible();
  const waService = page.getByRole('listitem').filter({ hasText: 'WhatsApp · Replies & updates' });
  await expect(waService.getByText('Granted')).toBeVisible();
  const waMarketing = page.getByRole('listitem').filter({ hasText: 'WhatsApp · Marketing' });
  await expect(waMarketing.getByText('Not asked')).toBeVisible();

  // Withdraw consent: recorded as history.
  await waService.getByRole('button', { name: 'Withdraw' }).click();
  await waService.getByLabel('How did they ask to stop?').fill('replied STOP');
  await waService.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Consent withdrawn.')).toBeVisible();
  await expect(waService.getByText('Withdrawn')).toBeVisible();

  // Create a lead.
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.getByLabel('Looking to').selectOption('buy');
  await page.getByLabel('Community').fill('Business Bay');
  await page.getByLabel('Bedrooms from').fill('1');
  await page.getByLabel('Bedrooms up to').fill('2');
  await page.getByLabel('Budget from (AED)').fill('1200000');
  await page.getByLabel('Budget up to (AED)').fill('1800000');
  await page.getByLabel('Note').fill('Prefers canal view');
  await page.getByRole('button', { name: 'Create lead' }).click();

  await expect(page.getByText('AED 1,200,000 – 1,800,000')).toBeVisible();
  await expect(page.getByText('Prefers canal view')).toBeVisible();
  await page.getByLabel('Move to stage').selectOption('qualified');
  await page.getByRole('button', { name: 'Update stage' }).click();
  await expect(page.getByText('Moved to Qualified.')).toBeVisible();
  await expect(page.getByText('Stage: New → Qualified')).toBeVisible();

  // The board shows it under Qualified, and the dashboard counts it.
  await nav.getByRole('link', { name: 'Leads' }).click();
  await expect(
    page.getByRole('region', { name: 'Qualified' }).getByText('Aisha Buyer'),
  ).toBeVisible();
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  const leadsGlance = page.getByRole('region', { name: 'Leads at a glance' });
  await expect(leadsGlance.getByText('Open leads')).toBeVisible();
  await expect(leadsGlance).toContainText('Open leads1');

  // Losing a lead needs a reason.
  await nav.getByRole('link', { name: 'Leads' }).click();
  await page.getByText('Aisha Buyer').first().click();
  await page.getByLabel('Move to stage').selectOption('lost');
  await page.getByLabel('Why was it lost?').fill('Bought through another agent');
  await page.getByRole('button', { name: 'Update stage' }).click();
  await expect(page.getByText('Lost because')).toBeVisible();
});
