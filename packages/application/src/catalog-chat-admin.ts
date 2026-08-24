import {
  DomainConflictError,
  parseCatalogAdminWizardState,
  type CatalogAdminCategory,
  type CatalogAdminReadModel,
  type CatalogAdminPublicationResult,
  type CatalogAdminSession,
  type CatalogAdminWizardState,
} from '@neo-bot/domain';

export interface CatalogChatAdminRepository {
  getCatalogRevision(): Promise<number>;
  listAdminCategories(): Promise<readonly CatalogAdminCategory[]>;
  getCatalogAdminReadModel(): Promise<CatalogAdminReadModel>;
  createCatalogAdminSession(input: CatalogAdminSession): Promise<void>;
  getCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
  }): Promise<CatalogAdminSession | null>;
  getPendingCatalogAdminSession(adminTelegramUserId: string): Promise<CatalogAdminSession | null>;
  updateCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly state: CatalogAdminWizardState;
    readonly now: Date;
  }): Promise<CatalogAdminSession>;
  cancelCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<void>;
  publishCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<CatalogAdminPublicationResult>;
}

export class CatalogChatAdminUseCase {
  public constructor(private readonly repository: CatalogChatAdminRepository) {}
  public getCatalogRevision(): Promise<number> {
    return this.repository.getCatalogRevision();
  }
  public listCategories(): Promise<readonly CatalogAdminCategory[]> {
    return this.repository.listAdminCategories();
  }
  public getReadModel(): Promise<CatalogAdminReadModel> {
    return this.repository.getCatalogAdminReadModel();
  }

  public async startSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<CatalogAdminSession> {
    requireAdminId(input.adminTelegramUserId);
    const session: CatalogAdminSession = {
      id: input.id,
      adminTelegramUserId: input.adminTelegramUserId,
      baseRevision: await this.repository.getCatalogRevision(),
      state: { kind: 'start', step: 'select-action' },
      status: 'pending',
      expiresAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
      publishedResult: null,
    };
    await this.repository.createCatalogAdminSession(session);
    return session;
  }

  public getSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
  }): Promise<CatalogAdminSession | null> {
    return this.repository.getCatalogAdminSession(input);
  }
  public getPendingSession(adminTelegramUserId: string): Promise<CatalogAdminSession | null> {
    return this.repository.getPendingCatalogAdminSession(adminTelegramUserId);
  }

  public async updateSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly state: unknown;
    readonly now: Date;
  }): Promise<CatalogAdminSession> {
    const state = parseCatalogAdminWizardState(input.state);
    const session = await this.repository.getCatalogAdminSession(input);
    if (session === null) throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_FOUND');
    if (session.status !== 'pending')
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_PENDING');
    if (session.expiresAt <= input.now)
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_EXPIRED');
    return this.repository.updateCatalogAdminSession({ ...input, state });
  }

  public cancelSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<void> {
    return this.repository.cancelCatalogAdminSession(input);
  }

  public async publishSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<CatalogAdminPublicationResult> {
    const session = await this.repository.getCatalogAdminSession(input);
    if (session === null) throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_FOUND');
    if (session.status === 'published' && session.publishedResult !== null)
      return session.publishedResult;
    if (session.status !== 'pending')
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_PENDING');
    if (session.expiresAt <= input.now)
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_EXPIRED');
    if (session.state.kind !== 'review')
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
    return this.repository.publishCatalogAdminSession(input);
  }
}

function requireAdminId(value: string): void {
  if (!/^\d+$/u.test(value) || BigInt(value) <= 0n)
    throw new DomainConflictError('INVALID_ADMIN_TELEGRAM_USER_ID');
}
