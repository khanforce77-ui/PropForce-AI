import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { linkFromEmail } from './mailpit';

// Unique per run so the test does not depend on database state.
const run = Date.now().toString(36);
const owner = {
  name: 'Sara Ahmed',
  email: `owner-${run}@e2e.test`,
  password: 'e2e owner passphrase',
};
const agent = {
  name: 'Omar Khalid',
  email: `agent-${run}@e2e.test`,
  password: 'e2e agent passphrase',
};

test('owner registers, secures the account, onboards the agency and invites an agent', async ({
  page,
  browser,
}) => {
  // Register
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByLabel('Agency name').fill(`Marina Homes ${run}`);
  await page.getByLabel('Emirate').selectOption('Dubai');
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole('button', { name: 'Create agency' }).click();
  await expect(page.getByText('We sent a verification link')).toBeVisible();

  // Verify email via the link that was emailed
  await page.goto(await linkFromEmail(owner.email, /Verify your email/));
  await expect(page.getByText('Your email is verified')).toBeVisible();

  // Sign in → owners are sent to set up two-factor authentication first
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText('Agency owners and admins must use an authenticator app'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  await page.getByLabel('6-digit code from the app').fill(totp.generate());
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: 'I saved them, continue' }).click();

  // Onboarding
  await expect(page.getByRole('heading', { name: 'Set up your agency' })).toBeVisible();
  await page.getByLabel('Office registration number (ORN)').fill('12345');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText('Your agency is set up. Invite your team.')).toBeVisible();

  // Invite an agent
  await page.getByLabel('Email').fill(agent.email);
  await page.getByLabel('Role').selectOption('agent');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invitation sent to ${agent.email}.`)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: agent.email })).toBeVisible();

  // The agent accepts in a separate browser session
  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await agentPage.goto(await linkFromEmail(agent.email, /invited to join/));
  await agentPage.getByLabel('Your full name').fill(agent.name);
  await agentPage.getByLabel('Choose a password').fill(agent.password);
  await agentPage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(agentPage.getByText('Invitation accepted.')).toBeVisible();

  await agentPage.goto('/login');
  await agentPage.getByLabel('Email').fill(agent.email);
  await agentPage.getByLabel('Password').fill(agent.password);
  await agentPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(agentPage.getByRole('heading', { name: 'Welcome, Omar' })).toBeVisible();

  // Agents see the team but cannot invite or suspend
  await agentPage.getByRole('link', { name: 'Team members' }).click();
  await expect(agentPage.getByText(owner.email)).toBeVisible();
  await expect(agentPage.getByRole('button', { name: 'Send invite' })).toHaveCount(0);
  await expect(agentPage.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
  await agentContext.close();

  // The owner sees the new member and can suspend them
  await page.reload();
  await expect(page.getByText(agent.name)).toBeVisible();
  await page
    .getByRole('row', { name: new RegExp(agent.name) })
    .getByRole('button', { name: 'Suspend' })
    .click();
  await expect(page.getByText(`${agent.name} was suspended.`)).toBeVisible();
});

test('a suspended agent can still sign in but no longer sees the agency', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(agent.email);
  await page.getByLabel('Password').fill(agent.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('You are not a member of any agency yet')).toBeVisible();
  // The session is restored from the refresh cookie after a reload.
  await page.reload();
  await expect(page.getByText('You are not a member of any agency yet')).toBeVisible();
});
