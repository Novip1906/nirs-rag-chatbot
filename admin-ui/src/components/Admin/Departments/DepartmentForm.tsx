import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Label } from '@librechat/client';
import { PageCard } from '~/components/Admin/common/PageColumns';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';

export interface DepartmentFormValues {
  name: string;
  description: string;
}

interface DepartmentFormProps {
  initialValues: DepartmentFormValues;
  onSubmit: (values: DepartmentFormValues) => void;
  onCancel: () => void;
  isSaving: boolean;
  submitLabelKey?: TranslationKeys;
  errorKey?: TranslationKeys | null;
  fieldErrors?: Record<string, TranslationKeys>;
  aiSettingsHref?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function DepartmentForm({
  initialValues,
  onSubmit,
  onCancel,
  isSaving,
  submitLabelKey = 'com_admin_action_save',
  errorKey = null,
  fieldErrors = {},
  aiSettingsHref,
  onDirtyChange,
}: DepartmentFormProps): JSX.Element {
  const localize = useLocalize();
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const dirty = name !== initialValues.name || description !== initialValues.description;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  return (
    <form onSubmit={handleSubmit}>
      <PageCard className="max-w-2xl">
        <div className="space-y-1.5">
          <Label htmlFor="admin-department-name">
            {localize('com_admin_departments_field_name')}
          </Label>
          <Input
            id="admin-department-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldErrors.name != null && (
            <p className="text-xs text-text-destructive" role="alert">
              {localize(fieldErrors.name)}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-department-description">
            {localize('com_admin_departments_field_description')}
          </Label>
          <Input
            id="admin-department-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {fieldErrors.description != null && (
            <p className="text-xs text-text-destructive" role="alert">
              {localize(fieldErrors.description)}
            </p>
          )}
        </div>
        {aiSettingsHref != null && (
          <Link to={aiSettingsHref} className="block text-sm text-link underline">
            {localize('com_admin_departments_ai_settings')}
          </Link>
        )}
        {errorKey != null && (
          <p className="text-xs text-text-destructive" role="alert">
            {localize(errorKey)}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {localize('com_admin_action_cancel')}
          </Button>
          <Button type="submit" variant="submit" disabled={isSaving}>
            {localize(submitLabelKey)}
          </Button>
        </div>
      </PageCard>
    </form>
  );
}
