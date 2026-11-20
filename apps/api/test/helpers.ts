import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@propforce/db';
import { vi, type MockInstance } from 'vitest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';
import { EmailSender, type EmailMessage } from '../src/email/email.sender';

export const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://propforce:propforce_dev_only@localhost:5432/propforce';

export interface TestApp {
  app: INestApplication;
  owner: PrismaClient;
  emails: EmailMessage[];
  sendSpy: MockInstance;
  close: () => Promise<void>;
}

/** Boots the real app against the test database, capturing outgoing email. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const app = await createApp(
    loadConfig({ NODE_ENV: 'test', APP_VERSION: '1.2.3', ...env, ...pickDbEnv() }),
  );
  await app.init();
  const emails: EmailMessage[] = [];
  const sendSpy = vi.spyOn(app.get(EmailSender), 'send').mockImplementation(async (m) => {
    emails.push(m);
  });
  const owner = createPrismaClient({ connectionString: OWNER_URL, max: 2 });
  return {
    app,
    owner,
    emails,
    sendSpy,
    close: async () => {
      await app.close();
      await owner.$disconnect();
    },
  };
}

function pickDbEnv(): Record<string, string> {
  return process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {};
}

export async function resetDatabase(owner: PrismaClient): Promise<void> {
  await owner.$executeRawUnsafe(
    'TRUNCATE "audit_log", "invitation", "membership", "team", "agency_settings", "agency", "user_token", "mfa_factor", "session", "user" CASCADE',
  );
}

export function tokenFrom(message: EmailMessage | undefined): string {
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token in email: ${message?.text}`);
  return match[1];
}

export function refreshCookieFrom(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = list.find((c) => c.startsWith('pf_refresh='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

export const registration = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Sara Ahmed',
  email: 'sara@example.test',
  password: 'correct horse battery',
  agency: { name: 'Marina Homes Real Estate', emirate: 'Dubai' },
  acceptTerms: true,
  ...overrides,
});
