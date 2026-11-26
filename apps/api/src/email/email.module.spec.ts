import { describe, expect, it, vi } from 'vitest';
import {
  createEmailSender,
  LogEmailSender,
  ResendEmailSender,
  SmtpEmailSender,
} from './email.module';

describe('email sender choice', () => {
  it('prefers Resend, then SMTP, then logging', () => {
    const from = 'PropForce <noreply@propforce.io>';
    expect(createEmailSender({ resendApiKey: 're_x', smtpUrl: 'smtp://x', from })).toBeInstanceOf(
      ResendEmailSender,
    );
    expect(createEmailSender({ smtpUrl: 'smtp://localhost:1025', from })).toBeInstanceOf(
      SmtpEmailSender,
    );
    expect(createEmailSender({ from })).toBeInstanceOf(LogEmailSender);
  });
});

describe('ResendEmailSender', () => {
  it('posts the message to the Resend API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    const sender = new ResendEmailSender('re_key', 'PropForce <noreply@propforce.io>', fetchMock);
    await sender.send({
      to: 'a@b.test',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      replyTo: 'r@b.test',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'PropForce <noreply@propforce.io>',
      to: ['a@b.test'],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      reply_to: 'r@b.test',
    });
  });

  it("throws with Resend's message and never the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"name":"validation_error","message":"Domain not verified"}', {
        status: 403,
      }),
    );
    const sender = new ResendEmailSender('re_secret', 'x@y.test', fetchMock);
    const err = await sender.send({ to: 'a@b.test', subject: 's', text: 't' }).catch((e) => e);
    expect(String(err)).toContain('Domain not verified');
    expect(String(err)).not.toContain('re_secret');
  });
});
