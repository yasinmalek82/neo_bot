import { describe, expect, it, vi } from 'vitest';

import { ReportingOutboxScheduler } from './reporting-outbox-scheduler.js';

describe('ReportingOutboxScheduler', () => {
  it('does not start when the interval is zero', async () => {
    const dispatchDue = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ReportingOutboxScheduler(dispatchDue, 0);

    scheduler.start();
    await scheduler.tick();

    expect(dispatchDue).not.toHaveBeenCalled();
  });

  it('skips a tick while a previous dispatch is still in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    const dispatchDue = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const scheduler = new ReportingOutboxScheduler(dispatchDue, 15_000);
    scheduler.start();
    await vi.waitFor(() => expect(dispatchDue).toHaveBeenCalledTimes(1));

    await scheduler.tick();
    expect(dispatchDue).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await scheduler.waitForIdle();
    await scheduler.tick();
    expect(dispatchDue).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('keeps polling after a dispatch failure without throwing', async () => {
    const dispatchDue = vi
      .fn()
      .mockRejectedValueOnce(new Error('REPORT_TRANSPORT_FAILED'))
      .mockResolvedValue(undefined);
    const scheduler = new ReportingOutboxScheduler(dispatchDue, 15_000);
    scheduler.start();
    await vi.waitFor(() => expect(dispatchDue).toHaveBeenCalledTimes(1));
    await scheduler.waitForIdle();
    await scheduler.tick();

    expect(dispatchDue).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('does not dispatch after stop', async () => {
    const dispatchDue = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ReportingOutboxScheduler(dispatchDue, 15_000);
    scheduler.start();
    await vi.waitFor(() => expect(dispatchDue).toHaveBeenCalledTimes(1));
    await scheduler.waitForIdle();
    scheduler.stop();
    await scheduler.tick();

    expect(dispatchDue).toHaveBeenCalledTimes(1);
  });
});
