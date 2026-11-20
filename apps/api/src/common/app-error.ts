import { HttpException } from '@nestjs/common';

/** An error with a stable machine-readable code, rendered as RFC 9457 problem details. */
export class AppError extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    errors?: { path: string; message: string }[],
  ) {
    super({ code, message, ...(errors ? { errors } : {}) }, status);
  }
}
