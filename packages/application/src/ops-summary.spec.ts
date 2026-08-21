import { describe, expect, it, vi } from 'vitest';

import { OpsDailySummaryUseCase } from './ops-summary.js';
import { formatReportText } from './reporting.js';

describe('OpsDailySummaryUseCase', () => {
  it('publishes aggregate counts without subscription URLs', async () => {
    const reporting = { record: vi.fn().mockResolvedValue({ id: '1', created: true }) };
    const useCase = new OpsDailySummaryUseCase(
      {
        summarizeUtcDay: vi.fn().mockResolvedValue({
          orderCount: '4',
          fulfilledCount: '2',
          amountIrr: '3000000',
          failedCount: '1',
        }),
      },
      reporting,
      () => new Date('2026-08-21T18:00:00.000Z'),
    );

    await expect(useCase.publishForUtcDay()).resolves.toEqual({ created: true });
    expect(reporting.record).toHaveBeenCalledWith({
      type: 'ops.daily_summary',
      occurrenceKey: 'ops:daily-summary:2026-08-21',
      payload: {
        day: '2026-08-21',
        orderCount: '4',
        fulfilledCount: '2',
        amountIrr: '3000000',
        failedCount: '1',
      },
    });
    expect(
      formatReportText('ops.daily_summary', {
        day: '2026-08-21',
        orderCount: '4',
        fulfilledCount: '2',
        amountIrr: '3000000',
        failedCount: '1',
      }),
    ).not.toMatch(/https?:\/\//u);
  });
});
