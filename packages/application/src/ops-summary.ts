import type { ReportingPublisher } from './reporting-ports.js';
import { utcDateStamp } from './reporting.js';

export interface OpsDailySnapshot {
  readonly orderCount: string;
  readonly fulfilledCount: string;
  readonly amountIrr: string;
  readonly failedCount: string;
}

export interface OpsSnapshotReader {
  summarizeUtcDay(from: Date, to: Date): Promise<OpsDailySnapshot>;
}

export class OpsDailySummaryUseCase {
  public constructor(
    private readonly reader: OpsSnapshotReader,
    private readonly reporting: ReportingPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async publishForUtcDay(): Promise<{ readonly created: boolean }> {
    const now = this.now();
    const day = utcDateStamp(now);
    const from = new Date(`${day}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const snapshot = await this.reader.summarizeUtcDay(from, to);
    const recorded = await this.reporting.record({
      type: 'ops.daily_summary',
      occurrenceKey: `ops:daily-summary:${day}`,
      payload: {
        day,
        orderCount: snapshot.orderCount,
        fulfilledCount: snapshot.fulfilledCount,
        amountIrr: snapshot.amountIrr,
        failedCount: snapshot.failedCount,
      },
    });
    return { created: recorded.created };
  }
}
