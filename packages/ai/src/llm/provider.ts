/**
 * Provider-neutral LLM port. Transcript items mirror the OpenAI Responses API item shapes so the
 * real adapter is a thin mapping, but nothing outside `llm/` depends on OpenAI.
 */

export type TranscriptItem =
  | { readonly type: 'message'; readonly role: 'user' | 'assistant'; readonly content: string }
  | {
      readonly type: 'function_call';
      readonly callId: string;
      readonly name: string;
      readonly arguments: string;
    }
  | { readonly type: 'function_call_output'; readonly callId: string; readonly output: string };

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface LlmRequest {
  /** Trusted instructions only. Untrusted text must be in `input`, wrapped (see safety/untrusted). */
  readonly instructions: string;
  readonly input: readonly TranscriptItem[];
  readonly tools: readonly ToolDefinition[];
  /** JSON Schema the final answer must follow. */
  readonly outputSchema: { readonly name: string; readonly schema: unknown };
  readonly maxOutputTokens: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type LlmResponse =
  | {
      readonly kind: 'tool_calls';
      readonly calls: readonly {
        readonly callId: string;
        readonly name: string;
        readonly arguments: string;
      }[];
      readonly usage: LlmUsage;
      readonly model: string;
    }
  | {
      readonly kind: 'final';
      readonly text: string;
      readonly usage: LlmUsage;
      readonly model: string;
    };

export interface LlmProvider {
  readonly name: string;
  next(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

/**
 * Deterministic provider for tests, local development and the eval harness. Each step is either
 * a fixed response or a function of the request (to assert on what the model was shown).
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly requests: LlmRequest[] = [];
  private i = 0;
  constructor(
    private readonly steps: readonly (LlmResponse | ((req: LlmRequest) => LlmResponse))[],
  ) {}

  async next(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const step = this.steps[this.i++];
    if (!step) throw new Error('FakeLlmProvider: no scripted response left');
    return typeof step === 'function' ? step(request) : step;
  }
}

export const fakeUsage: LlmUsage = { inputTokens: 100, outputTokens: 20 };

export const fakeToolCalls = (...calls: { name: string; args: unknown }[]): LlmResponse => ({
  kind: 'tool_calls',
  calls: calls.map((c, n) => ({
    callId: `call_${n}_${c.name}`,
    name: c.name,
    arguments: JSON.stringify(c.args),
  })),
  usage: fakeUsage,
  model: 'fake-model',
});

export const fakeFinal = (output: unknown): LlmResponse => ({
  kind: 'final',
  text: typeof output === 'string' ? output : JSON.stringify(output),
  usage: fakeUsage,
  model: 'fake-model',
});
