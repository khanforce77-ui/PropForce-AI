// Applies pending migrations and ensures the application's login role for a deployed database
// (staging/production). Runs as the schema owner. All inputs come from the environment:
//   MIGRATION_DATABASE_URL  owner connection string (required)
//   APP_DB_USER             application login role (default propforce_app_user)
//   APP_DB_PASSWORD         application role password (required, at least 24 characters)
// Exits non-zero on any failure so that the deployment stops.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appUser = process.env.APP_DB_USER ?? 'propforce_app_user';
const appPassword = process.env.APP_DB_PASSWORD;

if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL is required');
if (!appPassword || appPassword.length < 24) {
  throw new Error('APP_DB_PASSWORD is required and must be at least 24 characters');
}
if (!/^[a-z_][a-z0-9_]*$/.test(appUser)) throw new Error('Invalid APP_DB_USER');

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  cwd: pkgDir,
  stdio: 'inherit',
  env: process.env,
});

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
  const pw = appPassword.replace(/'/g, "''");
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  await client.query(`${verb} ROLE ${appUser} LOGIN NOBYPASSRLS PASSWORD '${pw}'`);
  await client.query(`GRANT propforce_app TO ${appUser}`);
  process.stdout.write(`Migrations applied; role ${appUser} ready (member of propforce_app)\n`);
} finally {
  await client.end();
}
