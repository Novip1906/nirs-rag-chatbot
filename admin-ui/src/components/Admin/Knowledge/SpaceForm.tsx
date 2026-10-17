import { useState } from 'react';
import { Button, Input, Label, Switch, Textarea } from '@librechat/client';
import DepartmentsMultiSelect from '~/components/Admin/common/DepartmentsMultiSelect';
import { useLocalize } from '~/hooks';

export interface SpaceFormValues {
  name: string;
  description: string;
  allowedDepartments: string[];
  enabled: boolean;
}

/**
 * Форма может не слать `allowedDepartments` вовсе — это то самое, что происходит для
 * главы отдела (см. `headDepartmentId` ниже): сервер либо подставит её отдел сам
 * (создание), либо оставит текущее значение как есть (правка), не рискуя случайно
 * сузить пространство, которым, помимо её отдела, пользуется ещё чей-то.
 */
export type SpaceFormSubmitValues = Omit<SpaceFormValues, 'allowedDepartments'> & {
  allowedDepartments?: string[];
};

interface SpaceFormProps {
  initialValues: SpaceFormValues;
  onSubmit: (values: SpaceFormSubmitValues) => void;
  onCancel: () => void;
  isSaving: boolean;
  /**
   * `null` для админа и владельца — отделы пространства правятся, как и раньше,
   * многозначным выбором. Для главы отдела сюда приходит её собственный
   * `departmentId`: список отделов ей недоступен ни на чтение (`GET /departments`
   * требует админ-уровня и отвечает ей 403), ни на правку — поле заменяется
   * статичным указанием своего отдела.
   */
  headDepartmentId?: string | null;
  /**
   * Название своего отдела для главы — берётся из `useCapabilities()` (сервер кладёт
   * его туда же, где и `departmentId`, специально ради этого случая), а не из
   * `useAdminDepartmentsQuery`: тот запрос главе недоступен и раньше просто падал
   * с 403, оставляя в этом поле сырой id вместо названия. Для админа не используется.
   */
  headDepartmentName?: string | null;
}

export default function SpaceForm({
  initialValues,
  onSubmit,
  onCancel,
  isSaving,
  headDepartmentId = null,
  headDepartmentName = null,
}: SpaceFormProps): JSX.Element {
  const localize = useLocalize();
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [allowedDepartments, setAllowedDepartments] = useState<string[]>(
    initialValues.allowedDepartments,
  );
  const [enabled, setEnabled] = useState(initialValues.enabled);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const values: SpaceFormSubmitValues = { name, description, enabled };
    if (headDepartmentId == null) {
      values.allowedDepartments = allowedDepartments;
    }
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="admin-knowledge-space-name">
          {localize('com_admin_knowledge_field_name')}
        </Label>
        <Input
          id="admin-knowledge-space-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin-knowledge-space-description">
          {localize('com_admin_knowledge_field_description')}
        </Label>
        <Textarea
          id="admin-knowledge-space-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        {headDepartmentId != null ? (
          <div>
            <Label>{localize('com_admin_knowledge_field_departments')}</Label>
            <p className="mt-1 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary">
              {headDepartmentName ?? headDepartmentId}
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {localize('com_admin_knowledge_departments_head_locked')}
            </p>
          </div>
        ) : (
          <DepartmentsMultiSelect
            selectedValues={allowedDepartments}
            setSelectedValues={setAllowedDepartments}
            helperText={localize('com_admin_knowledge_departments_helper')}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border-light p-3">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {localize('com_admin_knowledge_field_enabled')}
          </p>
          <p className="text-xs text-text-secondary">
            {localize('com_admin_knowledge_field_enabled_description')}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={localize('com_admin_knowledge_field_enabled')}
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {localize('com_admin_action_cancel')}
        </Button>
        <Button type="submit" variant="submit" disabled={isSaving}>
          {localize('com_admin_action_save')}
        </Button>
      </div>
    </form>
  );
}
