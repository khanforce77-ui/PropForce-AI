import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env';
import { VoiceDialer } from './voice-dialer';

const input = {
  toE164: '+971501234567',
  customerName: 'Sara',
  firstMessage: 'Hi, this is an AI assistant.',
  instructions: 'rules',
  questions: ['Budget?'],
  language: 'en' as const,
  metadata: { propforceCallId: 'id1' },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting a loose JSON body
type Loose = any;
const dialer = (env: Record<string, string>) =>
  new VoiceDialer(
    loadConfig({ NODE_ENV: 'test', APP_WEB_URL: 'https://app.example.test', ...env }),
  );

describe('VoiceDialer', () => {
  it('is not configured without the API key and webhook secret', () => {
    expect(dialer({}).configured).toBe(false);
    expect(dialer({ VAPI_API_KEY: 'k'.repeat(20) }).configured).toBe(false);
    expect(
      dialer({ VAPI_API_KEY: 'k'.repeat(20), VAPI_WEBHOOK_SECRET: 's'.repeat(20) }).configured,
    ).toBe(true);
  });

  it('builds a transient assistant, or overrides the configured one', () => {
    const env = { VAPI_WEBHOOK_SECRET: 's'.repeat(20), VAPI_DEFAULT_PHONE_NUMBER_ID: 'pn_default' };
    const body = dialer(env).buildRequest(input) as Loose;
    expect(body.phoneNumberId).toBe('pn_default');
    expect(body.customer).toEqual({ number: '+971501234567', name: 'Sara' });
    expect(body.assistant.firstMessage).toBe(input.firstMessage);
    expect(body.assistant.server).toEqual({
      url: 'https://app.example.test/v1/webhooks/voice/vapi',
      headers: { 'X-Vapi-Secret': 's'.repeat(20) },
    });
    expect(body.assistant.artifactPlan).toEqual({ recordingEnabled: false });
    // The caller's language is detected on every call, not only for Arabic scripts.
    expect(body.assistant.transcriber).toEqual({
      provider: 'deepgram',
      model: 'nova-3',
      language: 'multi',
    });
    expect(
      Object.keys(
        body.assistant.analysisPlan.structuredDataPlan.schema.properties.answers.properties,
      ),
    ).toEqual(['q1']);
    expect(body.metadata).toEqual({ propforceCallId: 'id1' });

    const withBase = dialer({ ...env, VAPI_ASSISTANT_ID: 'asst_1' }).buildRequest({
      ...input,
      fromPhoneNumberId: 'pn_agency',
    }) as Loose;
    expect(withBase).toMatchObject({ assistantId: 'asst_1', phoneNumberId: 'pn_agency' });
    expect(withBase.assistant).toBeUndefined();
    expect(withBase.assistantOverrides.model.messages[0].content).toBe('rules');
  });

  it('books a call for later with a schedule plan', () => {
    const env = { VAPI_WEBHOOK_SECRET: 's'.repeat(20), VAPI_DEFAULT_PHONE_NUMBER_ID: 'pn_default' };
    const earliestAt = new Date('2026-11-28T06:00:00Z');
    const latestAt = new Date('2026-11-28T14:00:00Z');
    const body = dialer(env).buildRequest({
      ...input,
      schedule: { earliestAt, latestAt },
    }) as Loose;
    expect(body.schedulePlan).toEqual({
      earliestAt: '2026-11-28T06:00:00.000Z',
      latestAt: '2026-11-28T14:00:00.000Z',
    });
    expect((dialer(env).buildRequest(input) as Loose).schedulePlan).toBeUndefined();
  });

  it('refuses to build a call with no number', () => {
    expect(() => dialer({}).buildRequest(input)).toThrow(/No calling number/);
  });
});
