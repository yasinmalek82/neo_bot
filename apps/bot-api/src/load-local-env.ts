import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const rootEnvironmentFile = fileURLToPath(new URL('../../../.env', import.meta.url));

try {
  loadEnvFile(rootEnvironmentFile);
} catch (error: unknown) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
    throw error;
  }
}
