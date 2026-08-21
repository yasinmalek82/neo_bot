#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const empty = () => {
  process.stdout.write('{}\n');
};

try {
  const context = await readFile(resolve('PROJECT_CONTEXT.md'), 'utf8');
  const phase = context.match(/^current-phase: (\S+)/mu)?.[1] ?? 'unknown';
  const nextTask = context.match(/^next-task: (\S+)/mu)?.[1] ?? 'unknown';
  process.stdout.write(
    `${JSON.stringify({
      additional_context: `neo_bot session: phase=${phase}; next-task=${nextTask}. Read AGENTS.md and full PROJECT_CONTEXT.md, then git status and pnpm context:check. Graphify before exploring. Max two subagents. No secrets in chat. User replies in RTL Persian.`,
    })}\n`,
  );
} catch {
  empty();
}
