export interface UsageSyncTarget {
  readonly serviceId: string;
  readonly targetUserId: number;
  readonly usedTrafficBytes: bigint | null;
}

export interface UsageSyncWrite {
  readonly serviceId: string;
  readonly targetUserId: number;
  readonly usedTrafficBytes: bigint | null;
  readonly remoteFound: boolean;
}

export const USAGE_SYNC_STALE_MS = 10 * 60_000;
export const USAGE_SYNC_BATCH_LIMIT = 20;

export function usageSyncDueBefore(now: Date): Date {
  return new Date(now.getTime() - USAGE_SYNC_STALE_MS);
}
