import { useCallback, useMemo } from 'react';
import { MultiSelect } from '@librechat/client';
import { useAdminDepartmentsQuery } from '~/data-provider/Admin';
import { useLocalize } from '~/hooks';

const MAX_INLINE_DEPARTMENT_LABELS = 2;

interface DepartmentsMultiSelectProps {
  selectedValues: string[];
  setSelectedValues: (values: string[]) => void;
  helperText?: string;
}

export default function DepartmentsMultiSelect({
  selectedValues,
  setSelectedValues,
  helperText,
}: DepartmentsMultiSelectProps): JSX.Element {
  const localize = useLocalize();
  const departmentsQuery = useAdminDepartmentsQuery();

  const departments = departmentsQuery.data ?? [];
  const items = useMemo(
    () => departments.map((department) => ({ label: department.name, value: department.id })),
    [departments],
  );
  const nameById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );

  /**
   * Replaces `MultiSelect`'s default "3 items selected" with the actual department
   * names, matching `ModelsMultiSelect` — otherwise `sameWidth` in Ariakit crops the
   * default English summary text down to something unreadable.
   */
  const renderSelectedDepartments = useCallback(
    (values: string[], placeholderText?: string) => {
      if (values.length === 0) {
        return placeholderText;
      }
      const labels = values.map((id) => nameById.get(id) ?? id);
      if (labels.length <= MAX_INLINE_DEPARTMENT_LABELS) {
        return labels.join(', ');
      }
      return localize('com_admin_allowed_models_selected_more', {
        shown: labels.slice(0, MAX_INLINE_DEPARTMENT_LABELS).join(', '),
        count: labels.length - MAX_INLINE_DEPARTMENT_LABELS,
      });
    },
    [localize, nameById],
  );

  return (
    <div>
      <MultiSelect
        items={items}
        label={localize('com_admin_knowledge_field_departments')}
        placeholder={localize('com_admin_knowledge_departments_all')}
        selectedValues={selectedValues}
        setSelectedValues={setSelectedValues}
        renderSelectedValues={renderSelectedDepartments}
        className="w-full"
        selectClassName="w-full"
        popoverClassName="!min-w-[20rem]"
      />
      {helperText != null && <p className="mt-1 text-xs text-text-secondary">{helperText}</p>}
    </div>
  );
}
