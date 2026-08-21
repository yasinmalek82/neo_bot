#!/usr/bin/env node

const allow = () => {
  process.stdout.write('{"permission":"allow"}\n');
};

try {
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
  const payload = JSON.parse(raw || '{}');
  const command = String(payload.command ?? '');
  if (
    /\bgit\s+push\b[\s\S]*--force\b/u.test(command) ||
    /\bgit\s+push\b[\s\S]*-f\b/u.test(command) ||
    /\bgit\s+reset\b[\s\S]*--hard\b/u.test(command) ||
    /\bgit\s+checkout\b[\s\S]*--force\b/u.test(command)
  ) {
    process.stdout.write(
      `${JSON.stringify({
        permission: 'ask',
        agent_message: 'Destructive git command requires explicit owner approval.',
        user_message: 'این دستور git برگشت‌ناپذیر است. فقط در صورت تأیید صریح ادامه بده.',
      })}\n`,
    );
    process.exit(0);
  }
  allow();
} catch {
  allow();
}
