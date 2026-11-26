import pg from 'pg';

/**
 * Existing flows sign up and finish onboarding in one step. Registration documents (Dubai KYC)
 * are covered by the API tests, so they are switched off here; specs that need them turn them on.
 */
export default async function globalSetup() {
  const client = new pg.Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      'postgresql://propforce:propforce_dev_only@localhost:5432/propforce',
  });
  await client.connect();
  try {
    await client.query(
      "UPDATE feature_flag SET enabled = false WHERE key = 'platform.require_agency_documents'",
    );
  } finally {
    await client.end();
  }
}
