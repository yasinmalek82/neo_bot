import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';

import { SafeLogger } from './safe-log.js';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/u;

const HTTP_ERROR_NAMES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

@Catch()
export class RedactingExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger = new SafeLogger('Exceptions')) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
    }>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = publicErrorCode(exception);
    this.logger.error(message);
    response.status(status).send({
      statusCode: status,
      message,
      error: HTTP_ERROR_NAMES[status] ?? 'Internal Server Error',
    });
  }
}

export function publicErrorCode(exception: unknown): string {
  if (exception instanceof HttpException) {
    const body: unknown = exception.getResponse();
    const direct = allowlistedCode(body);
    if (direct !== null) {
      return direct;
    }
    if (typeof body === 'object' && body !== null) {
      const nested = allowlistedCode(Object.getOwnPropertyDescriptor(body, 'message')?.value);
      if (nested !== null) {
        return nested;
      }
    }
  }
  if (exception instanceof Error) {
    const fromMessage = allowlistedCode(exception.message);
    if (fromMessage !== null) {
      return fromMessage;
    }
  }
  return 'INTERNAL_ERROR';
}

function allowlistedCode(value: unknown): string | null {
  if (typeof value === 'string' && CODE_PATTERN.test(value)) {
    return value;
  }
  return null;
}
