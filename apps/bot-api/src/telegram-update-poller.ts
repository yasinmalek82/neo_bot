import { readTelegramUpdateId } from './telegram-update.js';

export { readTelegramUpdateId as readUpdateId } from './telegram-update.js';

export class TelegramUpdatePoller {
  private readonly flags = { stopped: true };
  private inFlight: Promise<void> | null = null;
  private offset = 0;

  public constructor(
    private readonly getUpdates: (
      offset: number,
      timeoutSeconds: number,
    ) => Promise<readonly unknown[]>,
    private readonly handleUpdate: (update: unknown) => Promise<void>,
    private readonly timeoutSeconds = 0,
    private readonly retryDelayMs = 1_000,
    private readonly stopOnEmpty = false,
    private readonly onIntake?: (ok: boolean, error?: unknown) => void,
  ) {}

  public start(): void {
    if (!this.flags.stopped) {
      return;
    }
    this.flags.stopped = false;
    this.inFlight = this.run();
  }

  public async stop(): Promise<void> {
    this.flags.stopped = true;
    if (this.inFlight !== null) {
      await this.inFlight;
    }
  }

  private async run(): Promise<void> {
    try {
      while (!this.isStopped()) {
        try {
          const updates = await this.getUpdates(this.offset, this.timeoutSeconds);
          this.onIntake?.(true);
          if (this.isStopped()) {
            return;
          }
          if (updates.length === 0) {
            if (this.stopOnEmpty) {
              this.flags.stopped = true;
              return;
            }
            if (this.retryDelayMs > 0) {
              await delay(this.retryDelayMs);
            }
            continue;
          }
          for (const update of updates) {
            const updateId = readTelegramUpdateId(update);
            try {
              await this.handleUpdate(update);
              if (this.isStopped()) {
                return;
              }
              if (updateId !== undefined) {
                this.offset = updateId + 1;
              }
            } catch {
              break;
            }
          }
        } catch (error: unknown) {
          this.onIntake?.(false, error);
          if (this.isStopped()) {
            return;
          }
          if (this.retryDelayMs > 0) {
            await delay(this.retryDelayMs);
          }
        }
      }
    } finally {
      this.inFlight = null;
    }
  }

  private isStopped(): boolean {
    return this.flags.stopped;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
