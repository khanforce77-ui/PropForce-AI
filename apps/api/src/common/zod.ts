import type { z } from 'zod';
import { AppError } from './app-error';

/** Parses untrusted input; unknown keys are rejected so typos and injected fields surface early. */
export function parseBody<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'The request body is invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return result.data;
}
