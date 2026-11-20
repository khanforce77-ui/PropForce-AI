import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ProblemDetails } from '@propforce/contracts';
import type { Request, Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Maps every error to RFC 9457 Problem Details and never leaks internals on 5xx. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let detail: string | undefined;
    let code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR');
    let errors: ProblemDetails['errors'];

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; code?: unknown; errors?: unknown };
        if (typeof b.message === 'string') detail = b.message;
        if (typeof b.code === 'string') code = b.code;
        if (Array.isArray(b.errors)) errors = b.errors as ProblemDetails['errors'];
      }
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      detail = 'An unexpected error occurred.';
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: HttpStatus[status]?.replace(/_/g, ' ') ?? 'Error',
      status,
      code,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
      ...(req.id ? { requestId: String(req.id) } : {}),
    };

    res.status(status).type('application/problem+json').json(problem);
  }
}
