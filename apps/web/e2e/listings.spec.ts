import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { linkFromEmail } from './mailpit';

const run = Date.now().toString(36);
const fixture = (name: string) => join(__dirname, 'fixtures', name);
const owner = {
  name: 'Layla Hassan',
  email: `listings-${run}@e2e.test`,
  password: 'e2e listings pass',
};

test('owner adds a listing, publishes it with a permit and sees it on the dashboard', async ({
  page,
}) => {
  // A fresh, onboarded agency.
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByLabel('Agency name').fill(`Palm Estates ${run}`);
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

  // Empty dashboard → add a listing.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('No listings yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add listing' }).click();
  await page.getByLabel('Property type').selectOption('apartment');
  await page.getByLabel('Community').fill('Dubai Marina');
  await page.getByLabel('Building').fill('Marina Gate 1');
  await page.getByLabel('Bedrooms').fill('2');
  await page.getByLabel('Bathrooms').fill('2');
  await page.getByLabel('Area (sq ft)').fill('1250');
  await page.getByLabel('Price (AED)').fill('2,350,000');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Marina Gate 1, Dubai Marina' })).toBeVisible();

  // Publishing needs a permit first.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('This listing is not ready to publish.')).toBeVisible();
  await page.getByLabel('Permit number').fill(`71${Date.now().toString().slice(-8)}`);
  await page.getByLabel('Valid until').fill('2099-12-31');
  await page.getByRole('button', { name: 'Add permit' }).click();
  await expect(page.getByText('Permit added.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Listing is now live.')).toBeVisible();

  // Add a photo: it becomes the cover.
  await page.getByLabel('Add photos').setInputFiles(fixture('living-room.jpg'));
  await expect(page.getByRole('img', { name: 'Photo 1 (cover)' })).toBeVisible();
  await expect(page.getByText(/^1 of 30\./)).toBeVisible();

  // It shows up in the list and on the dashboard.
  await page.getByRole('link', { name: '← Listings' }).click();
  await expect(page.getByRole('link', { name: 'Marina Gate 1, Dubai Marina' })).toBeVisible();
  await expect(page.getByText('AED 2,350,000')).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const stats = page.getByRole('region', { name: 'Listings at a glance' });
  await expect(stats.getByRole('link', { name: /^Live listings/ })).toContainText('Live listings1');

  // The live listing is on the public portal under this agent; adding a WhatsApp number makes it
  // reachable from there.
  await page.getByRole('link', { name: 'Property portal' }).click();
  await expect(page.getByRole('heading', { name: 'Your public profile' })).toBeVisible();
  await page.getByLabel('WhatsApp').fill('050 123 4567');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Contact details saved.')).toBeVisible();
  await expect(page.getByLabel('WhatsApp')).toHaveValue('+971501234567');

  // The agency logo becomes the watermark; the existing photo is re-marked.
  await page.getByLabel('Upload logo').setInputFiles(fixture('agency-logo.png'));
  await expect(page.getByText('Logo saved. 1 photo re-marked.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Agency logo' })).toBeVisible();

  const res = await page.request.get('http://localhost:4000/v1/public/listings', {
    params: { q: 'Marina Gate 1' },
  });
  const body = (await res.json()) as {
    data: {
      building: string;
      agent: { name: string; canWhatsapp: boolean };
      photoCount: number;
      photos: { id: string; version: number }[];
    }[];
  };
  const mine = body.data.find((l) => l.agent.name === owner.name);
  expect(mine).toMatchObject({
    building: 'Marina Gate 1',
    agent: { canWhatsapp: true },
    photoCount: 1,
  });
  expect(mine!.photos[0]!.version).toBe(2);
  const img = await page.request.get(
    `http://localhost:4000/v1/public/listing-photos/${mine!.photos[0]!.id}/display`,
  );
  expect(img.headers()['content-type']).toBe('image/webp');
  expect(
    (
      await page.request.get(
        `http://localhost:4000/v1/public/listing-photos/${mine!.photos[0]!.id}/original`,
      )
    ).status(),
  ).toBe(404);
});
