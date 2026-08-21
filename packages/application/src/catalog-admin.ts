import {
  validateStorefrontCatalogDraft,
  type ProviderGroupChoice,
  type ReplaceStorefrontCatalogCommand,
  type StorefrontCatalog,
} from '@neo-bot/domain';

export interface CatalogRepository {
  getPublicCatalog(): Promise<StorefrontCatalog>;
  getAdminCatalog(): Promise<StorefrontCatalog>;
  listProviderGroups(): Promise<readonly ProviderGroupChoice[]>;
  replaceCatalog(command: ReplaceStorefrontCatalogCommand): Promise<StorefrontCatalog>;
}

export class CatalogAdminUseCase {
  public constructor(private readonly repository: CatalogRepository) {}

  public getPublicCatalog(): Promise<StorefrontCatalog> {
    return this.repository.getPublicCatalog();
  }

  public getAdminCatalog(): Promise<StorefrontCatalog> {
    return this.repository.getAdminCatalog();
  }

  public listProviderGroups(): Promise<readonly ProviderGroupChoice[]> {
    return this.repository.listProviderGroups();
  }

  public replaceCatalog(command: ReplaceStorefrontCatalogCommand): Promise<StorefrontCatalog> {
    validateStorefrontCatalogDraft(command);
    return this.repository.replaceCatalog(command);
  }
}
