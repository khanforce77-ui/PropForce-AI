import { describe, expect, it } from 'vitest';
import { OpenAiResponsesProvider, parseOpenAiResponse } from '../llm/openai';

const req = {
  instructions: 'rules',
  input: [
    { type: 'message' as const, role: 'user' as const, content: 'hi' },
    { type: 'function_call' as const, callId: 'c1', name: 'get_client_history', arguments: '{}' },
    { type: 'function_call_output' as const, callId: 'c1', output: '{"ok":true}' },
  ],
  tools: [{ name: 'get_client_history', description: 'd', parameters: { type: 'object' } }],
  outputSchema: { name: 'assistant_reply', schema: { type: 'object' } },
  maxOutputTokens: 100,
};

describe('OpenAiResponsesProvider (offline checks only; live API not yet verified)', () => {
  it('refuses to construct without a key', () => {
    expect(() => new OpenAiResponsesProvider({ apiKey: '', model: 'm' })).toThrow();
  });

  it('builds a Responses API request with store disabled and strict output schema', () => {
    const body = new OpenAiResponsesProvider({ apiKey: 'k', model: 'm' }).buildBody(req);
    expect(body).toMatchObject({
      model: 'm',
      instructions: 'rules',
      store: false,
      max_output_tokens: 100,
    });
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call', call_id: 'c1', name: 'get_client_history', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
    ]);
    expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
  });

  it('parses function calls and final text', () => {
    expect(
      parseOpenAiResponse({
        model: 'm',
        output: [{ type: 'function_call', call_id: 'c', name: 'n', arguments: '{"a":1}' }],
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    ).toEqual({
      kind: 'tool_calls',
      calls: [{ callId: 'c', name: 'n', arguments: '{"a":1}' }],
      usage: { inputTokens: 3, outputTokens: 4 },
      model: 'm',
    });
    expect(
      parseOpenAiResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"x":1}' }] }],
      }),
    ).toMatchObject({
      kind: 'final',
      text: '{"x":1}',
    });
  });

  it('does not leak the response body on HTTP errors', async () => {
    const p = new OpenAiResponsesProvider({
      apiKey: 'k',
      model: 'm',
      fetch: async () => new Response('secret echo', { status: 500 }),
    });
    await expect(p.next(req)).rejects.toThrow(/^OpenAI request failed with HTTP 500$/);
  });
});
