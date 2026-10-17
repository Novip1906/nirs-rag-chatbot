import { useCallback } from 'react';
import { SystemRoles } from '~/api';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useLocalize } from '~/hooks';

const ROLE_LABEL_KEYS: Record<string, TranslationKeys> = {
  [SystemRoles.OWNER]: 'com_admin_role_owner',
  [SystemRoles.ADMIN]: 'com_admin_role_admin',
  [SystemRoles.HEAD]: 'com_admin_role_head',
  [SystemRoles.USER]: 'com_admin_role_user',
};

/**
 * `User.role` is a free-form string, not an enum: custom roles created through the roles
 * API land there too. Unknown values fall back to the raw name rather than to a generic
 * placeholder, so an admin can still tell two custom roles apart.
 */
export function useRoleLabel(): (role: string) => string {
  const localize = useLocalize();

  return useCallback(
    (role: string) => {
      const key = ROLE_LABEL_KEYS[role];
      return key != null ? localize(key) : role;
    },
    [localize],
  );
}
