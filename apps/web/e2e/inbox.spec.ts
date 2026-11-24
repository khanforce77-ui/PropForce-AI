import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { linkFromEmail } from './mailpit';

const API = 'http://localhost:4000/v1';
const META_SECRET = 'e2e-meta-app-secret';
const run = Date.now().toString(36);
const owner = { name: 'Noura Khan', email: `inbox-${run}@e2e.test`, password: 'e2e inbox pass' };
// Unique per run so reruns against the same database do not collide.
const phoneNumberId = String(Date.now()).slice(-12);
const clientWaId = `9715${String(Date.now()).slice(-8)}`;

/** A client's WhatsApp message, delivered as Meta would: signed with the app secret. */
async function clientSays(api: APIRequestContext, text: string) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '97141234567', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: clientWaId, profile: { name: 'Omar Client' } }],
              messages: [
                {
                  from: clientWaId,
                  id: `wamid.e2e.${run}.${Math.random().toString(36).slice(2)}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sig = `sha256=${createHmac('sha256', META_SECRET).update(raw).digest('hex')}`;
  const res = await api.post(`${API}/webhooks/whatsapp`, {
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    data: raw,
  });
  expect(res.status()).toBe(200);
}

test('agent reads a WhatsApp chat in the inbox, replies, and hands it back to the AI', async ({
  page,
  request: api,
}) => {
  // A fresh, onboarded agency with MFA.
  await page.goto('/register');
  await page.getByLabel('Your full name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByLabel('Agency name').fill(`Harbour Homes ${run}`);
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
  const tenantId = /\/app\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  // Connect a number through the API (the Meta popup cannot run in tests; the API uses a fake).
  const login = await (
    await api.post(`${API}/auth/login`, { data: { email: owner.email, password: owner.password } })
  ).json();
  // The browser just used this period's code; the next period's is accepted and not a replay.
  const verified = await (
    await api.post(`${API}/auth/mfa/verify`, {
      data: { mfaToken: login.mfaToken, code: totp.generate({ timestamp: Date.now() + 30_000 }) },
    })
  ).json();
  const connected = await api.post(`${API}/whatsapp/accounts`, {
    headers: { Authorization: `Bearer ${verified.accessToken}`, 'X-Tenant-Id': tenantId },
    data: {
      code: 'AQD-e2e-signup-code',
      wabaId: '102290129340398',
      phoneNumberId,
      displayPhoneNumber: '+971 4 555 0000',
    },
  });
  expect(connected.status()).toBe(201);

  await clientSays(api, 'Hi, is the 2 bed in JLT still available?');

  // The chat shows in the inbox, handled by the AI.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Inbox' }).click();
  const list = page.getByRole('region', { name: 'Conversations' });
  await expect(list.getByText('Omar Client')).toBeVisible();
  await expect(list.getByText('Hi, is the 2 bed in JLT still available?')).toBeVisible();
  await list.getByText('Omar Client').click();
  const thread = page.getByRole('region', { name: 'Conversation' });
  await expect(thread.getByText('Hi, is the 2 bed in JLT still available?')).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Take over from AI' })).toBeVisible();

  // Replying takes the chat over from the AI.
  await thread.getByLabel('Reply').fill('Yes it is! When would you like to view it?');
  await thread.getByRole('button', { name: 'Send' }).click();
  await expect(thread.getByText('Yes it is! When would you like to view it?')).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Hand back to AI' })).toBeVisible();
  await page.getByRole('tab', { name: 'Needs agent' }).click();
  await expect(list.getByText('Omar Client')).toBeVisible();

  // A new client message arrives while the chat is open.
  await clientSays(api, 'Tomorrow at 5pm works');
  await expect(thread.getByText('Tomorrow at 5pm works')).toBeVisible({ timeout: 15_000 });

  // Hand back to the AI.
  await page.getByRole('tab', { name: 'All' }).click();
  await thread.getByRole('button', { name: 'Hand back to AI' }).click();
  await expect(thread.getByRole('button', { name: 'Take over from AI' })).toBeVisible();
});
