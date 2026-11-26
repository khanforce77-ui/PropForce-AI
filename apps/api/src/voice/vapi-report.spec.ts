import { describe, expect, it } from 'vitest';
import { parseVapiMessage } from './vapi-report';

const report = (over: Record<string, unknown> = {}) => ({
  message: {
    type: 'end-of-call-report',
    endedReason: 'customer-ended-call',
    startedAt: '2026-11-26T10:00:00.000Z',
    endedAt: '2026-11-26T10:02:05.400Z',
    cost: 0.123456,
    artifact: { transcript: 'AI: Hello\nUser: Hi', structuredOutputs: {} },
    analysis: { summary: 'Wants a 2 bed in Marina.' },
    call: { id: 'call_1', type: 'inboundPhoneCall', phoneNumberId: 'pn_1' },
    customer: { number: '+971501234567' },
    ...over,
  },
});

describe('parseVapiMessage', () => {
  it('reads an end-of-call report', () => {
    expect(parseVapiMessage(report()).report).toEqual({
      providerCallId: 'call_1',
      providerPhoneNumberId: 'pn_1',
      direction: 'inbound',
      callerE164: '+971501234567',
      startedAt: new Date('2026-11-26T10:00:00.000Z'),
      endedAt: new Date('2026-11-26T10:02:05.400Z'),
      durationSec: 125,
      costUsd: 0.1235,
      endedReason: 'customer-ended-call',
      summary: 'Wants a 2 bed in Marina.',
      transcript: 'AI: Hello\nUser: Hi',
    });
  });

  it('falls back to the phone number object and a structured-output summary', () => {
    const r = parseVapiMessage(
      report({
        call: { id: 'call_2', type: 'outboundPhoneCall' },
        phoneNumber: { id: 'pn_2' },
        analysis: {},
        artifact: {
          structuredOutputs: { x: { name: 'Call Summary', result: 'Callback tomorrow' } },
        },
        customer: { number: 'not a number' },
      }),
    ).report;
    expect(r).toMatchObject({
      providerPhoneNumberId: 'pn_2',
      direction: 'outbound',
      summary: 'Callback tomorrow',
      callerE164: null,
      transcript: null,
    });
  });

  it('ignores other messages and incomplete reports', () => {
    expect(parseVapiMessage({ message: { type: 'status-update', status: 'ended' } })).toEqual({
      type: 'status-update',
      report: null,
    });
    expect(parseVapiMessage(report({ call: {} })).report).toBeNull();
    expect(parseVapiMessage('nope').report).toBeNull();
  });
});
