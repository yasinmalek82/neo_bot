#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

try {
  const check = spawnSync(process.execPath, ['tools/project-context.mjs'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (check.status === 0) {
    process.stdout.write('{}\n');
    process.exit(0);
  }
  process.stdout.write(
    `${JSON.stringify({
      followup_message:
        'PROJECT_CONTEXT fingerprint is stale. Update the handoff (no secrets), then pnpm context:stamp and pnpm check before finishing.',
    })}\n`,
  );
} catch {
  process.stdout.write('{}\n');
}
