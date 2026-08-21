import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { publicErrorCode, RedactingExceptionFilter } from './http-exception.filter.js';

describe('RedactingExceptionFilter', () => {
  it('keeps allowlisted HTTP codes and drops unstructured error text from responses', () => {
    expect(publicErrorCode(new UnauthorizedException('INVALID_TELEGRAM_WEBHOOK_SECRET'))).toBe(
      'INVALID_TELEGRAM_WEBHOOK_SECRET',
    );
    expect(publicErrorCode(new Error('https://panel.example/sub/secret'))).toBe('INTERNAL_ERROR');

    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const logger = { error: vi.fn() };
    const filter = new RedactingExceptionFilter(logger as never);
    filter.catch(new Error('https://panel.example/sub/secret'), {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as never);

    expect(logger.error).toHaveBeenCalledWith('INTERNAL_ERROR');
    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(send.mock.calls[0])).not.toMatch(/https?:\/\//u);
  });
});
