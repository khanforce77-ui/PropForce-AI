import type { Role } from '@propforce/db';

/**
 * Central permission catalog. Routes declare the permission they need; roles map to permissions
 * here and nowhere else. Default deny: anything not listed is refused.
 */
export const PERMISSIONS = [
  'agency:read',
  'agency:write',
  'agency:settings',
  'member:read',
  'member:write',
  'member:suspend',
  'member:invite',
  'team:read',
  'team:write',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: ['agency:read', 'member:read', 'team:read'],
  agent: ['agency:read', 'member:read', 'team:read'],
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/** Roles whose holders must use two-factor authentication. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['owner', 'admin'];

/** Only owners may grant, change or remove the owner and admin roles. */
export const PRIVILEGED_ROLES: readonly Role[] = ['owner', 'admin'];
