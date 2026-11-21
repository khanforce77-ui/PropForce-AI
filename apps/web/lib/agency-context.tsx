'use client';

import { createContext, useContext } from 'react';
import type { Membership } from './api';

/**
 * The caller's place in the agency being viewed. For a platform admin who is not a member,
 * `platform` is true, `id` is empty and `role` is 'admin' (what the API grants them).
 */
export type AgencyMembership = Membership & { platform: boolean };

export const AgencyContext = createContext<AgencyMembership | null>(null);

export function useAgencyMembership(): AgencyMembership | null {
  return useContext(AgencyContext);
}
