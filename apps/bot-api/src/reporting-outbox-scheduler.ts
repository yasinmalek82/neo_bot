export class ReportingOutboxScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;

  public constructor(
    private readonly dispatchDue: () => Promise<void>,
    private readonly intervalMs: number,
  ) {}

  public start(): void {
    if (this.intervalMs <= 0 || this.timer !== null) {
      return;
    }
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<void> {
    if (this.stopped || this.inFlight !== null) {
      return;
    }
    const run = this.dispatchDue().then(
      () => undefined,
      () => undefined,
    );
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = null;
    }
  }

  public async waitForIdle(): Promise<void> {
    if (this.inFlight !== null) {
      await this.inFlight;
    }
  }
}
