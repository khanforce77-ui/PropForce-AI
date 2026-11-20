import { defineConfig } from 'prisma/config';

// Migrations run as the schema owner (MIGRATION_DATABASE_URL). The application connects with a
// separate, non-owner role (DATABASE_URL) so that row-level security applies to it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      'postgresql://propforce:propforce_dev_only@localhost:5432/propforce',
  },
});
