import type { LlmProvider, LlmRequest, LlmResponse, TranscriptItem } from './provider';

/**
 * OpenAI Responses API adapter.
 *
 * STATUS: PENDING. No OpenAI key exists yet, so this adapter is only covered by unit tests that
 * check the request it builds and how it parses a recorded response shape. It has not been run
 * against the live API. Verify with a real key before enabling it for any tenant.
 */
export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export class OpenAiResponsesProvider implements LlmProvider {
  readonly name = 'openai';
  constructor(private readonly cfg: OpenAiConfig) {
    if (!cfg.apiKey) throw new Error('OpenAI API key is not configured');
  }

  buildBody(req: LlmRequest): Record<string, unknown> {
    return {
      model: this.cfg.model,
      instructions: req.instructions,
      input: req.input.map(toOpenAiItem),
      tools: req.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
      })),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      text: {
        format: {
          type: 'json_schema',
          name: req.outputSchema.name,
          schema: req.outputSchema.schema,
          strict: true,
        },
      },
      max_output_tokens: req.maxOutputTokens,
      // Client conversations must not be retained by the provider beyond what the API requires.
      store: false,
    };
  }

  async next(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const doFetch = this.cfg.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000);
    const res = await doFetch(`${this.cfg.baseUrl ?? 'https://api.openai.com/v1'}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.buildBody(req)),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      // Do not include the response body: it can echo request content.
      throw new Error(`OpenAI request failed with HTTP ${res.status}`);
    }
    return parseOpenAiResponse((await res.json()) as OpenAiResponseBody);
  }
}

const toOpenAiItem = (item: TranscriptItem): Record<string, unknown> => {
  switch (item.type) {
    case 'message':
      return { type: 'message', role: item.role, content: item.content };
    case 'function_call':
      return {
        type: 'function_call',
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
      };
    case 'function_call_output':
      return { type: 'function_call_output', call_id: item.callId, output: item.output };
  }
};

export interface OpenAiResponseBody {
  model?: string;
  output?: {
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: { type: string; text?: string }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const parseOpenAiResponse = (body: OpenAiResponseBody): LlmResponse => {
  const usage = {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
  const model = body.model ?? 'unknown';
  const output = body.output ?? [];
  const calls = output
    .filter((o) => o.type === 'function_call' && o.call_id && o.name)
    .map((o) => ({ callId: o.call_id!, name: o.name!, arguments: o.arguments ?? '{}' }));
  if (calls.length > 0) return { kind: 'tool_calls', calls, usage, model };
  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return { kind: 'final', text, usage, model };
};
