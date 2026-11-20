// Creates the local/CI login role the application uses. Production creates its login role through
// infrastructure tooling with a managed secret; this script is for development and tests only.
import pg from 'pg';

const ownerUrl =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://propforce:propforce_dev_only@localhost:5432/propforce';
const appUser = process.env.APP_DB_USER ?? 'propforce_app_user';
const appPassword = process.env.APP_DB_PASSWORD ?? 'propforce_app_dev_only';

if (process.env.NODE_ENV === 'production') {
  throw new Error('setup-local-roles must not run in production');
}
if (!/^[a-z_][a-z0-9_]*$/.test(appUser)) throw new Error('Invalid APP_DB_USER');

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
  const pw = appPassword.replace(/'/g, "''");
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${appUser} LOGIN NOBYPASSRLS PASSWORD '${pw}'`);
  } else {
    await client.query(`ALTER ROLE ${appUser} LOGIN NOBYPASSRLS PASSWORD '${pw}'`);
  }
  await client.query(`GRANT propforce_app TO ${appUser}`);
  process.stdout.write(`Role ${appUser} ready (member of propforce_app)\n`);
} finally {
  await client.end();
}
