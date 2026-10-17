import { useEffect, useState } from 'react';
import { Button, Label, Textarea } from '@librechat/client';
import type { AdminLimits } from '~/api';
import ModelAccessFields from '~/components/Admin/common/ModelAccess';
import LimitsFields from '~/components/Admin/common/LimitsFields';
import PageColumns, { PageCard } from '~/components/Admin/common/PageColumns';
import { useLocalize } from '~/hooks';

export interface AiDepartmentFormValues {
  systemPrompt: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: AdminLimits;
}

interface AiDepartmentFormProps {
  initialValues: AiDepartmentFormValues;
  onSubmit: (values: AiDepartmentFormValues) => void;
  onCancel: () => void;
  isSaving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function AiDepartmentForm({
  initialValues,
  onSubmit,
  onCancel,
  isSaving,
  onDirtyChange,
}: AiDepartmentFormProps): JSX.Element {
  const localize = useLocalize();
  const [systemPrompt, setSystemPrompt] = useState(initialValues.systemPrompt);
  const [allowedModels, setAllowedModels] = useState<string[]>(initialValues.allowedModels);
  const [defaultModel, setDefaultModel] = useState<string | null>(initialValues.defaultModel);
  const [defaultLimits, setDefaultLimits] = useState<AdminLimits>(initialValues.defaultLimits);

  const dirty =
    JSON.stringify({ systemPrompt, allowedModels, defaultModel, defaultLimits }) !==
    JSON.stringify(initialValues);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const defaultModelMissing = allowedModels.length > 0 && defaultModel == null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (defaultModelMissing) {
      return;
    }
    onSubmit({ systemPrompt, allowedModels, defaultModel, defaultLimits });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl space-y-6">
      <PageColumns>
        <PageCard>
          <div className="space-y-1.5">
            <Label htmlFor="admin-department-prompt">
              {localize('com_admin_departments_field_prompt')}
            </Label>
            <Textarea
              id="admin-department-prompt"
              rows={12}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
            <p className="text-xs text-text-secondary">
              {localize('com_admin_departments_prompt_helper')}
            </p>
          </div>
        </PageCard>
        <PageCard>
          <ModelAccessFields
            idPrefix="admin-department"
            allowedModels={allowedModels}
            defaultModel={defaultModel}
            onChange={(next) => {
              setAllowedModels(next.allowedModels);
              setDefaultModel(next.defaultModel);
            }}
            helperText={localize('com_admin_departments_models_helper')}
            defaultHelperText={localize('com_admin_default_model_helper_department')}
          />
          <div className="space-y-1.5">
            <Label>{localize('com_admin_departments_field_limits')}</Label>
            <LimitsFields
              idPrefix="admin-department"
              value={defaultLimits}
              onChange={setDefaultLimits}
              nullLabel={localize('com_admin_limits_inherit')}
            />
          </div>
        </PageCard>
      </PageColumns>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="submit" disabled={isSaving || defaultModelMissing}>
          {localize('com_admin_action_save')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {localize('com_admin_action_cancel')}
        </Button>
        {defaultModelMissing && (
          <p className="text-xs text-text-warning">
            {localize('com_admin_default_model_required')}
          </p>
        )}
      </div>
    </form>
  );
}
