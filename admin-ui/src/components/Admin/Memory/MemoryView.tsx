import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import { MEMORY_PERMISSION_ROLES } from '~/api';
import type { MemoryRolePermissions } from '~/api';
import {
  useRoleMemoryPermissionsQuery,
  useUpdateRoleMemoryPermissionsMutation,
} from '~/data-provider/Admin';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';

const EMPTY_PERMISSIONS: MemoryRolePermissions = {
  USE: false,
  CREATE: false,
  UPDATE: false,
  READ: false,
  OPT_OUT: false,
};

const PERMISSION_FIELDS: { key: keyof MemoryRolePermissions; labelKey: TranslationKeys }[] = [
  { key: 'USE', labelKey: 'com_admin_memory_perm_use' },
  { key: 'CREATE', labelKey: 'com_admin_memory_perm_create' },
  { key: 'READ', labelKey: 'com_admin_memory_perm_read' },
  { key: 'UPDATE', labelKey: 'com_admin_memory_perm_update' },
  { key: 'OPT_OUT', labelKey: 'com_admin_memory_perm_opt_out' },
];

const ROLE_LABEL_KEYS: Record<string, TranslationKeys> = {
  USER: 'com_admin_role_user',
  HEAD: 'com_admin_role_head',
  ADMIN: 'com_admin_role_admin',
  OWNER: 'com_admin_role_owner',
};

export default function MemoryView(): JSX.Element {
  const localize = useLocalize();
  const [roleName, setRoleName] = useState<string>(MEMORY_PERMISSION_ROLES[0]);
  const permissionsQuery = useRoleMemoryPermissionsQuery(roleName);
  const updatePermissions = useUpdateRoleMemoryPermissionsMutation();

  const [permissions, setPermissions] = useState<MemoryRolePermissions>(EMPTY_PERMISSIONS);

  useEffect(() => {
    if (permissionsQuery.data == null) {
      return;
    }
    setPermissions(permissionsQuery.data);
  }, [permissionsQuery.data]);

  /** Без права пользоваться памятью остальные ничего не значат: сервер проверяет USE
   *  первым в каждом гейте. Показываем это явно, чтобы админ не гадал, почему
   *  выставленное «создание» ни на что не влияет. */
  const memoryDisabled = !permissions.USE;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    updatePermissions.mutate({ roleName, permissions });
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_memory_title')}
        description={localize('com_admin_memory_description')}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Panel className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="admin-memory-role">{localize('com_admin_memory_field_role')}</Label>
              <Select value={roleName} onValueChange={setRoleName}>
                <SelectTrigger id="admin-memory-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_PERMISSION_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {localize(ROLE_LABEL_KEYS[role])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {permissionsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
            {permissionsQuery.isError && (
              <AdminErrorState onRetry={() => permissionsQuery.refetch()} />
            )}
            {!permissionsQuery.isLoading && !permissionsQuery.isError && (
              <>
                <div className="space-y-3">
                  {PERMISSION_FIELDS.map(({ key, labelKey }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-text-primary">
                      <Checkbox
                        aria-label={localize(labelKey)}
                        checked={permissions[key]}
                        disabled={key !== 'USE' && memoryDisabled}
                        onCheckedChange={(checked) =>
                          setPermissions((current) => ({ ...current, [key]: checked === true }))
                        }
                      />
                      {localize(labelKey)}
                    </label>
                  ))}
                </div>
                {memoryDisabled && (
                  <p className="text-xs text-text-secondary">
                    {localize('com_admin_memory_disabled_helper')}
                  </p>
                )}
                <div className="flex items-center justify-end">
                  <Button type="submit" disabled={updatePermissions.isLoading}>
                    {localize('com_admin_action_save')}
                  </Button>
                </div>
              </>
            )}
          </form>
        </Panel>
      </div>
    </div>
  );
}
