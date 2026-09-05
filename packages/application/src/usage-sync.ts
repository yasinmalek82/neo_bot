import {
  USAGE_SYNC_BATCH_LIMIT,
  usageSyncDueBefore,
  type UsageSyncTarget,
  type UsageSyncWrite,
} from '@neo-bot/domain';

export interface UsageReader {
  getUserById(userId: number): Promise<{ readonly usedTrafficBytes: bigint } | null>;
}

export interface UsageSyncRepository {
  listServicesDueForUsageSync(
    limit: number,
    staleBefore: Date,
  ): Promise<readonly UsageSyncTarget[]>;
  persistServiceUsedTraffic(input: UsageSyncWrite): Promise<boolean>;
  countDueUsageSync(staleBefore: Date): Promise<number>;
}

export interface UsageSyncResult {
  readonly scanned: number;
  readonly updated: number;
  readonly missing: number;
  readonly failed: number;
}

export class UsageSyncUseCase {
  public constructor(
    private readonly repository: UsageSyncRepository,
    private readonly reader: UsageReader | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async syncDue(limit = USAGE_SYNC_BATCH_LIMIT): Promise<UsageSyncResult> {
    if (this.reader === null) {
      return { scanned: 0, updated: 0, missing: 0, failed: 0 };
    }
    const targets = await this.repository.listServicesDueForUsageSync(
      limit,
      usageSyncDueBefore(this.now()),
    );
    let updated = 0;
    let missing = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const remote = await this.reader.getUserById(target.targetUserId);
        const wrote = await this.repository.persistServiceUsedTraffic({
          serviceId: target.serviceId,
          targetUserId: target.targetUserId,
          usedTrafficBytes: remote?.usedTrafficBytes ?? null,
          remoteFound: remote !== null,
        });
        if (remote === null) {
          missing += 1;
        } else if (wrote) {
          updated += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { scanned: targets.length, updated, missing, failed };
  }

  public countDue(): Promise<number> {
    return this.repository.countDueUsageSync(usageSyncDueBefore(this.now()));
  }
}
