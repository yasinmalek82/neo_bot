import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contextPath = resolve(repositoryRoot, 'PROJECT_CONTEXT.md');
const stampRequested = process.argv.includes('--stamp');

const requiredHeadings = [
  '# neo_bot Project Context',
  '## How every Codex session must start',
  '## Product vision',
  '## Non-negotiable decisions',
  '## Current verified snapshot',
  '## Architecture map',
  '## Capability status',
  '## Production roadmap',
  '## Current priority and next task',
  '## Production definition of done',
  '## Update protocol',
  '## Handoff log',
];

const sourceRoots = [
  '.agents/skills/',
  '.specify/',
  'apps/',
  'packages/',
  'tools/',
  'docs/adr/',
  'docs/runbooks/',
  'deploy/',
  'specs/',
];
const sourceFiles = new Set([
  '.dependency-cruiser.cjs',
  '.env.example',
  '.gitignore',
  '.github/workflows/check.yml',
  '.prettierignore',
  'AGENTS.md',
  'README.md',
  'SECURITY.md',
  'Dockerfile',
  'docker-compose.local-test.yml',
  'docker-compose.yml',
  'docker-compose.production.yml',
  'eslint.config.mjs',
  'knip.json',
  '.graphifyignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);

function git(...args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isMaterialSource(path) {
  if (path === 'PROJECT_CONTEXT.md') return false;
  return sourceFiles.has(path) || sourceRoots.some((root) => path.startsWith(root));
}

async function calculateSourceFingerprint() {
  let candidates;
  try {
    candidates = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(Boolean);
  } catch {
    throw new Error('PROJECT_CONTEXT_GIT_REQUIRED');
  }

  const materialFiles = candidates.filter(isMaterialSource).sort();
  if (materialFiles.length === 0) throw new Error('PROJECT_CONTEXT_NO_SOURCE_FILES');

  const hash = createHash('sha256');
  for (const relativePath of materialFiles) {
    let contents;
    try {
      contents = await readFile(resolve(repositoryRoot, relativePath));
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }
    hash.update(relativePath);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readMetadata(content) {
  const schema = content.match(/^context-schema: (\d+)$/mu)?.[1];
  const lastUpdated = content.match(/^last-updated: ([^\n]+)$/mu)?.[1];
  const fingerprint = content.match(/^source-fingerprint: ([a-f0-9]{64}|pending)$/mu)?.[1];
  const currentPhase = content.match(/^current-phase: ([a-z0-9-]+)$/mu)?.[1];
  const nextTask = content.match(/^next-task: ([a-z0-9-]+)$/mu)?.[1];
  return { schema, lastUpdated, fingerprint, currentPhase, nextTask };
}

function validateStructure(content) {
  const missing = requiredHeadings.filter((heading) => !content.includes(heading));
  if (missing.length > 0) {
    throw new Error(`PROJECT_CONTEXT_MISSING_SECTIONS:${missing.join(',')}`);
  }
  const metadata = readMetadata(content);
  if (metadata.schema !== '1') throw new Error('PROJECT_CONTEXT_INVALID_SCHEMA');
  if (
    metadata.lastUpdated === undefined ||
    Number.isNaN(Date.parse(metadata.lastUpdated)) ||
    metadata.currentPhase === undefined ||
    metadata.nextTask === undefined ||
    metadata.fingerprint === undefined
  ) {
    throw new Error('PROJECT_CONTEXT_INVALID_METADATA');
  }
  return metadata;
}

async function stamp(content, fingerprint) {
  const timestamp = new Date().toISOString();
  const stamped = content
    .replace(/^last-updated: [^\n]+$/mu, `last-updated: ${timestamp}`)
    .replace(/^source-fingerprint: [^\n]+$/mu, `source-fingerprint: ${fingerprint}`);
  await writeFile(contextPath, stamped, 'utf8');
  return stamped;
}

try {
  let content = await readFile(contextPath, 'utf8');
  validateStructure(content);
  const fingerprint = await calculateSourceFingerprint();

  if (stampRequested) {
    content = await stamp(content, fingerprint);
  }

  const metadata = validateStructure(content);
  if (metadata.fingerprint !== fingerprint) {
    throw new Error(
      'PROJECT_CONTEXT_STALE: update PROJECT_CONTEXT.md, then run pnpm context:stamp',
    );
  }

  process.stdout.write(
    `Project context is current (${metadata.currentPhase} -> ${metadata.nextTask}).\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'PROJECT_CONTEXT_CHECK_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
