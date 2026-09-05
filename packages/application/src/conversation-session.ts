import {
  CONVERSATION_SESSION_SCHEMA_VERSION,
  CONVERSATION_SESSION_TTL_MS,
  parseDurableConversationSession,
  type ConversationFlowId,
  type ConversationPayload,
  type ConversationSessionStatus,
  type ConversationStep,
  type DurableConversationSession,
} from '@neo-bot/domain';

export interface ConversationSessionStore {
  getPending(telegramUserId: string): Promise<DurableConversationSession | null>;
  put(session: DurableConversationSession): Promise<DurableConversationSession>;
  finish(input: {
    readonly id: string;
    readonly telegramUserId: string;
    readonly status: Exclude<ConversationSessionStatus, 'pending'>;
    readonly now: Date;
  }): Promise<void>;
}

export class RepositoryConversationSessionStore implements ConversationSessionStore {
  public constructor(
    private readonly repository: {
      getPendingConversationSession(
        telegramUserId: string,
      ): Promise<DurableConversationSession | null>;
      putConversationSession(
        session: DurableConversationSession,
      ): Promise<DurableConversationSession>;
      finishConversationSession(input: {
        readonly id: string;
        readonly telegramUserId: string;
        readonly status: Exclude<ConversationSessionStatus, 'pending'>;
        readonly now: Date;
      }): Promise<void>;
    },
  ) {}

  public getPending(telegramUserId: string): Promise<DurableConversationSession | null> {
    return this.repository.getPendingConversationSession(telegramUserId);
  }

  public put(session: DurableConversationSession): Promise<DurableConversationSession> {
    return this.repository.putConversationSession(session);
  }

  public finish(input: {
    readonly id: string;
    readonly telegramUserId: string;
    readonly status: Exclude<ConversationSessionStatus, 'pending'>;
    readonly now: Date;
  }): Promise<void> {
    return this.repository.finishConversationSession(input);
  }
}

export class InMemoryConversationSessionStore implements ConversationSessionStore {
  private readonly sessions = new Map<string, DurableConversationSession>();

  public getPending(telegramUserId: string): Promise<DurableConversationSession | null> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.telegramUserId === telegramUserId && candidate.status === 'pending',
    );
    return Promise.resolve(session ?? null);
  }

  public put(session: DurableConversationSession): Promise<DurableConversationSession> {
    const parsed = parseDurableConversationSession(session);
    for (const [id, existing] of this.sessions) {
      if (
        existing.telegramUserId === parsed.telegramUserId &&
        existing.status === 'pending' &&
        existing.id !== parsed.id
      ) {
        this.sessions.set(id, { ...existing, status: 'canceled', updatedAt: parsed.updatedAt });
      }
    }
    this.sessions.set(parsed.id, parsed);
    return Promise.resolve(parsed);
  }

  public finish(input: {
    readonly id: string;
    readonly telegramUserId: string;
    readonly status: Exclude<ConversationSessionStatus, 'pending'>;
    readonly now: Date;
  }): Promise<void> {
    const existing = this.sessions.get(input.id);
    if (existing?.telegramUserId !== input.telegramUserId) {
      return Promise.resolve();
    }
    this.sessions.set(input.id, { ...existing, status: input.status, updatedAt: input.now });
    return Promise.resolve();
  }
}

export function startConversationSession(input: {
  readonly id: string;
  readonly telegramUserId: string;
  readonly flowId: ConversationFlowId;
  readonly step: ConversationStep;
  readonly payload: ConversationPayload;
  readonly now: Date;
}): DurableConversationSession {
  return parseDurableConversationSession({
    id: input.id,
    telegramUserId: input.telegramUserId,
    flowId: input.flowId,
    step: input.step,
    schemaVersion: CONVERSATION_SESSION_SCHEMA_VERSION,
    payload: input.payload,
    status: 'pending',
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: new Date(input.now.getTime() + CONVERSATION_SESSION_TTL_MS),
  });
}

export function continueConversationSession(
  session: DurableConversationSession,
  input: {
    readonly step: ConversationStep;
    readonly payload: ConversationPayload;
    readonly now: Date;
  },
): DurableConversationSession {
  return parseDurableConversationSession({
    ...session,
    step: input.step,
    payload: input.payload,
    updatedAt: input.now,
  });
}
