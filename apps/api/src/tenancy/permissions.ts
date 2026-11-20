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
  /** View the agency's listings and projects. */
  'property:read',
  /** Create listings and edit or change the status of listings assigned to you. */
  'property:write',
  /** Edit, reassign, verify or delete any listing in the agency; manage projects. */
  'property:manage',
  /** View contacts and leads you own or are assigned. */
  'crm:read',
  /** Add contacts and leads, record consent, work the leads assigned to you. */
  'crm:write',
  /** See and reassign every contact and lead in the agency; erase contacts. */
  'crm:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: [
    'agency:read',
    'member:read',
    'team:read',
    'property:read',
    'property:write',
    'property:manage',
    'crm:read',
    'crm:write',
    'crm:manage',
  ],
  agent: [
    'agency:read',
    'member:read',
    'team:read',
    'property:read',
    'property:write',
    'crm:read',
    'crm:write',
  ],
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/** Roles whose holders must use two-factor authentication. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['owner', 'admin'];

/** Only owners may grant, change or remove the owner and admin roles. */
export const PRIVILEGED_ROLES: readonly Role[] = ['owner', 'admin'];
