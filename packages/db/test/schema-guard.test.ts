import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src';
import { createAppClient, createOwnerClient } from './helpers';

let owner: PrismaClient;
let app: PrismaClient;

beforeAll(() => {
  owner = createOwnerClient();
  app = createAppClient();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('schema guards', () => {
  it('every table with a tenant_id column (and agency itself) has RLS enabled and forced', async () => {
    const rows = await owner.$queryRaw<
      { table: string; enabled: boolean; forced: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (c.relname = 'agency' OR EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'))
      ORDER BY c.relname`;
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced || Number(r.policies) === 0);
    expect(unprotected.map((r) => r.table)).toEqual([]);
  });

  it('the application role is not a superuser, cannot bypass RLS and owns no tables', async () => {
    const [role] = await app.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; owned: bigint }[]
    >`
      SELECT r.rolsuper, r.rolbypassrls,
             (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owned
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0n });
  });
});
