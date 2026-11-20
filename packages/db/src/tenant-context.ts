const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is acting and in which agency. Every tenant-scoped database call needs one. */
export interface TenantContext {
  tenantId: string;
  userId?: string;
}

/** Context for a signed-in user before an agency is selected (e.g. listing "my agencies"). */
export interface UserContext {
  userId: string;
}

export class MissingTenantContextError extends Error {
  constructor(message = 'Tenant context is required for this database operation') {
    super(message);
    this.name = 'MissingTenantContextError';
  }
}

export function assertUuid(value: string | undefined, field: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new MissingTenantContextError(`${field} must be a UUID`);
  }
  return value;
}
