import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const counts = new Map<string, { resetAt: number; count: number }>();

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ ip?: string; url?: string }>();
    const url = request.url ?? '';
    if (url.startsWith('/health') || url.startsWith('/telegram/webhook')) {
      return next.handle();
    }
    const now = Date.now();
    const key = request.ip ?? 'unknown';
    const current = counts.get(key);
    if (current === undefined || current.resetAt <= now) {
      counts.set(key, { resetAt: now + WINDOW_MS, count: 1 });
      return next.handle();
    }
    current.count += 1;
    if (current.count > MAX_REQUESTS) {
      throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    }
    return next.handle();
  }
}

@Injectable()
export class SecurityHeadersInterceptor implements NestInterceptor {
  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const reply = context
          .switchToHttp()
          .getResponse<{ header: (name: string, value: string) => void }>();
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('X-DNS-Prefetch-Control', 'off');
      }),
    );
  }
}
