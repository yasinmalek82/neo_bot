import { CatalogAdminUseCase } from '@neo-bot/application';
import { PostgresCatalogRepository } from '@neo-bot/database';
import type { Pool } from 'pg';

import { databasePoolToken } from './database.provider.js';

export const catalogAdminUseCaseToken = Symbol('catalogAdminUseCase');

export const catalogAdminUseCaseProvider = {
  provide: catalogAdminUseCaseToken,
  inject: [databasePoolToken],
  useFactory: (pool: Pool) => new CatalogAdminUseCase(new PostgresCatalogRepository(pool)),
};
