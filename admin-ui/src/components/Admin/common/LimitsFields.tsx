import { useState } from 'react';
import { Checkbox, Input, Label } from '@librechat/client';
import type { AdminLimits } from '~/api';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { parseLimitInput } from './parseLimitInput';
import { useLocalize } from '~/hooks';

interface LimitsFieldsProps {
  value: AdminLimits;
  onChange: (value: AdminLimits) => void;
  idPrefix: string;
  /**
   * Подпись чекбокса «наследовать». Опущена там, где наследованием управляет
   * переключатель всего блока и пустое поле означает «без ограничения», а не
   * «взять сверху» — два способа сказать одно и то же противоречили бы друг другу.
   */
  nullLabel?: string;
  disabled?: boolean;
}

export default function LimitsFields({
  value,
  onChange,
  nullLabel,
  idPrefix,
  disabled = false,
}: LimitsFieldsProps): JSX.Element {
  const localize = useLocalize();
  const [errorKey, setErrorKey] = useState<TranslationKeys>();
  const fieldId = `${idPrefix}-dailyCostUsd`;
  const isUnset = value.dailyCostUsd === null;
  const labelKey: TranslationKeys = 'com_admin_limits_daily_cost';

  const setLimit = (next: number | null) => {
    onChange({ ...value, dailyCostUsd: next });
  };

  return (
    <div className="max-w-xs space-y-1.5 rounded-lg border border-border-light p-3">
      <Label htmlFor={fieldId} className="text-sm font-medium text-text-primary">
        {localize(labelKey)}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          type="number"
          min={0}
          /* `any`, а не шаг в копейку: расходы считаются долями цента, и порог, не кратный
             0,01, система порождает сама (одобренная заявка, унаследованный лимит отдела).
             С шагом 0,01 такое значение делает поле невалидным, и браузер молча отменяет
             отправку формы — админ жмёт «Сохранить», и ничего не происходит. */
          step="any"
          placeholder={localize('com_admin_limits_unlimited')}
          disabled={disabled}
          className="tabular-nums"
          value={value.dailyCostUsd ?? ''}
          onChange={(event) => {
            const { value: parsed, errorKey: nextErrorKey } = parseLimitInput(event.target.value);
            setErrorKey(nextErrorKey);
            if (nextErrorKey) {
              return;
            }
            setLimit(parsed);
          }}
          aria-label={localize(labelKey)}
          aria-invalid={errorKey != null}
        />
        <span className="shrink-0 text-sm text-text-secondary">
          {localize('com_admin_currency_usd')}
        </span>
      </div>
      {errorKey != null && (
        <p className="text-xs text-status-error" role="alert">
          {localize(errorKey)}
        </p>
      )}
      {nullLabel != null && (
        <label
          htmlFor={`${fieldId}-unset`}
          className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-text-secondary"
        >
          <Checkbox
            id={`${fieldId}-unset`}
            checked={isUnset}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (checked !== true) {
                return;
              }
              setErrorKey(undefined);
              setLimit(null);
            }}
            aria-label={nullLabel}
          />
          {nullLabel}
        </label>
      )}
    </div>
  );
}
