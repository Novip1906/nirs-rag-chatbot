import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type { DirectoryDepartment } from '~/types/directory';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';

export const NO_DEPARTMENT = 'none';

export interface EmployeeProfileValues {
  first_name: string;
  last_name: string;
  email: string;
  position: string;
  department: string;
}

interface EmployeeProfileFieldsProps {
  values: EmployeeProfileValues;
  onChange: (values: EmployeeProfileValues) => void;
  departments: DirectoryDepartment[];
  fieldErrors: Record<string, TranslationKeys>;
  idPrefix: string;
  emailLocked?: boolean;
}

function FieldError({ messageKey }: { messageKey?: TranslationKeys }): JSX.Element | null {
  const localize = useLocalize();
  if (messageKey == null) {
    return null;
  }
  return (
    <p className="text-xs text-text-destructive" role="alert">
      {localize(messageKey)}
    </p>
  );
}

export default function EmployeeProfileFields({
  values,
  onChange,
  departments,
  fieldErrors,
  idPrefix,
  emailLocked = false,
}: EmployeeProfileFieldsProps): JSX.Element {
  const localize = useLocalize();
  const set = (patch: Partial<EmployeeProfileValues>) => onChange({ ...values, ...patch });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-first-name`}>
            {localize('com_admin_employees_field_first_name')}
          </Label>
          <Input
            id={`${idPrefix}-first-name`}
            required
            value={values.first_name}
            onChange={(event) => set({ first_name: event.target.value })}
          />
          <FieldError messageKey={fieldErrors.first_name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-last-name`}>
            {localize('com_admin_employees_field_last_name')}
          </Label>
          <Input
            id={`${idPrefix}-last-name`}
            value={values.last_name}
            onChange={(event) => set({ last_name: event.target.value })}
          />
          <FieldError messageKey={fieldErrors.last_name} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-email`}>{localize('com_admin_employees_field_email')}</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          required
          disabled={emailLocked}
          value={values.email}
          onChange={(event) => set({ email: event.target.value })}
        />
        {emailLocked && (
          <p className="text-xs text-text-secondary">
            {localize('com_admin_employees_email_pending_hint')}
          </p>
        )}
        <FieldError messageKey={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-position`}>
          {localize('com_admin_employees_field_position')}
        </Label>
        <Input
          id={`${idPrefix}-position`}
          value={values.position}
          onChange={(event) => set({ position: event.target.value })}
        />
        <FieldError messageKey={fieldErrors.position} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-department`}>
          {localize('com_admin_employees_field_department')}
        </Label>
        <Select value={values.department} onValueChange={(department) => set({ department })}>
          <SelectTrigger id={`${idPrefix}-department`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEPARTMENT}>
              {localize('com_admin_employees_field_department_none')}
            </SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messageKey={fieldErrors.department_id} />
      </div>
    </>
  );
}
